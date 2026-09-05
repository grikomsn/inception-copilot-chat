import assert from "node:assert/strict";
import test from "node:test";
import { API_BASE, INCEPTION_ENDPOINTS, extensionUserAgent, inceptionHeaders } from "./protocol";

test("keeps Inception endpoints and request identity centralized", () => {
  assert.equal(INCEPTION_ENDPOINTS.models, `${API_BASE}/chat/completions/models`);
  assert.equal(INCEPTION_ENDPOINTS.chat, `${API_BASE}/chat/completions`);
  assert.equal(extensionUserAgent("1.2.3", "1.125.0"), "inception-copilot-chat/1.2.3 VSCode/1.125.0");
  assert.deepEqual(inceptionHeaders("secret", "application/json", "agent"), {
    Authorization: "Bearer secret",
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "agent",
  });
});
