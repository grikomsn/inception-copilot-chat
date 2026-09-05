import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptContext, estimateTokens, trimLinesFromBottom, trimLinesFromTop } from "./context";

test("splits text exactly at the cursor offset", () => {
  const context = buildPromptContext("const value = ", ";", 4096);
  assert.equal(context.prompt, "const value = ");
  assert.equal(context.suffix, ";");
});

test("keeps the partial cursor line when trimming the prefix", () => {
  const padding = "a".repeat(200);
  const keep = "keep-1\nkeep-2\ncursor line";
  // A 100% prefix share with a budget equal to the target keeps exactly the
  // target lines and drops the over-budget lines above them.
  const context = buildPromptContext(`${padding}\n${keep}`, "", estimateTokens(keep), 1);
  assert.equal(context.prompt, keep);
});

test("trims the suffix from the bottom and keeps the line after the cursor", () => {
  const long = "after cursor\nfiller-a\nfiller-b\nfiller-c";
  const suffix = trimLinesFromBottom(long, estimateTokens("after cursor\nfiller-a") + 2);
  assert.equal(suffix, "after cursor\nfiller-a");
});

test("hard-truncates when a single line exceeds the budget", () => {
  const huge = "x".repeat(500);
  const prompt = trimLinesFromTop(huge, 10);
  assert.ok(prompt.length <= 40);
  assert.ok(prompt.endsWith(huge.slice(-40)));

  const suffix = trimLinesFromBottom(huge, 10);
  assert.ok(suffix.length <= 40);
  assert.ok(suffix.startsWith(huge.slice(0, 40)));
});

test("returns empty text for non-positive budgets", () => {
  assert.equal(trimLinesFromTop("abc", 0), "");
  assert.equal(trimLinesFromBottom("abc", 0), "");
});

test("prefix keeps about three quarters of the budget", () => {
  const prefix = "a".repeat(3000);
  const suffix = "b".repeat(3000);
  const context = buildPromptContext(prefix, suffix, 1000);
  assert.ok(estimateTokens(context.prompt) <= 750);
  assert.ok(estimateTokens(context.suffix) <= 250);
  assert.ok(context.prompt.length > 0);
  assert.ok(context.suffix.length > 0);
});
