import * as vscode from "vscode";
import { messageOf } from "../errors";
import { EditClient } from "../transport/edit";
import { resolveNextEditSettings, type NextEditSettings } from "./config";
import { estimateTokens, trimLinesFromBottom, trimLinesFromTop } from "./context";
import { CompletionDebouncer } from "./debounce";
import {
  buildNextEditPrompt,
  classifyRegionEdit,
  computeRegionReplacement,
  lineStartOffsets,
  parseNextEditResponse,
  selectEditableRegion,
  type ExpressibleDecision,
  type RegionGeometry,
} from "./next-edit";
import { EditHistoryTracker, RecentSnippetsTracker } from "./tracker";
import { displayPath, hasMultipleSelections, isTrackedScheme } from "./vscode-context";

export const NEXT_EDIT_ACCEPTED_COMMAND = "inceptionCopilot.nextEdit.accepted";

export type ApiKeyResolver = () => Promise<string | undefined>;

const MAX_SNIPPETS = 5;

interface PromptPlan {
  readonly content: string;
  /** Editable-region offsets in the real document. */
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly oldRegion: string;
}

/**
 * Next-edit inline suggestions backed by the Inception edit endpoint. The
 * prompt combines recently viewed snippets, the current file with a
 * cursor-centered editable region, and the recent edit history; the response
 * is mapped onto the insertion and single-line replacement shapes that the
 * stable inline-completion API can express.
 */
export class MercuryNextEditProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly debouncer = new CompletionDebouncer();
  private readonly inFlight = new Set<AbortController>();
  private missingKeyLogged = false;
  private _lastSuggestionId: string | undefined;

  constructor(
    private readonly resolveApiKey: ApiKeyResolver,
    private readonly edit: EditClient,
    private readonly editHistory: EditHistoryTracker,
    private readonly recentSnippets: RecentSnippetsTracker,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Response id of the most recently returned suggestion, for feedback. */
  lastSuggestionId(): string | undefined {
    return this._lastSuggestionId;
  }

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
    const settings = resolveNextEditSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
    if (!settings.enabled || token.isCancellationRequested) return undefined;
    if (!isTrackedScheme(document.uri)) return undefined;
    if (hasMultipleSelections(document)) return undefined;
    if (context.selectedCompletionInfo) return undefined;

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
    const plan = this.planPrompt(document, position, settings);
    return await this.fetchSuggestion(settings, apiKey, document, document.version, plan, token);
  }

  private planPrompt(
    document: vscode.TextDocument,
    position: vscode.Position,
    settings: NextEditSettings,
  ): PromptPlan {
    const fullText = document.getText();
    const { startLine, endLine } = selectEditableRegion(document.lineCount, position.line, settings.editableLines);
    const lineStarts = lineStartOffsets(fullText);
    const regionStart = lineStarts[startLine];
    const regionEnd = endLine >= document.lineCount - 1 ? fullText.length : lineStarts[endLine + 1] - 1;
    const context = trimFileContext(fullText, regionStart, regionEnd, document.offsetAt(position), settings.maxPromptTokens);
    const currentFilePath = displayPath(document.uri);
    const content = buildNextEditPrompt({
      currentFilePath,
      fileContent: context.fileContent,
      regionStart: context.regionStart,
      regionEnd: context.regionEnd,
      cursorOffset: context.cursorOffset,
      recentSnippets: this.recentSnippets.recent(currentFilePath, MAX_SNIPPETS),
      history: this.editHistory.history(),
    });
    return { content, regionStart, regionEnd, oldRegion: fullText.slice(regionStart, regionEnd) };
  }

  private async fetchSuggestion(
    settings: NextEditSettings,
    apiKey: string,
    document: vscode.TextDocument,
    documentVersion: number,
    plan: PromptPlan,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const completion = await this.edit.complete(apiKey, {
        model: settings.model,
        content: plan.content,
        maxTokens: settings.maxTokens,
      }, controller.signal);
      if (token.isCancellationRequested || controller.signal.aborted || document.version !== documentVersion) {
        return undefined;
      }
      this._lastSuggestionId = completion.id ?? undefined;
      this.logUsage(settings.model, completion, Date.now() - started);

      const newRegion = parseNextEditResponse(completion.text);
      if (!newRegion) return undefined;
      const decision = classifyRegionEdit(computeRegionReplacement(plan.oldRegion, newRegion), this.geometry(document, plan));
      if (decision.kind === "skip") {
        this.logDebug(`no expressible suggestion (${decision.reason})`);
        return undefined;
      }
      if (this.isDuplicateInsertion(document, decision)) {
        this.logDebug("suggestion text already present at the insertion point");
        return undefined;
      }
      return [this.itemOf(document, decision)];
    } catch (error) {
      if (token.isCancellationRequested || controller.signal.aborted) {
        this.logDebug(`request aborted after ${Date.now() - started}ms`);
        return undefined;
      }
      this.output.appendLine(`[next-edit] request failed: ${messageOf(error)}`);
      return undefined;
    } finally {
      clearTimeout(timeout);
      cancellation.dispose();
      this.inFlight.delete(controller);
    }
  }

  private geometry(document: vscode.TextDocument, plan: PromptPlan): RegionGeometry {
    return {
      regionStart: plan.regionStart,
      regionEnd: plan.regionEnd,
      lineOf: (offset) => document.positionAt(offset).line,
      isEndOfLine: (offset) => {
        const position = document.positionAt(offset);
        return position.isEqual(document.lineAt(position.line).range.end);
      },
    };
  }

  private itemOf(document: vscode.TextDocument, decision: ExpressibleDecision): vscode.InlineCompletionItem {
    const start = document.positionAt(decision.startOffset);
    const range = decision.kind === "insert"
      ? new vscode.Range(start, start)
      : new vscode.Range(start, document.positionAt(decision.endOffset));
    return new vscode.InlineCompletionItem(decision.text, range, {
      title: "Log suggestion acceptance",
      command: NEXT_EDIT_ACCEPTED_COMMAND,
    });
  }

  /** Guards against echoing text that already exists at the insertion point. */
  private isDuplicateInsertion(document: vscode.TextDocument, decision: ExpressibleDecision): boolean {
    if (decision.kind !== "insert") return false;
    const start = document.positionAt(decision.startOffset);
    const end = document.positionAt(decision.startOffset + decision.text.length);
    return document.getText(new vscode.Range(start, end)) === decision.text;
  }

  private warnMissingKey(): void {
    if (this.missingKeyLogged) return;
    this.missingKeyLogged = true;
    this.output.appendLine(
      "[next-edit] no Inception API key configured; run ‘Inception: Configure API Key’ or add a native provider entry",
    );
  }

  private logUsage(model: string, completion: { usage?: { promptTokens: number; completionTokens: number }; warning?: string }, elapsedMs: number): void {
    if (!this.debugLogging()) return;
    const usage = completion.usage;
    const detail = usage ? `prompt=${usage.promptTokens} output=${usage.completionTokens}` : "usage unavailable";
    const warning = completion.warning ? ` warning="${completion.warning}"` : "";
    this.output.appendLine(`[next-edit] model=${model} ${elapsedMs}ms ${detail}${warning}`);
  }

  private logDebug(message: string): void {
    if (this.debugLogging()) this.output.appendLine(`[next-edit] ${message}`);
  }

  private debugLogging(): boolean {
    return vscode.workspace.getConfiguration("inceptionCopilot").get("debugLogging", false);
  }
}

interface TrimmedContext {
  readonly fileContent: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly cursorOffset: number;
}

/**
 * Passes the whole current file when it fits the budget; otherwise keeps the
 * editable region and trims the distant context around it, matching the
 * documented guidance for large files.
 */
function trimFileContext(
  fullText: string,
  regionStart: number,
  regionEnd: number,
  cursorOffset: number,
  maxPromptTokens: number,
): TrimmedContext {
  if (estimateTokens(fullText) <= maxPromptTokens) {
    return { fileContent: fullText, regionStart, regionEnd, cursorOffset };
  }
  const regionText = fullText.slice(regionStart, regionEnd);
  const contextBudget = Math.max(0, maxPromptTokens - estimateTokens(regionText));
  const keptAbove = trimLinesFromTop(fullText.slice(0, regionStart), Math.floor(contextBudget * 0.6));
  const keptBelow = trimLinesFromBottom(fullText.slice(regionEnd), Math.floor(contextBudget * 0.4));
  return {
    fileContent: `${keptAbove}${regionText}${keptBelow}`,
    regionStart: keptAbove.length,
    regionEnd: keptAbove.length + regionText.length,
    cursorOffset: cursorOffset - regionStart + keptAbove.length,
  };
}
