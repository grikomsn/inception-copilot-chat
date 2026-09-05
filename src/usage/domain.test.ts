import assert from "node:assert/strict";
import test from "node:test";
import {
  compactTokens,
  estimateCostUsdNanos,
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  formatUsdNanos,
  mergeUsageError,
  mergeUsageSnapshots,
  recordRequestUsage,
  toProviderUsagePayload,
  type InceptionUsageSnapshot,
} from "./domain";

test("normalizes Inception OpenAI-compatible usage for VS Code", () => {
  assert.deepEqual(toProviderUsagePayload({
    prompt_tokens: 140,
    completion_tokens: 2,
    total_tokens: 142,
    prompt_tokens_details: { cached_tokens: 64 },
    completion_tokens_details: { reasoning_tokens: 1 },
  }), {
    prompt_tokens: 140,
    completion_tokens: 2,
    total_tokens: 142,
    prompt_tokens_details: { cached_tokens: 64 },
    completion_tokens_details: { reasoning_tokens: 1 },
  });
});

test("accepts alternate token names and derives totals", () => {
  assert.deepEqual(toProviderUsagePayload({ input_tokens: 8, output_tokens: 3 }), {
    prompt_tokens: 8,
    completion_tokens: 3,
    total_tokens: 11,
  });
});

test("accepts flat cached and reasoning token fields", () => {
  const payload = toProviderUsagePayload({
    prompt_tokens: 26451,
    completion_tokens: 992,
    total_tokens: 27447,
    cached_input_tokens: 111441,
    reasoning_tokens: 3805,
  });
  assert.equal(payload.prompt_tokens_details?.cached_tokens, 111441);
  assert.equal(payload.completion_tokens_details?.reasoning_tokens, 3805);
  assert.deepEqual(toProviderUsagePayload({ prompt_tokens: 10, cached_input_tokens: "bogus" }), {
    prompt_tokens: 10,
  });
});

test("estimates cost from published Mercury rates", () => {
  assert.equal(estimateCostUsdNanos({
    prompt_tokens: 1000,
    completion_tokens: 100,
    prompt_tokens_details: { cached_tokens: 400 },
  }), 235_000);
  assert.equal(estimateCostUsdNanos({ prompt_tokens: 1000 }), undefined);
  assert.equal(estimateCostUsdNanos({
    prompt_tokens: 100,
    completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 900 },
  }), 10_000);
});

test("accumulates tracked usage across requests", () => {
  const first = recordRequestUsage(undefined, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, "mercury-2", 1000);
  const second = recordRequestUsage(first, {
    prompt_tokens: 500,
    completion_tokens: 50,
    total_tokens: 550,
    prompt_tokens_details: { cached_tokens: 200 },
    completion_tokens_details: { reasoning_tokens: 10 },
  }, "mercury-2", 2000);
  assert.deepEqual(second.tracked, {
    requests: 2,
    promptTokens: 1500,
    completionTokens: 150,
    totalTokens: 1650,
    cachedTokens: 200,
    reasoningTokens: 10,
    costUsdNanos: 325_000 + 117_500,
  });
  assert.equal(second.lastRequest?.recordedAt, 2000);
  assert.equal(second.lastRequest?.costUsdNanos, 117_500);
  assert.equal(second.updatedAt, 2000);
});

test("records errors without losing tracked usage", () => {
  const tracked = recordRequestUsage(undefined, { prompt_tokens: 10, completion_tokens: 5 }, "mercury-2", 1000);
  const failed = mergeUsageError(tracked, "Inception request failed for mercury-2 (HTTP 402)", 2000);
  assert.equal(failed.error, "Inception request failed for mercury-2 (HTTP 402)");
  assert.equal(failed.tracked?.requests, 1);
  assert.equal(failed.updatedAt, 2000);
});

test("merges snapshots across credentials", () => {
  const legacy: InceptionUsageSnapshot = recordRequestUsage(undefined, { prompt_tokens: 100, completion_tokens: 10 }, "mercury-2", 1000);
  const entry: InceptionUsageSnapshot = recordRequestUsage(undefined, { prompt_tokens: 50, completion_tokens: 5 }, "mercury-2", 3000);
  const merged = mergeUsageSnapshots([
    legacy,
    entry,
    mergeUsageError(undefined, "HTTP 429", 2000),
  ]);
  assert.equal(merged.tracked?.requests, 2);
  assert.equal(merged.tracked?.totalTokens, 165);
  assert.equal(merged.lastRequest?.recordedAt, 3000);
  assert.equal(merged.error, "HTTP 429");
  assert.equal(merged.updatedAt, 3000);
  assert.deepEqual(mergeUsageSnapshots([]), {});
});

test("formats the status bar for tracked, errored, and fresh sessions", () => {
  const tracked = recordRequestUsage(undefined, { prompt_tokens: 1_400_000, completion_tokens: 100_000, total_tokens: 1_500_000 }, "mercury-2", 1000);
  assert.equal(formatUsageStatusBar(tracked), "$(graph) Inception 1.5M");
  assert.equal(formatUsageStatusBar({}), "$(sparkle) Inception");
  assert.equal(formatUsageStatusBar({}, false), "$(key) Inception");
  assert.equal(formatUsageStatusBar(mergeUsageError(undefined, "HTTP 402")), "$(warning) Inception usage");
});

test("formats tooltip and display rows", () => {
  const snapshot = recordRequestUsage(undefined, {
    prompt_tokens: 26451,
    completion_tokens: 992,
    total_tokens: 27447,
    prompt_tokens_details: { cached_tokens: 100 },
    completion_tokens_details: { reasoning_tokens: 4 },
  }, "mercury-2", 1_760_000_000_000);
  const tooltip = formatUsageTooltip(snapshot);
  assert.match(tooltip, /Tokens: 27,447 across 1 request/);
  assert.match(tooltip, /Estimated spend: \$0\.007334/);
  assert.match(tooltip, /dashboard is authoritative/);

  const rows = formatUsageRows(snapshot);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "tracked");
  assert.match(rows[0].description, /27\.4K tokens across 1 request/);
  assert.equal(rows[1].kind, "estimate");
  assert.equal(rows[1].description, "$0.007334");
  assert.equal(rows[2].kind, "request");

  const errored = mergeUsageError(undefined, "HTTP 402");
  assert.equal(formatUsageRows(errored)[0].kind, "warning");
  assert.equal(formatUsageRows(errored)[0].detail, "HTTP 402");
  assert.deepEqual(formatUsageRows({}), [{
    kind: "empty",
    label: "No usage recorded yet",
    description: "Use Mercury in Copilot Chat or accept an inline suggestion",
  }]);
  assert.match(formatUsageTooltip(mergeUsageError(undefined, "HTTP 402")), /request error/);
});

test("formats money and token counts compactly", () => {
  assert.equal(formatUsdNanos(235_000), "$0.000235");
  assert.equal(formatUsdNanos(23_500_000), "$0.0235");
  assert.equal(formatUsdNanos(235_000_000), "$0.23");
  assert.equal(formatUsdNanos(0), "$0.00");
  assert.equal(formatUsdNanos(500), "<$0.000001");
  assert.equal(compactTokens(649_083), "649.1K");
  assert.equal(compactTokens(1_500_000), "1.5M");
  assert.equal(compactTokens(999), "999");
});
