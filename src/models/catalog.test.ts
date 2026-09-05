import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_MODEL_METADATA, orderModelMetadata, resolveMaxOutputTokens } from "./catalog";

test("uses live chat models and their advertised limits without merging fallbacks", () => {
  assert.deepEqual(orderModelMetadata([]), []);
  const models = orderModelMetadata([{ id: "mercury-2", context_length: 128000, max_output_length: 50000 }, { id: "mercury-edit-2" }]);
  assert.equal(models.length, 1);
  assert.equal(models[0].contextLength, 128000);
  assert.equal(models[0].maxOutputTokens, 50000);
});
test("rejects malformed metadata and clamps requested output", () => {
  assert.deepEqual(orderModelMetadata([{ id: 1 }]), []);
  assert.equal(orderModelMetadata([{ id: "mercury-2", context_length: -1 }])[0].contextLength, 128000);
  assert.equal(resolveMaxOutputTokens(100000, 50000), 50000);
});
test("parses live pricing and falls back to documented Mercury rates", () => {
  const models = orderModelMetadata([{
    id: "mercury-2",
    context_length: 128000,
    max_output_length: 50000,
    pricing: { prompt: "0.00000025", completion: "0.00000075", input_cache_reads: "0.000000025", input_cache_writes: "0" },
  }]);
  assert.deepEqual(models[0].cost, { input: 0.25, cacheRead: 0.025, output: 0.75 });
  const unpriced = orderModelMetadata([{ id: "mercury-2", pricing: "bogus" }]);
  assert.deepEqual(unpriced[0].cost, FALLBACK_MODEL_METADATA[0].cost);
  const unknownModel = orderModelMetadata([{ id: "mercury-9" }]);
  assert.equal(unknownModel[0].cost, undefined);
});
