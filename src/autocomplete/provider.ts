import * as vscode from "vscode";
import { messageOf } from "../errors";
import { FimClient } from "../transport/fim";
import { resolveAutocompleteSettings } from "./config";
import { buildPromptContext } from "./context";
import { postprocessCompletion } from "./postprocess";
import { CompletionDebouncer } from "./debounce";

const ALLOWED_SCHEMES = new Set(["file", "untitled", "vscode-notebook-cell"]);
const MIN_SELECTED_CHARS = 4;
export const AUTOCOMPLETE_ACCEPTED_COMMAND = "inceptionCopilot.autocomplete.accepted";

export type ApiKeyResolver = () => Promise<string | undefined>;

/**
 * Inline autocomplete provider backed by the Inception FIM endpoint and
 * Mercury Edit. Registered for all files; suggestions are insertions (or a
 * replace-to-end-of-line while the suggest widget is open), which is what the
 * stable inline-completion API can express.
 */
interface SuggestionRequest {
  readonly prompt: string;
  readonly suffix: string;
  readonly typedText: string;
  readonly range: vscode.Range;
}

export class MercuryAutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly debouncer = new CompletionDebouncer();
  private readonly inFlight = new Set<AbortController>();
  private missingKeyLogged = false;

  constructor(
    private readonly resolveApiKey: ApiKeyResolver,
    private readonly fim: FimClient,
    private readonly output: vscode.OutputChannel,
  ) {}

  dispose(): void {
    this.debouncer.dispose();
    for (const controller of this.inFlight) controller.abort();
    this.inFlight.clear();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const settings = resolveAutocompleteSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
    if (!settings.enabled || token.isCancellationRequested) return undefined;
    if (!ALLOWED_SCHEMES.has(document.uri.scheme)) return undefined;
    if (this.hasMultipleSelections(document)) return undefined;

    const request = this.resolveRequest(document, position, context, settings);
    if (!request) return undefined;

    // Explicit invocations (e.g. inline suggest next) skip the debounce.
    if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke) {
      if (!(await this.debouncer.delay(settings.debounceMs))) return undefined;
    }
    if (token.isCancellationRequested) return undefined;

    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      this.warnMissingKey();
      return undefined;
    }
    return await this.fetchSuggestion(settings, apiKey, request, token);
  }

  private hasMultipleSelections(document: vscode.TextDocument): boolean {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() !== document.uri.toString()) return false;
    return (editor?.selections.length ?? 0) > 1;
  }

  private resolveRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    settings: { maxPromptTokens: number },
  ): SuggestionRequest | undefined {
    const selectedInfo = context.selectedCompletionInfo;
    const typedText = selectedInfo?.text ?? "";
    if (selectedInfo && typedText.length < MIN_SELECTED_CHARS) return undefined;

    const fullText = document.getText();
    const startOffset = selectedInfo ? document.offsetAt(selectedInfo.range.start) : document.offsetAt(position);
    const endOffset = selectedInfo ? document.offsetAt(selectedInfo.range.end) : document.offsetAt(position);
    const budgeted = buildPromptContext(
      fullText.slice(0, startOffset) + typedText,
      fullText.slice(endOffset),
      settings.maxPromptTokens,
    );
    const range = selectedInfo
      ? new vscode.Range(selectedInfo.range.start, document.lineAt(position.line).range.end)
      : new vscode.Range(position, position);
    return { prompt: budgeted.prompt, suffix: budgeted.suffix, typedText, range };
  }

  private async fetchSuggestion(
    settings: { model: string; maxTokens: number; requestTimeoutMs: number },
    apiKey: string,
    request: SuggestionRequest,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const completion = await this.fim.complete(apiKey, {
        model: settings.model,
        prompt: request.prompt,
        suffix: request.suffix,
        maxTokens: settings.maxTokens,
      }, controller.signal);
      if (token.isCancellationRequested || controller.signal.aborted) return undefined;
      this.logUsage(settings.model, completion, Date.now() - started);

      const text = postprocessCompletion(completion.text);
      if (!text) return undefined;
      if (request.typedText && !text.startsWith(request.typedText)) return undefined;

      const item = new vscode.InlineCompletionItem(text, request.range, {
        title: "Log suggestion acceptance",
        command: AUTOCOMPLETE_ACCEPTED_COMMAND,
      });
      return [item];
    } catch (error) {
      if (token.isCancellationRequested || controller.signal.aborted) {
        if (this.debugLogging()) {
          this.output.appendLine(`[autocomplete] request aborted after ${Date.now() - started}ms`);
        }
        return undefined;
      }
      this.output.appendLine(`[autocomplete] request failed: ${messageOf(error)}`);
      return undefined;
    } finally {
      clearTimeout(timeout);
      cancellation.dispose();
      this.inFlight.delete(controller);
    }
  }

  private warnMissingKey(): void {
    if (this.missingKeyLogged) return;
    this.missingKeyLogged = true;
    this.output.appendLine(
      "[autocomplete] no Inception API key configured; run ‘Inception: Configure API Key’ or add a native provider entry",
    );
  }

  private logUsage(model: string, completion: { usage?: { promptTokens: number; completionTokens: number }; warning?: string }, elapsedMs: number): void {
    if (!this.debugLogging()) return;
    const usage = completion.usage;
    const detail = usage ? `prompt=${usage.promptTokens} output=${usage.completionTokens}` : "usage unavailable";
    const warning = completion.warning ? ` warning="${completion.warning}"` : "";
    this.output.appendLine(`[autocomplete] model=${model} ${elapsedMs}ms ${detail}${warning}`);
  }

  private debugLogging(): boolean {
    return vscode.workspace.getConfiguration("inceptionCopilot").get("debugLogging", false);
  }
}
