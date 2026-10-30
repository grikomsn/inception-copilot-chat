import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_MODEL_METADATA, FALLBACK_MODELS, formatModelName, getModelMetadata, isRetiredModel, orderModelMetadata, orderModels, resolveMaxOutputTokens } from "./catalog";
import { MERCURY_3_MODEL_COST } from "./pricing";

test("uses live chat models and their advertised limits without merging fallbacks", () => {
  assert.deepEqual(orderModelMetadata([]), []);
  // Decide serves a separate decision endpoint and never chat completions.
  assert.deepEqual(orderModelMetadata([{ id: "mercury-decide" }]), []);
  const models = orderModelMetadata([
    { id: "mercury-3", context_length: 1000000, max_output_length: 131072 },
    { id: "mercury-edit-2" },
  ]);
  assert.deepEqual(models.map((model) => model.id), ["mercury-3"]);
  assert.equal(models[0].contextLength, 1000000);
  assert.equal(models[0].maxOutputTokens, 131072);
});
test("rejects malformed metadata and clamps requested output", () => {
  assert.deepEqual(orderModelMetadata([{ id: 1 }]), []);
  assert.equal(resolveMaxOutputTokens(100000, 50000), 50000);
});
test("filters retired Mercury 2 and 2.5 out of live and fallback catalogs", () => {
  for (const retired of ["mercury-2", "mercury-2.5", "MERCURY-2.5"]) {
    assert.equal(isRetiredModel(retired), true, retired);
    assert.deepEqual(orderModels([retired]), [], retired);
    assert.deepEqual(orderModelMetadata([{ id: retired, context_length: 260000, max_output_length: 65536 }]), [], retired);
  }
  // Mercury 3 stays and remains the replacement.
  assert.equal(isRetiredModel("mercury-3"), false);
  assert.deepEqual(orderModels(["mercury-3", "mercury-2.5"]), ["mercury-3"]);
  // Retired ids never re-enter the bundled fallback catalog.
  assert.equal(FALLBACK_MODELS.includes("mercury-2" as never), false);
  assert.equal(FALLBACK_MODELS.includes("mercury-2.5" as never), false);
  assert.equal(FALLBACK_MODEL_METADATA.some((model) => model.id === "mercury-2"), false);
  assert.equal(FALLBACK_MODEL_METADATA.some((model) => model.id === "mercury-2.5"), false);
});
test("parses live pricing and falls back to documented Mercury rates", () => {
  const models = orderModelMetadata([{
    id: "mercury-3",
    context_length: 1000000,
    max_output_length: 131072,
    pricing: { prompt: "0.00000005", completion: "0.0000002", input_cache_reads: "0.000000005", input_cache_writes: "0" },
  }]);
  assert.deepEqual(models[0].cost, { input: 0.05, cacheRead: 0.005, output: 0.2 });
  const unknownModel = orderModelMetadata([{ id: "mercury-9" }]);
  assert.equal(unknownModel[0].cost, undefined);
});
test("substitutes published Mercury 3 rates for all-zero live placeholders", () => {
  const models = orderModelMetadata([{
    id: "mercury-3",
    context_length: 1000000,
    max_output_length: 131072,
    pricing: { prompt: "0", completion: "0", input_cache_reads: "0", input_cache_writes: "0" },
  }]);
  assert.deepEqual(models[0], {
    id: "mercury-3",
    version: "3",
    contextLength: 1_000_000,
    maxOutputTokens: 131_072,
    cost: { input: 0.1, cacheRead: 0.01, output: 0.35 },
  });
});
test("keeps Mercury 3 as the only fallback chat model", () => {
  assert.deepEqual(FALLBACK_MODELS, ["mercury-3"]);
  assert.deepEqual(FALLBACK_MODEL_METADATA.map((model) => model.id), ["mercury-3"]);
  assert.equal(formatModelName("mercury-3"), "Mercury 3");
  assert.equal(getModelMetadata("mercury-3").version, "3");
  assert.deepEqual(getModelMetadata("mercury-3").cost, MERCURY_3_MODEL_COST);
});
