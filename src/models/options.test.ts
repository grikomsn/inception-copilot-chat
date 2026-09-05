import assert from "node:assert/strict";
import test from "node:test";
import { applyReasoningEffort, resolveReasoningEffort, REASONING_EFFORTS, buildModelConfigurationSchema } from "./options";
test("supports the documented four reasoning levels and picker precedence", () => {
  for (const effort of REASONING_EFFORTS) assert.deepEqual(applyReasoningEffort({model:"mercury-2"}, effort), {model:"mercury-2",reasoning_effort:effort});
  assert.equal(resolveReasoningEffort({reasoningEffort:"instant"}, "high"), "instant");
  assert.equal(resolveReasoningEffort(undefined, "invalid"), "medium");
  assert.deepEqual(buildModelConfigurationSchema().properties.reasoningEffort.enum, [...REASONING_EFFORTS]);
});
