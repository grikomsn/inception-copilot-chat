import assert from "node:assert/strict";
import test from "node:test";
import { providerModelId } from "./provider-profile";

test("model ids are the raw hosted ids without entry qualification", () => {
  assert.equal(providerModelId("mercury-2.5"), "mercury-2.5");
  assert.equal(providerModelId("model"), "model");
});
