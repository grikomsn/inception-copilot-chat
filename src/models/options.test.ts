import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReasoningEffort,
  resolveReasoningEffort,
  REASONING_EFFORTS,
  buildModelConfigurationSchema,
  contextSizeOptions,
  resolveContextCap,
  resolveContextSize,
} from "./options";
test("supports the documented four reasoning levels and picker precedence", () => {
  for (const effort of REASONING_EFFORTS) assert.deepEqual(applyReasoningEffort({model:"mercury-2"}, effort), {model:"mercury-2",reasoning_effort:effort});
  assert.equal(resolveReasoningEffort({reasoningEffort:"instant"}, "high"), "instant");
  assert.equal(resolveReasoningEffort(undefined, "invalid"), "medium");
  assert.deepEqual(buildModelConfigurationSchema().properties.reasoningEffort.enum, [...REASONING_EFFORTS]);
});

test("offers context tiers below the registered input limit", () => {
  assert.deepEqual(contextSizeOptions(128_000)?.map((option) => option.value), [0, 65_536, 128_000]);
  assert.deepEqual(contextSizeOptions(128_000)?.map((option) => option.label), ["Auto", "64K", "Maximum"]);
  assert.equal(contextSizeOptions(65_536), undefined);
  assert.equal(contextSizeOptions(32_000), undefined);
});

test("resolves the effective context cap from the selected tier", () => {
  assert.equal(resolveContextCap(65_536, 128_000), 65_536);
  assert.equal(resolveContextCap(200_000, 128_000), undefined);
  assert.equal(resolveContextCap(0, 128_000), undefined);
  assert.equal(resolveContextCap(65_536, 65_536), undefined);
});

test("reads the context size from picker configuration", () => {
  assert.equal(resolveContextSize({ contextSize: 65_536 }), 65_536);
  assert.equal(resolveContextSize({ contextSize: 0 }), 0);
  assert.equal(resolveContextSize({ contextSize: "65536" }), 0);
  assert.equal(resolveContextSize(undefined), 0);
});

test("exposes the Context Window control alongside reasoning levels", () => {
  const schema = buildModelConfigurationSchema("medium", contextSizeOptions(128_000));
  assert.deepEqual(schema.properties.reasoningEffort.enum, [...REASONING_EFFORTS]);
  assert.deepEqual(schema.properties.contextSize.enum, [0, 65_536, 128_000]);
  assert.equal(schema.properties.contextSize.default, 0);
  assert.equal(schema.properties.contextSize.group, "navigation");

  const plain = buildModelConfigurationSchema("medium");
  assert.equal("contextSize" in plain.properties, false);
});
