import assert from "node:assert/strict";
import test from "node:test";
import { EditClient, type EditCompletionRequest } from "./edit";

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

function request(): EditCompletionRequest {
  return { model: "mercury-edit-2", content: "<|current_file_content|>\n<|/current_file_content|>", maxTokens: 1024 };
}

test("posts a single user message with the tagged prompt", async () => {
  const { fetcher, calls } = fakeFetch(() => jsonResponse({
    id: "cmpl-2",
    object: "edit.completion",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "def greet(name):\n    return name" } }],
    usage: { prompt_tokens: 156, completion_tokens: 18, total_tokens: 174 },
  }));
  const client = new EditClient(
    "https://api.inceptionlabs.ai/v1/edit/completions",
    "https://api.inceptionlabs.ai/v1/edit/completions/models",
    "test-agent/1",
    fetcher,
  );
  const completion = await client.complete("secret-key", request(), new AbortController().signal);

  assert.equal(completion.text, "def greet(name):\n    return name");
  assert.equal(completion.id, "cmpl-2");
  assert.equal(completion.finishReason, "stop");
  assert.deepEqual(completion.usage, { promptTokens: 156, completionTokens: 18 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.inceptionlabs.ai/v1/edit/completions");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model: "mercury-edit-2",
    messages: [{ role: "user", content: "<|current_file_content|>\n<|/current_file_content|>" }],
    max_tokens: 1024,
  });
});

test("joins OpenAI-style content parts defensively", async () => {
  const { fetcher } = fakeFetch(() => jsonResponse({
    choices: [{ index: 0, message: { role: "assistant", content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] } }],
  }));
  const client = new EditClient("https://api.inceptionlabs.ai/v1/edit/completions", "https://api.inceptionlabs.ai/v1/edit/completions/models", "agent", fetcher);
  const completion = await client.complete("key", request(), new AbortController().signal);
  assert.equal(completion.text, "part onepart two");
});

test("rejects payloads without usable content", async () => {
  const nullContent = new EditClient("https://api.inceptionlabs.ai/v1/edit/completions", "models", "agent", fakeFetch(() => jsonResponse({ choices: [{ message: { role: "assistant", content: null } }] })).fetcher);
  await assert.rejects(() => nullContent.complete("key", request(), new AbortController().signal), /no edit completion content/);

  const noChoices = new EditClient("https://api.inceptionlabs.ai/v1/edit/completions", "models", "agent", fakeFetch(() => jsonResponse({ choices: [] })).fetcher);
  await assert.rejects(() => noChoices.complete("key", request(), new AbortController().signal), /no edit completion content/);

  const invalidJson = new EditClient("https://api.inceptionlabs.ai/v1/edit/completions", "models", "agent", fakeFetch(() => new Response("nope", { status: 200 })).fetcher);
  await assert.rejects(() => invalidJson.complete("key", request(), new AbortController().signal), /invalid edit response/);
});

test("reports HTTP failures without echoing upstream bodies", async () => {
  const { fetcher } = fakeFetch(() => new Response('{"error":{"message":"prompt echo secret"}}', { status: 400 }));
  const client = new EditClient("https://api.inceptionlabs.ai/v1/edit/completions", "models", "agent", fetcher);
  await assert.rejects(
    () => client.complete("key", request(), new AbortController().signal),
    error => error instanceof Error && error.message.includes("HTTP 400") && !error.message.includes("secret"),
  );
});

test("lists edit models with a fallback on failures", async () => {
  const ok = new EditClient("edit", "models", "agent", fakeFetch(() => jsonResponse({ data: [{ id: "mercury-edit-2" }, { id: "mercury-coder" }, { id: "mercury-2" }, { id: "mercury-embedding" }, { id: 9 }] })).fetcher);
  assert.deepEqual(await ok.listModels("key", ["fallback"]), ["mercury-2", "mercury-coder", "mercury-edit-2"]);

  const failing = new EditClient("edit", "models", "agent", fakeFetch(() => new Response("denied", { status: 401 })).fetcher);
  assert.deepEqual(await failing.listModels("key", ["mercury-edit-2"]), ["mercury-edit-2"]);

  const throwing = new EditClient("edit", "models", "agent", fakeFetch(() => {
    throw new Error("offline");
  }).fetcher);
  assert.deepEqual(await throwing.listModels("key", ["mercury-edit-2"]), ["mercury-edit-2"]);
});
