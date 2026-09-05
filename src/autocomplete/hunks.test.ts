import assert from "node:assert/strict";
import test from "node:test";
import { applyChange, countLines, formatEditHunk, limitHistory } from "./hunks";

test("formats a unidiff hunk with removals and additions", () => {
  const block = formatEditHunk({ path: "src/a.ts", startLine: 5, removed: "old line", added: "new\nlines" });
  assert.equal(block, [
    "--- src/a.ts",
    "+++ src/a.ts",
    "@@ -6,1 +6,2 @@",
    "-old line",
    "+new",
    "+lines",
  ].join("\n"));
});

test("formats insertion-only and deletion-only hunks", () => {
  assert.equal(
    formatEditHunk({ path: "b.py", startLine: 0, removed: "", added: "new" }),
    "--- b.py\n+++ b.py\n@@ -1,0 +1,1 @@\n+new",
  );
  assert.equal(
    formatEditHunk({ path: "b.py", startLine: 2, removed: "gone", added: "" }),
    "--- b.py\n+++ b.py\n@@ -3,1 +3,0 @@\n-gone",
  );
});

test("applies content changes sequentially to a snapshot", () => {
  const text = "alpha\nbeta\ngamma";
  const afterFirst = applyChange(text, { rangeOffset: 6, rangeLength: 4, text: "BETA" });
  assert.equal(afterFirst, "alpha\nBETA\ngamma");
  const second = applyChange(afterFirst, { rangeOffset: afterFirst.length, rangeLength: 0, text: "\ndelta" });
  assert.equal(second, "alpha\nBETA\ngamma\ndelta");
});

test("counts lines including blank text", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("one"), 1);
  assert.equal(countLines("one\ntwo\nthree"), 3);
  assert.equal(countLines("one\n"), 2);
});

test("limits history to the most recent entries", () => {
  const blocks = ["a", "b", "c"];
  assert.deepEqual(limitHistory(blocks, 2), ["b", "c"]);
  assert.deepEqual(limitHistory(blocks, 5), ["a", "b", "c"]);
  assert.deepEqual(limitHistory(blocks, 0), []);
});