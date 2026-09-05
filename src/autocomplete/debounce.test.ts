import assert from "node:assert/strict";
import test from "node:test";
import { CompletionDebouncer } from "./debounce";

test("resolves true for a solo caller after the delay", async () => {
  const debouncer = new CompletionDebouncer();
  try {
    const started = Date.now();
    assert.equal(await debouncer.delay(20), true);
    assert.ok(Date.now() - started >= 15);
  } finally {
    debouncer.dispose();
  }
});

test("supersedes an earlier pending caller", async () => {
  const debouncer = new CompletionDebouncer();
  try {
    const first = debouncer.delay(30);
    const second = debouncer.delay(30);
    assert.equal(await first, false);
    assert.equal(await second, true);
  } finally {
    debouncer.dispose();
  }
});

test("handles a zero delay immediately", async () => {
  const debouncer = new CompletionDebouncer();
  try {
    assert.equal(await debouncer.delay(0), true);
  } finally {
    debouncer.dispose();
  }
});
