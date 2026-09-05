import * as vscode from "vscode";
import { applyChange, formatEditHunk, limitHistory } from "./hunks";
import { snippetAround, type RecentSnippet } from "./next-edit";
import { displayPath, isTrackedScheme } from "./vscode-context";

const MAX_SNAPSHOTS = 50;

/**
 * Records document edits as unidiff blocks for the next-edit prompt's
 * `<|edit_diff_history|>` section. Removals are recovered by replaying
 * content changes against a cached per-document snapshot, so the first edit
 * after activation records additions only.
 */
export class EditHistoryTracker implements vscode.Disposable {
  private readonly snapshots = new Map<string, { version: number; text: string }>();
  private blocks: string[] = [];
  private maxEntries: number;
  private readonly subscription: vscode.Disposable;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
    this.subscription = vscode.workspace.onDidChangeTextDocument((event) => this.record(event));
  }

  dispose(): void {
    this.subscription.dispose();
  }

  /** Sets the number of history hunks sent with requests. */
  setDepth(maxEntries: number): void {
    this.maxEntries = maxEntries;
  }

  /** Pre-formatted unidiff blocks, oldest first, most recent last. */
  history(): string[] {
    return limitHistory(this.blocks, this.maxEntries);
  }

  private record(event: vscode.TextDocumentChangeEvent): void {
    if (!event.contentChanges.length || !isTrackedScheme(event.document.uri)) return;
    const key = event.document.uri.toString();
    const path = displayPath(event.document.uri);
    const previous = this.snapshots.get(key)?.text;
    let text = previous;
    for (const change of event.contentChanges) {
      if (text === undefined) {
        if (change.text) {
          this.push(formatEditHunk({ path, startLine: change.range.start.line, removed: "", added: change.text }));
        }
        continue;
      }
      const removed = text.slice(change.rangeOffset, change.rangeOffset + change.rangeLength);
      if (removed || change.text) {
        this.push(formatEditHunk({ path, startLine: change.range.start.line, removed, added: change.text }));
      }
      text = applyChange(text, change);
    }
    this.snapshots.set(key, { version: event.document.version, text: event.document.getText() });
    if (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next();
      if (!oldest.done) this.snapshots.delete(oldest.value);
    }
  }

  private push(block: string): void {
    this.blocks.push(block);
    if (this.maxEntries > 0 && this.blocks.length > this.maxEntries) {
      this.blocks = this.blocks.slice(-this.maxEntries);
    }
    if (this.blocks.length > 20) this.blocks = this.blocks.slice(-20);
  }
}

/**
 * Tracks short excerpts around recent cursor positions in other files for
 * the next-edit prompt's `<|recently_viewed_code_snippets|>` section.
 */
export class RecentSnippetsTracker implements vscode.Disposable {
  private entries: RecentSnippet[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly contextLines: number,
    private readonly maxEntries: number,
  ) {
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor((editor) => this.schedule(editor)),
      vscode.window.onDidChangeTextEditorSelection((event) => this.schedule(event.textEditor)),
    ];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    if (this.timer) clearTimeout(this.timer);
  }

  /** Most recent snippets from files other than `excludePath`, latest first. */
  recent(excludePath: string | undefined, count: number): RecentSnippet[] {
    return this.entries.filter((entry) => entry.path !== excludePath).slice(0, Math.max(0, count));
  }

  private schedule(editor: vscode.TextEditor | undefined): void {
    if (!editor || !isTrackedScheme(editor.document.uri)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.capture(editor), 400);
  }

  private capture(editor: vscode.TextEditor): void {
    if (editor.document.isClosed) return;
    const path = displayPath(editor.document.uri);
    const snippet = snippetAround(editor.document.getText(), editor.selection.active.line, this.contextLines);
    const latest = this.entries[0];
    if (latest && latest.path === path && latest.snippet === snippet) return;
    this.entries = this.entries.filter((entry) => entry.path !== path);
    this.entries.unshift({ path, snippet });
    if (this.entries.length > this.maxEntries) this.entries = this.entries.slice(0, this.maxEntries);
  }
}