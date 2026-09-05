import * as vscode from "vscode";

export const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["file", "untitled", "vscode-notebook-cell"]);
export const MIN_SELECTED_CHARS = 4;

export interface TypedContext {
  /** Text of the currently selected IntelliSense item, if any. */
  readonly typedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  /** Range the suggestion replaces: zero-width, or through end-of-line. */
  readonly replaceRange: vscode.Range;
}

export function isTrackedScheme(uri: vscode.Uri): boolean {
  return ALLOWED_SCHEMES.has(uri.scheme);
}

export function hasMultipleSelections(document: vscode.TextDocument): boolean {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.toString() !== document.uri.toString()) return false;
  return (editor?.selections.length ?? 0) > 1;
}

/**
 * Shared inline-completion request context: how the IntelliSense selection
 * (if any) shifts the effective prompt boundaries and which range a
 * suggestion must replace.
 */
export function resolveTypedContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: vscode.InlineCompletionContext,
): TypedContext {
  const selectedInfo = context.selectedCompletionInfo;
  const typedText = selectedInfo?.text ?? "";
  const startOffset = selectedInfo ? document.offsetAt(selectedInfo.range.start) : document.offsetAt(position);
  const endOffset = selectedInfo ? document.offsetAt(selectedInfo.range.end) : document.offsetAt(position);
  const replaceRange = selectedInfo
    ? new vscode.Range(selectedInfo.range.start, document.lineAt(position.line).range.end)
    : new vscode.Range(position, position);
  return { typedText, startOffset, endOffset, replaceRange };
}

/** Workspace-relative display path used in prompts and diagnostics. */
export function displayPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}
