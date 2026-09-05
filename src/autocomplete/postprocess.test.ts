import assert from "node:assert/strict";
import test from "node:test";
import { postprocessCompletion } from "./postprocess";

test("passes plain completions through", () => {
  assert.equal(postprocessCompletion("fibonacci(n - 1) + fibonacci(n - 2)"), "fibonacci(n - 1) + fibonacci(n - 2)");
});

test("strips surrounding code fences with a language tag", () => {
  assert.equal(postprocessCompletion("```ts\nconst x = 1;\n```"), "const x = 1;");
  assert.equal(postprocessCompletion("```\nvalue\n```"), "value");
});

test("keeps a lone opening fence as legitimate content", () => {
  assert.equal(postprocessCompletion("```ts\nconst x = 1;"), "```ts\nconst x = 1;");
});

test("cuts at defensive stop sequences", () => {
  assert.equal(postprocessCompletion("foo()\n\nbar()", ["\n\n"]), "foo()");
  assert.equal(postprocessCompletion("foo()|END|bar()", ["|END|"]), "foo()");
  assert.equal(postprocessCompletion("foo()", []), "foo()");
});

test("trims trailing whitespace and blank lines", () => {
  assert.equal(postprocessCompletion("value = 42\n  \n\n"), "value = 42");
});

test("rejects blank or whitespace-only completions", () => {
  assert.equal(postprocessCompletion(""), undefined);
  assert.equal(postprocessCompletion("   \n\n  "), undefined);
  assert.equal(postprocessCompletion("```\n\n```"), undefined);
});
