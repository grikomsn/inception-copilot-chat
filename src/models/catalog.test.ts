import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_MODEL_METADATA, FALLBACK_MODELS, formatModelName, getModelMetadata, orderModelMetadata, resolveMaxOutputTokens } from "./catalog";

test("uses live chat models and their advertised limits without merging fallbacks", () => {
  assert.deepEqual(orderModelMetadata([]), []);
  const models = orderModelMetadata([
    { id: "mercury-2", context_length: 128000, max_output_length: 50000 },
    { id: "mercury-2.5", context_length: 260000, max_output_length: 65536 },
    { id: "mercury-edit-2" },
  ]);
  assert.deepEqual(models.map((model) => model.id), ["mercury-2.5", "mercury-2"]);
  assert.equal(models[0].contextLength, 260000);
  assert.equal(models[0].maxOutputTokens, 65536);
  assert.equal(models[1].contextLength, 128000);
  assert.equal(models[1].maxOutputTokens, 50000);
});
test("rejects malformed metadata and clamps requested output", () => {
  assert.deepEqual(orderModelMetadata([{ id: 1 }]), []);
  assert.equal(orderModelMetadata([{ id: "mercury-2", context_length: -1 }])[0].contextLength, 128000);
  assert.equal(orderModelMetadata([{ id: "mercury-2.5", context_length: -1 }])[0].contextLength, 260000);
  assert.equal(resolveMaxOutputTokens(100000, 50000), 50000);
});
test("parses live pricing and falls back to documented Mercury rates", () => {
  const models = orderModelMetadata([{
    id: "mercury-2.5",
    context_length: 260000,
    max_output_length: 65536,
    pricing: { prompt: "0.00000004", completion: "0.00000015", input_cache_reads: "0.000000004", input_cache_writes: "0" },
  }]);
  assert.deepEqual(models[0].cost, { input: 0.04, cacheRead: 0.004, output: 0.15 });
  const unpriced = orderModelMetadata([{ id: "mercury-2", pricing: "bogus" }]);
  assert.deepEqual(unpriced[0].cost, getModelMetadata("mercury-2").cost);
  const unknownModel = orderModelMetadata([{ id: "mercury-9" }]);
  assert.equal(unknownModel[0].cost, undefined);
});
test("keeps Mercury 2.5 as the preferred fallback chat model", () => {
  assert.deepEqual(FALLBACK_MODELS, ["mercury-2.5", "mercury-2"]);
  assert.deepEqual(FALLBACK_MODEL_METADATA.map((model) => model.id), ["mercury-2.5", "mercury-2"]);
  assert.equal(formatModelName("mercury-2.5"), "Mercury 2.5");
  assert.equal(getModelMetadata("mercury-2.5").version, "2.5");
});
