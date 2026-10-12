import assert from "node:assert/strict";
import test from "node:test";
import { applyReasoningEffort, buildModelConfigurationSchema, contextSizeOptions, resolveReasoningEffort } from "./options";

// VS Code 1.141 reads reasoningEffort, then filters through its agent-host tiers.
const SDK_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

test("Copilot SDK BYOK discovers Inception's standard tiers while Local chat retains Instant", () => {
  for (const context of [undefined, contextSizeOptions(78_000)]) {
    const schema = buildModelConfigurationSchema("medium", context);
    const effortSchema = schema.properties.reasoningEffort;
    assert.ok(effortSchema, "BYOK requires reasoningEffort");
    const bridged = (effortSchema.enum as unknown[]).filter((value): value is string => typeof value === "string");
    assert.deepEqual(bridged, ["instant", "low", "medium", "high"]);
    assert.deepEqual(bridged.filter((effort) => SDK_EFFORTS.has(effort)), ["low", "medium", "high"]);
    assert.equal(effortSchema.default, "medium");
  }
});

test("Copilot SDK effort selections override Inception defaults without changing native values", () => {
  const schema = buildModelConfigurationSchema("medium", contextSizeOptions(78_000));
  const bridged = (schema.properties.reasoningEffort.enum as unknown[]).filter((value): value is string => typeof value === "string");
  for (const selected of bridged.filter((effort) => SDK_EFFORTS.has(effort))) {
    const effort = resolveReasoningEffort({ reasoningEffort: selected }, "medium");
    assert.equal(effort, selected);
    assert.deepEqual(applyReasoningEffort({ model: "mercury-2" }, effort), { model: "mercury-2", reasoning_effort: selected });
  }
  assert.deepEqual(applyReasoningEffort({}, resolveReasoningEffort({ reasoningEffort: "instant" }, "high")), { reasoning_effort: "instant" });
});
