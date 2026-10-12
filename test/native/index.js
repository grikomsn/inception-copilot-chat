const assert = require("node:assert/strict");
const vscode = require("vscode");
const { Credentials } = require("../../out/auth/auth");
const { InceptionProvider } = require("../../out/provider");
const { StreamResponseReporter } = require("../../out/provider/response");
const { FimClient } = require("../../out/transport/fim");
const { EditClient } = require("../../out/transport/edit");
const { INCEPTION_ENDPOINTS } = require("../../out/transport/protocol");

async function run() {
  const source = new vscode.CancellationTokenSource();
  const sent = [];
  const sentFeatures = [];
  let mode = "tools";
  let cancelled = 0;
  let lastBody;
  let lastSignal;
  const block = (delta, finish_reason, usage) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], usage })}\r\n\r\n`;
  const encoder = new TextEncoder();
  const fetcher = async (url, init) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "mercury-2.5" }] });
    if (String(url).includes("/fim/completions")) {
      sentFeatures.push(new Headers(init.headers).get("Authorization"));
      return new Response('data: {"choices":[{"text":"synthetic suggestion","finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n');
    }
    if (String(url).includes("/edit/completions")) {
      sentFeatures.push(new Headers(init.headers).get("Authorization"));
      return Response.json({ choices: [{ message: { content: "synthetic edit" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    }
    const body = JSON.parse(init.body);
    sent.push({ body, authorization: new Headers(init.headers).get("Authorization") });
    lastSignal = init.signal;
    const followUp = body.messages.some((message) => message.role === "tool");
    let events;
    if (mode === "tools" || mode === "done-open") {
      events = followUp ? [block({ reasoning_content: "synthetic reasoning", content: "synthetic answer" }, "stop", { prompt_tokens: 10, completion_tokens: 5 })] : [
        block({ reasoning_content: "synthetic reasoning" }),
        block({ tool_calls: [0, 1, 2].map((index) => ({ index, id: `call-${index}`, function: { name: "read", arguments: '{"file":"' } })) }),
        ...[2, 0, 1].map((index) => block({ tool_calls: [{ id: `call-${index}`, function: { arguments: `${index}"}` } }] })),
        block({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 5 }),
        "data: [DONE]\r\n\r\n",
      ];
    } else if (mode === "eof") events = [block({ reasoning_content: "synthetic reasoning" })];
    else if (mode === "error") events = [block({ reasoning_content: "synthetic reasoning" }), 'data: {"error":{"message":"do not echo this synthetic body"}}\r\n\r\n'];
    const stream = new ReadableStream({
      start(controller) {
        if (mode === "cancel") {
          controller.enqueue(encoder.encode(block({ reasoning_content: "synthetic reasoning" })));
          return;
        }
        // Split CRLF pairs between chunks instead of relying on stream boundaries.
        const text = events.join("");
        let start = 0;
        for (let index = 0; index < text.length; index++) {
          if (text[index] !== "\r") continue;
          controller.enqueue(encoder.encode(text.slice(start, index + 1)));
          start = index + 1;
        }
        if (start < text.length) controller.enqueue(encoder.encode(text.slice(start)));
        if (mode !== "done-open") controller.close();
      },
      cancel() { cancelled++; },
    });
    lastBody = stream;
    return new Response(stream);
  };
  try {
    const credentials = new Credentials();
    const provider = new InceptionProvider(credentials, { appendLine() {} }, "native-test", {}, fetcher);
    const prepare = async (apiKey) => (await provider.provideLanguageModelChatInformation({
      configuration: { apiKey, name: "Same name" }, silent: true,
    }, source.token))[0];
    const work = await prepare("synthetic-work");
    const personal = await prepare("synthetic-personal");
    assert.ok(work && personal);
    assert.equal(work.id, personal.id, "The host namespaces model ids per group; the provider returns raw ids");
    assert.notEqual(work.credentialRef, personal.credentialRef);
    assert.equal(provider.getInlineApiKey(), "synthetic-personal", "Active key follows the most recent provisioning");
    const options = { requestInitiator: "native-test", tools: [{ name: "read", description: "Synthetic read", inputSchema: { type: "object", properties: { file: { type: "string" } } } }] };
    const callsByEntry = [];
    for (const [model, key] of [[work, "synthetic-work"], [personal, "synthetic-personal"]]) {
      const output = [];
      await provider.provideLanguageModelChatResponse(model, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, { report: (part) => output.push(part) }, source.token);
      const calls = output.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
      assert.equal(calls.length, 3);
      assert.deepEqual(calls.map((part) => part.input.file), ["0", "1", "2"]);
      assert.equal(new Set(calls.map((part) => part.callId)).size, 3);
      assert.equal(output[1].metadata.vscode_reasoning_done, true);
      assert.equal(sent.at(-1).authorization, `Bearer ${key}`);
      assert.equal(lastBody.locked, false);
      callsByEntry.push(calls);
    }
    const history = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant(callsByEntry[0]),
      vscode.LanguageModelChatMessage.User(callsByEntry[0].map((call) => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("synthetic result")])) )];
    const followUpParts = [];
    await provider.provideLanguageModelChatResponse(work, history, options, { report: (part) => followUpParts.push(part) }, source.token);
    assert.equal(sent.at(-1).body.messages.filter((message) => message.role === "tool").length, 3);
    assert.ok(followUpParts[0] instanceof vscode.LanguageModelThinkingPart);
    assert.equal(followUpParts[1].metadata.vscode_reasoning_done, true);
    assert.ok(followUpParts[2] instanceof vscode.LanguageModelTextPart);
    assert.equal(provider.getUsageSnapshot(work.credentialRef).tracked.requests, 2);
    assert.equal(provider.getUsageSnapshot(personal.credentialRef).tracked.requests, 1);
    const fim = new FimClient(INCEPTION_ENDPOINTS.fim, "native-test", fetcher);
    const edit = new EditClient(INCEPTION_ENDPOINTS.edit, INCEPTION_ENDPOINTS.editModels, "native-test", fetcher);
    const fimKey = provider.getInlineApiKey();
    const editKey = "synthetic-work";
    const fimResult = await fim.complete(fimKey, { model: "mercury-edit-2", prompt: "synthetic prefix", suffix: "synthetic suffix", maxTokens: 16 }, new AbortController().signal);
    const editResult = await edit.complete(editKey, { model: "mercury-edit-2", content: "synthetic context", maxTokens: 16 }, new AbortController().signal);
    assert.deepEqual(sentFeatures, ["Bearer synthetic-personal", "Bearer synthetic-work"]);
    provider.recordInlineUsage(fimResult.usage, "mercury-edit-2", fimKey);
    provider.recordInlineUsage(editResult.usage, "mercury-edit-2", editKey);
    assert.equal(provider.getUsageSnapshot(personal.credentialRef).tracked.requests, 2);
    assert.equal(provider.getUsageSnapshot(work.credentialRef).tracked.requests, 3);
    const rotated = await prepare("synthetic-rotated");
    assert.equal(work.id, rotated.id);
    assert.notEqual(work.credentialRef, rotated.credentialRef);
    // Provisioning another key does not invalidate a previously provisioned key.
    await provider.provideLanguageModelChatResponse(work, [], options, { report() {} }, source.token);
    assert.equal(sent.at(-1).authorization, "Bearer synthetic-work");
    for (const credentialRef of ["unregistered-handle", "synthetic-work"]) {
      const count = sent.length;
      await assert.rejects(provider.provideLanguageModelChatResponse({ ...work, credentialRef }, [], options, { report() {} }, source.token), /replaced or removed/);
      assert.equal(sent.length, count, "Unregistered and raw-key handles never send a request");
    }
    assert.equal(provider.getInlineApiKey(), "synthetic-rotated");
    for (const failure of ["eof", "error"]) {
      mode = failure;
      const parts = [];
      const count = sent.length;
      await assert.rejects(provider.provideLanguageModelChatResponse(rotated, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, { report: (part) => parts.push(part) }, source.token), (error) => {
        assert.ok(!error.message.includes("do not echo"));
        return true;
      });
      assert.equal(sent.length, count + 1, "Never retry after reporting stream output");
      assert.equal(parts.at(-1).metadata.vscode_reasoning_done, true);
      assert.equal(lastBody.locked, false);
    }
    mode = "done-open";
    const cancellationCount = cancelled;
    await provider.provideLanguageModelChatResponse(rotated, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, { report() {} }, source.token);
    assert.ok(cancelled > cancellationCount, "A completed stream cancels a still-open body");
    assert.equal(lastBody.locked, false);
    mode = "cancel";
    const cancellation = new vscode.CancellationTokenSource();
    const parts = [];
    await provider.provideLanguageModelChatResponse(rotated, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, {
      report(part) { parts.push(part); if (part instanceof vscode.LanguageModelThinkingPart && part.value) cancellation.cancel(); },
    }, cancellation.token);
    cancellation.dispose();
    assert.equal(lastSignal.aborted, true);
    assert.ok(cancelled > 0);
    assert.equal(parts.at(-1).metadata.vscode_reasoning_done, true);
    assert.equal(lastBody.locked, false);
    const missingParts = [];
    const reporter = new StreamResponseReporter({ report: (part) => missingParts.push(part) }, vscode);
    reporter.report({ toolCalls: [0, 1, 2].map(() => ({ id: "", name: "read", arguments: "{}" })) });
    assert.equal(new Set(missingParts.map((part) => part.callId)).size, 3);
  } finally { source.dispose(); }
  console.log(JSON.stringify({ provider: "inception", nativeChecks: "parallel tools, reasoning closure, CRLF, two entries, follow-up, active-key routing, inline-feature usage, key-scoped handles, unregistered/raw-handle rejection, error, EOF, cancellation, resource cleanup", passed: true }));
}
module.exports = { run };
