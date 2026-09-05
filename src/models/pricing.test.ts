import assert from "node:assert/strict";
import test from "node:test";
import { modelCostFromApi, modelPricingFields, costCategory, inceptionModelCost, MERCURY_MODEL_COST } from "./pricing";

test("converts Inception per-token API rates to per-million costs", () => {
  assert.deepEqual(
    modelCostFromApi({
      prompt: "0.00000025",
      completion: "0.00000075",
      input_cache_reads: "0.000000025",
      input_cache_writes: "0",
    }),
    { input: 0.25, cacheRead: 0.025, output: 0.75 },
  );
  assert.deepEqual(modelCostFromApi({ prompt: "0.0000005", completion: "0.000001" }), { input: 0.5, output: 1 });
  assert.deepEqual(modelCostFromApi({ prompt: 0.5, completion: "1" }), { input: 500_000, output: 1_000_000 });
});

test("drops malformed pricing instead of guessing", () => {
  assert.equal(modelCostFromApi(undefined), undefined);
  assert.equal(modelCostFromApi({ prompt: "0.25" }), undefined);
  assert.equal(modelCostFromApi({ prompt: "invalid", completion: "0.00000075" }), undefined);
  assert.equal(modelCostFromApi({ prompt: "-1", completion: "0.00000075" }), undefined);
  assert.equal(inceptionModelCost("mercury-2", undefined), undefined);
});

test("converts per-million rates to VS Code pricing fields", () => {
  assert.deepEqual(
    modelPricingFields({ input: 0.25, cacheRead: 0.025, output: 0.75 }),
    {
      pricing: "In: $0.25 · Out: $0.75 /1M tokens",
      inputCost: 25,
      outputCost: 75,
      cacheCost: 3,
      priceCategory: "low",
    },
  );
  assert.deepEqual(modelPricingFields(MERCURY_MODEL_COST), {
    pricing: "In: $0.25 · Out: $0.75 /1M tokens",
    inputCost: 25,
    outputCost: 75,
    cacheCost: 3,
    priceCategory: "low",
  });
  assert.equal(modelPricingFields(undefined), undefined);
});

test("buckets price categories and free models", () => {
  assert.equal(costCategory({ input: 0.25, output: 0.75 }), "low");
  assert.equal(costCategory({ input: 5, output: 5 }), "medium");
  assert.equal(costCategory({ input: 10, output: 8 }), "high");
  assert.equal(costCategory({ input: 20, output: 40 }), "very_high");
  assert.deepEqual(modelPricingFields({ input: 0, output: 0 }), {
    pricing: "Free",
    inputCost: 0,
    outputCost: 0,
    priceCategory: "low",
  });
});
