// Explicit opt-in live test. Writes only pass/fail metadata, never credentials or responses.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vscode = require("vscode");
exports.run = async function () {
  const root = path.resolve(__dirname, "..");
  const { parseEnv } = require("node:util");
  const key = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8")).INCEPTION_API_KEY;
  assert.ok(key, "INCEPTION_API_KEY is required");
  const extension = vscode.extensions.getExtension("grikomsn.inception-copilot-chat");
  assert.ok(extension);
  await extension.activate();
  const { InceptionProvider } = require(path.join(root, "out/provider.js"));
  const provider = new InceptionProvider({ getApiKey: async () => undefined }, { appendLine() {} }, "inception-copilot-chat/smoke");
  const cancellation = new vscode.CancellationTokenSource();
  const models = await provider.provideLanguageModelChatInformation({ configuration: { apiKey: key } }, cancellation.token);
  const model = models.find(m => m.rawModelId === "mercury-2");
  assert.ok(model);
  const parts = [];
  const user = vscode.LanguageModelChatMessage.User("Reply with exactly: connection verified");
  await provider.provideLanguageModelChatResponse(model, [user], {modelConfiguration:{reasoningEffort:"instant"}}, {report:p=>parts.push(p)}, cancellation.token);
  assert.ok(parts.some(p => p instanceof vscode.LanguageModelTextPart && p.value.length));
  const toolParts = [];
  const tools = [{name:"get_number",description:"Get the test number",inputSchema:{type:"object",properties:{},additionalProperties:false}}];
  await provider.provideLanguageModelChatResponse(model, [vscode.LanguageModelChatMessage.User("Call get_number to retrieve the test number.")], {modelConfiguration:{reasoningEffort:"low"},tools,toolMode:vscode.LanguageModelChatToolMode.Required}, {report:p=>toolParts.push(p)}, cancellation.token);
  const call = toolParts.find(p => p instanceof vscode.LanguageModelToolCallPart);
  assert.ok(call);
  assert.equal(call.name, "get_number");
  const finalParts = [];
  await provider.provideLanguageModelChatResponse(model, [
    vscode.LanguageModelChatMessage.User("Call get_number and tell me the returned number."),
    vscode.LanguageModelChatMessage.Assistant([call]),
    vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(call.callId,[new vscode.LanguageModelTextPart("42")])]),
  ], {modelConfiguration:{reasoningEffort:"instant"}}, {report:p=>finalParts.push(p)}, cancellation.token);
  assert.ok(finalParts.filter(p=>p instanceof vscode.LanguageModelTextPart).map(p=>p.value).join("").includes("42"));
  const fim = await fimSmoke(key);
  const edit = await editSmoke(key);
  cancellation.dispose();
  fs.writeFileSync("/tmp/inception-vscode-smoke.json", JSON.stringify({activation:true,discovery:true,streaming:true,toolCall:true,toolResultRoundTrip:true,fim,edit,model:model.rawModelId}));
};

async function fimSmoke(key) {
  const res = await fetch("https://api.inceptionlabs.ai/v1/fim/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}`, "User-Agent": "inception-copilot-chat-smoke" },
    body: JSON.stringify({ model: "mercury-edit-2", prompt: "def add(a, b):\n    return ", suffix: "\n\nprint(add(2, 3))", max_tokens: 64 }),
  });
  assert.ok(res.ok, `FIM request failed (HTTP ${res.status})`);
  const body = await res.json();
  assert.equal(typeof body.choices?.[0]?.text, "string", "FIM response text");
  assert.equal(typeof body.id, "string", "FIM response id");
  return true;
}

async function editSmoke(key) {
  const content = [
    "<|recently_viewed_code_snippets|>", "", "<|/recently_viewed_code_snippets|>", "",
    "<|current_file_content|>",
    "current_file_path: add.py",
    "<|code_to_edit|>",
    "def add(a, b):", "    return a<|cursor|>",
    "<|/code_to_edit|>",
    "<|/current_file_content|>", "",
    "<|edit_diff_history|>", "", "<|/edit_diff_history|>",
  ].join("\n");
  const res = await fetch("https://api.inceptionlabs.ai/v1/edit/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}`, "User-Agent": "inception-copilot-chat-smoke" },
    body: JSON.stringify({ model: "mercury-edit-2", messages: [{ role: "user", content }], max_tokens: 256 }),
  });
  assert.ok(res.ok, `Edit request failed (HTTP ${res.status})`);
  const body = await res.json();
  const message = body.choices?.[0]?.message?.content;
  assert.equal(typeof message, "string", "edit response content");
  return true;
}
