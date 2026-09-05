import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNextEditPrompt,
  classifyRegionEdit,
  computeRegionReplacement,
  lineStartOffsets,
  parseNextEditResponse,
  selectEditableRegion,
  snippetAround,
} from "./next-edit";

test("selects a cursor-centered editable region", () => {
  assert.deepEqual(selectEditableRegion(100, 50, 15), { startLine: 45, endLine: 59 });
  // At either document edge the region clamps without redistributing lines.
  assert.deepEqual(selectEditableRegion(100, 0, 15), { startLine: 0, endLine: 9 });
  // Near the end of the file the region clamps to the last line.
  assert.deepEqual(selectEditableRegion(10, 8, 15), { startLine: 3, endLine: 9 });
  assert.deepEqual(selectEditableRegion(6, 2, 3), { startLine: 1, endLine: 3 });
});

test("builds the documented prompt sections", () => {
  const fileContent = "line0\nline1\nline2\nline3\nline4";
  const lineStarts = lineStartOffsets(fileContent);
  const cursorOffset = lineStarts[2] + 2; // inside line2
  const prompt = buildNextEditPrompt({
    currentFilePath: "src/solver.py",
    fileContent,
    regionStart: lineStarts[1],
    regionEnd: lineStarts[4] - 1, // through the end of line3
    cursorOffset,
    recentSnippets: [{ path: "other.py", snippet: "def helper():\n    pass" }],
    history: ["--- src/solver.py\n+++ src/solver.py\n@@ -1,1 +1,1 @@\n-old\n+new"],
  });

  assert.ok(prompt.includes("<|recently_viewed_code_snippets|>"));
  assert.ok(prompt.includes("code_snippet_file_path: other.py"));
  assert.ok(prompt.includes("<|/recently_viewed_code_snippet|>"));
  assert.ok(prompt.includes("<|current_file_content|>\ncurrent_file_path: src/solver.py"));
  assert.ok(prompt.includes("<|code_to_edit|>\nline1\nli<|cursor|>ne2\nline3\n<|/code_to_edit|>"));
  assert.ok(prompt.includes("<|edit_diff_history|>\n--- src/solver.py"));
  assert.ok(prompt.trimEnd().endsWith("<|/edit_diff_history|>"));
});

test("empty sections keep their tag pairs", () => {
  const prompt = buildNextEditPrompt({
    currentFilePath: "a.py",
    fileContent: "x = 1",
    regionStart: 0,
    regionEnd: 5,
    cursorOffset: 5,
    recentSnippets: [],
    history: [],
  });
  assert.ok(prompt.includes("<|recently_viewed_code_snippets|>\n\n<|/recently_viewed_code_snippets|>"));
  assert.ok(prompt.includes("<|edit_diff_history|>\n\n<|/edit_diff_history|>"));
});

test("parses fenced, None, and blank responses", () => {
  assert.equal(parseNextEditResponse("```py\nnew code\n```"), "new code");
  assert.equal(parseNextEditResponse("```\nvalue\n```"), "value");
  assert.equal(parseNextEditResponse("None"), undefined);
  assert.equal(parseNextEditResponse("   "), undefined);
  assert.equal(parseNextEditResponse("plain region"), "plain region");
  assert.equal(parseNextEditResponse("```py\npartial"), "```py\npartial");
});

test("computes the minimal middle replacement", () => {
  const replacement = computeRegionReplacement("prefix OLD suffix", "prefix NEW suffix");
  assert.equal(replacement.prefixLen, "prefix ".length);
  assert.equal(replacement.removed, "OLD");
  assert.equal(replacement.added, "NEW");
  assert.deepEqual(computeRegionReplacement("same", "same"), { prefixLen: 4, suffixLen: 0, removed: "", added: "" });
});

test("classifies expressible edits for the stable inline API", () => {
  const lineOf = (offset: number): number => offset < 10 ? 0 : offset < 20 ? 1 : 2;
  const isEndOfLine = (offset: number): boolean => offset === 9 || offset === 19 || offset === 29;

  // Pure insertion.
  const insert = classifyRegionEdit(
    { prefixLen: 5, suffixLen: 5, removed: "", added: "hello" },
    { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine },
  );
  assert.deepEqual(insert, { kind: "insert", startOffset: 5, text: "hello" });

  // Single-line replacement.
  const replace = classifyRegionEdit(
    { prefixLen: 2, suffixLen: 2, removed: "old", added: "brand new" },
    { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine },
  );
  assert.deepEqual(replace, { kind: "replace", startOffset: 2, endOffset: 8, text: "brand new" });

  // No change, deletion, and multi-line rewrite are skipped.
  assert.equal(classifyRegionEdit({ prefixLen: 5, suffixLen: 5, removed: "", added: "" }, { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine }).kind, "skip");
  assert.equal(classifyRegionEdit({ prefixLen: 0, suffixLen: 0, removed: "abc", added: "" }, { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine }).kind, "skip");
  const multiline = classifyRegionEdit(
    { prefixLen: 0, suffixLen: 0, removed: "a\nb", added: "x\ny" },
    { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine },
  );
  assert.equal(multiline.kind, "skip");

  // Multi-line replacement is allowed only when the removed range ends at end-of-line.
  const midLine = classifyRegionEdit(
    { prefixLen: 2, suffixLen: 0, removed: "old", added: "one\ntwo" },
    { regionStart: 0, regionEnd: 10, lineOf, isEndOfLine },
  );
  assert.equal(midLine.kind, "skip");
  const atEol = classifyRegionEdit(
    { prefixLen: 2, suffixLen: 0, removed: "old", added: "one\ntwo" },
    { regionStart: 10, regionEnd: 19, lineOf, isEndOfLine },
  );
  assert.deepEqual(atEol, { kind: "replace", startOffset: 12, endOffset: 19, text: "one\ntwo" });
});

test("computes line start offsets including the final line", () => {
  assert.deepEqual(lineStartOffsets("ab\ncd"), [0, 3]);
  assert.deepEqual(lineStartOffsets(""), [0]);
  assert.deepEqual(lineStartOffsets("x\n\ny"), [0, 2, 3]);
});

test("extracts a snippet around the cursor line", () => {
  const text = "l0\nl1\nl2\nl3\nl4";
  assert.equal(snippetAround(text, 2, 1), "l1\nl2\nl3");
  assert.equal(snippetAround(text, 0, 2), "l0\nl1\nl2");
  assert.equal(snippetAround(text, 4, 10), "l0\nl1\nl2\nl3\nl4");
  assert.equal(snippetAround(text, 2, 0), "l2");
});