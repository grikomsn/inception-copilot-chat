import * as vscode from "vscode";
import { messageOf } from "../errors";
import { FimClient } from "../transport/fim";
import { resolveAutocompleteSettings } from "./config";
import { buildPromptContext } from "./context";
import { postprocessCompletion } from "./postprocess";
import { CompletionDebouncer } from "./debounce";
import {
  MIN_SELECTED_CHARS,
  hasMultipleSelections,
  isTrackedScheme,
  resolveTypedContext,
  type TypedContext,
} from "./vscode-context";

export const AUTOCOMPLETE_ACCEPTED_COMMAND = "inceptionCopilot.autocomplete.accepted";

export type ApiKeyResolver = () => Promise<string | undefined>;

/**
 * Inline autocomplete provider backed by the Inception FIM endpoint and
 * Mercury Edit. Registered for all files; suggestions are insertions (or a
 * replace-to-end-of-line while the suggest widget is open), which is what the
 * stable inline-completion API can express.
 */
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
    if (!isTrackedScheme(document.uri)) return undefined;
    if (hasMultipleSelections(document)) return undefined;

    const typed = resolveTypedContext(document, position, context);
    if (context.selectedCompletionInfo && typed.typedText.length < MIN_SELECTED_CHARS) return undefined;

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
    return await this.fetchSuggestion(settings, apiKey, document, document.version, typed, token);
  }

  private async fetchSuggestion(
    settings: { model: string; maxTokens: number; maxPromptTokens: number; requestTimeoutMs: number },
    apiKey: string,
    document: vscode.TextDocument,
    documentVersion: number,
    typed: TypedContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const fullText = document.getText();
    const budgeted = buildPromptContext(
      fullText.slice(0, typed.startOffset) + typed.typedText,
      fullText.slice(typed.endOffset),
      settings.maxPromptTokens,
    );
    const controller = new AbortController();
    this.inFlight.add(controller);
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const completion = await this.fim.complete(apiKey, {
        model: settings.model,
        prompt: budgeted.prompt,
        suffix: budgeted.suffix,
        maxTokens: settings.maxTokens,
      }, controller.signal);
      if (token.isCancellationRequested || controller.signal.aborted || document.version !== documentVersion) {
        return undefined;
      }
      this.logUsage(settings.model, completion, Date.now() - started);

      const text = postprocessCompletion(completion.text);
      if (!text) return undefined;
      if (typed.typedText && !text.startsWith(typed.typedText)) return undefined;

      const item = new vscode.InlineCompletionItem(text, typed.replaceRange, {
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
