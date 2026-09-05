import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackClient } from "./feedback";
import { FEEDBACK_URL } from "./protocol";

test("posts outcome metadata to the feedback endpoint", async () => {
  const calls: Array<{ url: unknown; init?: RequestInit }> = [];
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const client = new FeedbackClient(FEEDBACK_URL, "inception-copilot-chat", "0.1.1", fetcher);
  const delivered = await client.report("secret-key", { requestId: "cmpl-123", userAction: "accept" });

  assert.equal(delivered, true);
  assert.equal(calls[0].url, FEEDBACK_URL);
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    request_id: "cmpl-123",
    provider_name: "inception-copilot-chat",
    user_action: "accept",
    provider_version: "0.1.1",
  });
});

test("omits Authorization without an API key and reports upstream failures", async () => {
  const calls: Array<{ init?: RequestInit }> = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    calls.push({ init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const client = new FeedbackClient(FEEDBACK_URL, "p", "1", fetcher);
  assert.equal(await client.report(undefined, { requestId: "r", userAction: "reject" }), true);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["User-Agent"], "p-feedback/1");

  const failing = new FeedbackClient(FEEDBACK_URL, "p", "1", (async () => new Response(null, { status: 500 })) as unknown as typeof fetch);
  assert.equal(await failing.report("key", { requestId: "r", userAction: "accept" }), false);
});

test("swallows network failures", async () => {
  const offline = new FeedbackClient(FEEDBACK_URL, "p", "1", (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.equal(await offline.report("key", { requestId: "r", userAction: "ignore" }), false);
});