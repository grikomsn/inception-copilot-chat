import assert from "node:assert/strict";
import test from "node:test";
import { orderModelMetadata, resolveMaxOutputTokens } from "./catalog";
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
