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
  cancellation.dispose();
  fs.writeFileSync("/tmp/inception-vscode-smoke.json", JSON.stringify({activation:true,discovery:true,streaming:true,toolCall:true,toolResultRoundTrip:true,model:model.rawModelId}));
};
