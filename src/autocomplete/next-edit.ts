export const SNIPPETS_START = "<|recently_viewed_code_snippets|>";
export const SNIPPET_START = "<|recently_viewed_code_snippet|>";
export const SNIPPET_END = "<|/recently_viewed_code_snippet|>";
export const SNIPPETS_END = "<|/recently_viewed_code_snippets|>";
export const FILE_START = "<|current_file_content|>";
export const FILE_END = "<|/current_file_content|>";
export const CODE_TO_EDIT_START = "<|code_to_edit|>";
export const CODE_TO_EDIT_END = "<|/code_to_edit|>";
export const CURSOR_TAG = "<|cursor|>";
export const HISTORY_START = "<|edit_diff_history|>";
export const HISTORY_END = "<|/edit_diff_history|>";
export const NO_SUGGESTION = "None";

export interface RecentSnippet {
  readonly path: string;
  readonly snippet: string;
}

export interface EditHistoryInput {
  /** Pre-formatted unidiff blocks, oldest first, most recent last. */
  readonly blocks: readonly string[];
}

export interface NextEditPromptInput {
  readonly currentFilePath: string;
  readonly fileContent: string;
  /** Offsets of `<|code_to_edit|>` region within `fileContent`. */
  readonly regionStart: number;
  readonly regionEnd: number;
  /** Cursor offset within `fileContent`; must fall inside the region. */
  readonly cursorOffset: number;
  readonly recentSnippets: readonly RecentSnippet[];
  readonly history: readonly string[];
}

/**
 * Builds the Mercury Edit next-edit prompt: recently viewed snippets, the
 * current file with the editable region and inline cursor marker, and the
 * time-ordered edit history (most recent last). Empty sections still include
 * their empty tag pair, per the documented format.
 */
export function buildNextEditPrompt(input: NextEditPromptInput): string {
  const sections = [
    buildSnippetsSection(input.recentSnippets),
    buildFileSection(input),
    buildHistorySection(input.history),
  ];
  return sections.join("\n\n");
}

function buildSnippetsSection(snippets: readonly RecentSnippet[]): string {
  const body = snippets.map((snippet) => [
    SNIPPET_START,
    `code_snippet_file_path: ${snippet.path}`,
    snippet.snippet,
    SNIPPET_END,
  ].join("\n")).join("\n\n");
  return `${SNIPPETS_START}\n${body}\n${SNIPPETS_END}`;
}

function buildFileSection(input: NextEditPromptInput): string {
  const { fileContent, regionStart, regionEnd, cursorOffset } = input;
  const before = fileContent.slice(0, regionStart);
  const region = fileContent.slice(regionStart, regionEnd);
  const after = fileContent.slice(regionEnd);
  const cursorIndex = Math.min(Math.max(0, cursorOffset - regionStart), region.length);
  const regionWithCursor = `${region.slice(0, cursorIndex)}${CURSOR_TAG}${region.slice(cursorIndex)}`;
  return [
    FILE_START,
    `current_file_path: ${input.currentFilePath}`,
    `${before}${CODE_TO_EDIT_START}\n${regionWithCursor}\n${CODE_TO_EDIT_END}${after}`,
    FILE_END,
  ].join("\n");
}

function buildHistorySection(blocks: readonly string[]): string {
  const body = blocks.join("\n\n");
  return `${HISTORY_START}\n${body}\n${HISTORY_END}`;
}

/**
 * Selects the editable region around the cursor line: roughly one third of
 * the lines above and the rest below, mirroring the documented
 * `[currentLine - 5, currentLine + 10]` guidance for a 15-line region.
 */
export function selectEditableRegion(
  lineCount: number,
  cursorLine: number,
  editableLines: number,
): { startLine: number; endLine: number } {
  const size = Math.max(1, Math.floor(editableLines));
  const above = Math.max(0, Math.round((size - 1) / 3));
  const below = size - 1 - above;
  const startLine = Math.min(Math.max(0, cursorLine - above), Math.max(0, lineCount - 1));
  const endLine = Math.min(lineCount - 1, Math.max(startLine, cursorLine + below));
  return { startLine, endLine };
}

/** Offsets of each line start in `text` (line 0 starts at offset 0). */
export function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.codePointAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Parses the raw next-edit response: strips the surrounding code fence and
 * treats the documented `None` sentinel (or blank output) as no suggestion.
 */
export function parseNextEditResponse(raw: string): string | undefined {
  let text = typeof raw === "string" ? raw : "";
  const opening = /^```[^\n]*\n/.exec(text);
  if (opening && text.endsWith("\n```")) text = text.slice(opening[0].length, -4);
  text = text.trim();
  if (!text || text === NO_SUGGESTION) return undefined;
  return text;
}

export interface RegionReplacement {
  /** Leading characters shared by the old and new region text. */
  readonly prefixLen: number;
  /** Trailing characters shared by the old and new region text. */
  readonly suffixLen: number;
  readonly removed: string;
  readonly added: string;
}

/** Reduces the old and new region text to the minimal middle replacement. */
export function computeRegionReplacement(oldText: string, newText: string): RegionReplacement {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) prefixLen++;
  const maxSuffix = maxPrefix - prefixLen;
  let suffixLen = 0;
  while (suffixLen < maxSuffix && oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]) suffixLen++;
  return {
    prefixLen,
    suffixLen,
    removed: oldText.slice(prefixLen, oldText.length - suffixLen),
    added: newText.slice(prefixLen, newText.length - suffixLen),
  };
}

export type EditDecision =
  | { readonly kind: "insert"; readonly startOffset: number; readonly text: string }
  | { readonly kind: "replace"; readonly startOffset: number; readonly endOffset: number; readonly text: string }
  | { readonly kind: "skip"; readonly reason: string };

export type ExpressibleDecision = Exclude<EditDecision, { kind: "skip" }>;

export interface RegionGeometry {
  /** Absolute document offsets of the editable region. */
  readonly regionStart: number;
  readonly regionEnd: number;
  /** Maps a document offset to its zero-based line. */
  readonly lineOf: (offset: number) => number;
  /** Whether an offset sits at the end of its line. */
  readonly isEndOfLine: (offset: number) => boolean;
}

/**
 * Maps the model's updated region onto what the stable inline-completion API
 * can express: zero-width insertions anywhere, and replacements whose removed
 * range stays on one line (ending at end-of-line when the replacement itself
 * spans multiple lines). Deletions and multi-line rewrites are not
 * expressible and are skipped.
 */
export function classifyRegionEdit(replacement: RegionReplacement, geometry: RegionGeometry): EditDecision {
  const { removed, added, prefixLen, suffixLen } = replacement;
  if (!removed && !added) return { kind: "skip", reason: "no change" };
  const startOffset = geometry.regionStart + prefixLen;
  const endOffset = geometry.regionEnd - suffixLen;
  if (!added) return { kind: "skip", reason: "deletion is not expressible" };
  if (!removed) return { kind: "insert", startOffset, text: added };

  const startLine = geometry.lineOf(startOffset);
  const endLine = geometry.lineOf(endOffset);
  if (startLine !== endLine) return { kind: "skip", reason: "multi-line rewrite is not expressible" };
  if (added.includes("\n") && !geometry.isEndOfLine(endOffset)) {
    return { kind: "skip", reason: "multi-line replacement must end at end-of-line" };
  }
  return { kind: "replace", startOffset, endOffset, text: added };
}

/** Extracts a short excerpt of lines around a cursor line for snippets. */
export function snippetAround(text: string, cursorLine: number, contextLines: number): string {
  const lines = text.split("\n");
  const start = Math.max(0, cursorLine - Math.max(0, contextLines));
  const end = Math.min(lines.length, cursorLine + Math.max(0, contextLines) + 1);
  return lines.slice(start, end).join("\n");
}