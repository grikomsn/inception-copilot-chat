/**
 * Pure helpers for building the next-edit `edit_diff_history` section and for
 * replaying content changes against a cached document snapshot.
 */

export interface ContentChange {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

export interface RecordedHunk {
  readonly path: string;
  /** Zero-based line where the change begins in the pre-change document. */
  readonly startLine: number;
  readonly removed: string;
  readonly added: string;
}

/** Applies one content change to a document snapshot, returning the new text. */
export function applyChange(text: string, change: ContentChange): string {
  return text.slice(0, change.rangeOffset) + change.text + text.slice(change.rangeOffset + change.rangeLength);
}

/** Counts lines in a text block; empty text has zero lines. */
export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.codePointAt(i) === 10) lines++;
  }
  return lines;
}

/** Formats one recorded change as a unidiff block for the edit history. */
export function formatEditHunk(hunk: RecordedHunk): string {
  const removedLines = splitLines(hunk.removed);
  const addedLines = splitLines(hunk.added);
  const startLine = Math.max(0, hunk.startLine) + 1;
  const header = `@@ -${startLine},${removedLines.length} +${startLine},${addedLines.length} @@`;
  const body = [
    ...removedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
  return [`--- ${hunk.path}`, `+++ ${hunk.path}`, header, body].filter(Boolean).join("\n");
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

/** Bounds a formatted history to the most recent entries, oldest first. */
export function limitHistory(blocks: readonly string[], maxEntries: number): string[] {
  if (maxEntries <= 0) return [];
  return blocks.slice(-maxEntries);
}