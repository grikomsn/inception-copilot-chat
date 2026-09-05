import assert from "node:assert/strict";
import test from "node:test";
import { FimClient, type FimCompletionRequest } from "./fim";

interface RecordedCall {
  readonly url: string | URL | Request;
  readonly init: RequestInit | undefined;
}

function fakeFetch(handler: (init: RequestInit | undefined) => Response | Promise<Response>): { fetcher: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return await handler(init);
  }) as typeof fetch;
  return { fetcher, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function request(model = "mercury-edit-2"): FimCompletionRequest {
  return { model, prompt: "def factorial(n):\n    return n * ", suffix: "\n\nprint(factorial(5))", maxTokens: 256 };
}

test("posts prompt, suffix, and budget to the fixed FIM endpoint", async () => {
  const { fetcher, calls } = fakeFetch(() => jsonResponse({
    id: "cmpl-1",
    object: "text_completion",
    choices: [{ index: 0, finish_reason: "stop", text: "factorial(n - 1)" }],
    usage: { prompt_tokens: 24, completion_tokens: 14, total_tokens: 38 },
  }));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "test-agent/1", fetcher);
  const completion = await client.complete("secret-key", request(), new AbortController().signal);

  assert.equal(completion.text, "factorial(n - 1)");
  assert.equal(completion.finishReason, "stop");
  assert.deepEqual(completion.usage, { promptTokens: 24, completionTokens: 14 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.inceptionlabs.ai/v1/fim/completions");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  assert.equal(headers["User-Agent"], "test-agent/1");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model: "mercury-edit-2",
    prompt: "def factorial(n):\n    return n * ",
    suffix: "\n\nprint(factorial(5))",
    max_tokens: 256,
  });
});

test("surfaces a server warning and tolerates missing usage", async () => {
  const { fetcher } = fakeFetch(() => jsonResponse({
    choices: [{ index: 0, finish_reason: "length", text: "partial" }],
    warning: "rate limited",
  }));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "test-agent/1", fetcher);
  const completion = await client.complete("secret-key", request(), new AbortController().signal);
  assert.equal(completion.text, "partial");
  assert.equal(completion.finishReason, "length");
  assert.equal(completion.usage, undefined);
  assert.equal(completion.warning, "rate limited");
});

test("reports HTTP failures without echoing upstream bodies", async () => {
  const { fetcher } = fakeFetch(() => new Response('{"error":{"message":"prompt echo secret"}}', { status: 401 }));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "test-agent/1", fetcher);
  await assert.rejects(
    () => client.complete("secret-key", request(), new AbortController().signal),
    error => error instanceof Error && error.message.includes("HTTP 401") && !error.message.includes("secret"),
  );
});

test("rejects malformed payloads defensively", async () => {
  const invalidJson = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch(() => new Response("not-json", { status: 200 })).fetcher);
  await assert.rejects(() => invalidJson.complete("key", request(), new AbortController().signal), /invalid FIM response/);

  const noChoices = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch(() => jsonResponse({ choices: [] })).fetcher);
  await assert.rejects(() => noChoices.complete("key", request(), new AbortController().signal), /no FIM completion text/);

  const nonText = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch(() => jsonResponse({ choices: [{ text: 7 }] })).fetcher);
  await assert.rejects(() => nonText.complete("key", request(), new AbortController().signal), /no FIM completion text/);
});

test("propagates fetch failures and aborts", async () => {
  const { fetcher } = fakeFetch(() => {
    throw new Error("network down");
  });
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fetcher);
  await assert.rejects(() => client.complete("key", request(), new AbortController().signal), /network down/);

  const controller = new AbortController();
  controller.abort();
  const aborting = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch((_init) => {
    throw new Error("This operation was aborted");
  }).fetcher);
  await assert.rejects(() => aborting.complete("key", request(), controller.signal), /aborted/);
});
