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

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function request(model = "mercury-edit-2"): FimCompletionRequest {
  return { model, prompt: "def factorial(n):\n    return n * ", suffix: "\n\nprint(factorial(5))", maxTokens: 256 };
}

test("streams fragmented SSE chunks into one completion", async () => {
  const { fetcher, calls } = fakeFetch(() => sseResponse([
    'data: {"id":"cmpl-1","choices":[{"index":0,"text":"factorial(n "}]}\n\n',
    'data: {"choices":[{"text":"- 1)"}]}\n\n',
    'data: {"choices":[{"text":"","finish_reason":"stop"}]}\n',
    'data: {"choices":[],"usage":{"prompt_tokens":24,"completion_tokens":14,"total_tokens":38}}\n\n',
    "data: [DONE]\n\n",
  ]));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "test-agent/1", fetcher);
  const completion = await client.complete("secret-key", request(), new AbortController().signal);

  assert.ok(completion);
  assert.equal(completion.text, "factorial(n - 1)");
  assert.equal(completion.id, "cmpl-1");
  assert.equal(completion.finishReason, "stop");
  assert.deepEqual(completion.usage, { promptTokens: 24, completionTokens: 14 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.inceptionlabs.ai/v1/fim/completions");
  assert.equal(calls[0].init?.method, "POST");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_tokens, 256);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  assert.equal(headers["User-Agent"], "test-agent/1");
  assert.equal(headers.Accept, "text/event-stream, application/json, application/problem+json");
});

test("recombines data lines split across network chunks", async () => {
  const encoder = new TextEncoder();
  const { fetcher } = fakeFetch(() => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"text":"hel'));
      controller.enqueue(encoder.encode('lo"}]}\n\ndata: {"choices":[{"text":" world"}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200 }));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fetcher);
  const completion = await client.complete("key", request(), new AbortController().signal);
  assert.ok(completion);
  assert.equal(completion.text, "hello world");
});

test("abandons the read when the continuation predicate fails", async () => {
  const { fetcher } = fakeFetch(() => sseResponse([
    'data: {"choices":[{"text":"one"}]}\n\n',
    'data: {"choices":[{"text":"two"}]}\n\n',
    'data: {"choices":[{"text":"three"}]}\n\n',
  ]));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fetcher);
  let reads = 0;
  const completion = await client.complete("key", request(), new AbortController().signal, () => {
    reads += 1;
    return reads < 2;
  });
  assert.equal(completion, undefined);
  assert.equal(reads, 2);
});

test("ignores comments, malformed lines, and non-object payloads", async () => {
  const { fetcher } = fakeFetch(() => sseResponse([
    ": keep-alive\n\n",
    "data: not-json\n\n",
    "data: null\n\n",
    'data: {"choices":[{"text":"kept"}]}\n\n',
    "data: [DONE]\n\n",
  ]));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fetcher);
  const completion = await client.complete("key", request(), new AbortController().signal);
  assert.ok(completion);
  assert.equal(completion.text, "kept");
  assert.equal(completion.id, undefined);
});

test("surfaces a server warning and tolerates missing usage", async () => {
  const { fetcher } = fakeFetch(() => sseResponse([
    'data: {"choices":[{"text":"partial","finish_reason":"length"}],"warning":"rate limited"}\n\n',
    "data: [DONE]\n\n",
  ]));
  const client = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fetcher);
  const completion = await client.complete("key", request(), new AbortController().signal);
  assert.ok(completion);
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

test("rejects empty response streams and propagates fetch failures and aborts", async () => {
  const empty = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch(() => new Response(null, { status: 200 })).fetcher);
  await assert.rejects(() => empty.complete("key", request(), new AbortController().signal), /empty FIM response/);

  const offline = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch(() => {
    throw new Error("network down");
  }).fetcher);
  await assert.rejects(() => offline.complete("key", request(), new AbortController().signal), /network down/);

  const controller = new AbortController();
  controller.abort();
  const aborting = new FimClient("https://api.inceptionlabs.ai/v1/fim/completions", "agent", fakeFetch((_init) => {
    throw new Error("This operation was aborted");
  }).fetcher);
  await assert.rejects(() => aborting.complete("key", request(), controller.signal), /aborted/);
});
