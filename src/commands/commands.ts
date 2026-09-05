/** User-facing Inception commands and connection workflows. */

import * as vscode from "vscode";
import { resolveAutocompleteSettings, resolveNextEditSettings } from "../autocomplete/config";
import { InceptionAuth } from "../auth/auth";
import { messageOf } from "../errors";
import { InceptionProvider } from "../provider";
import { API_BASE, INCEPTION_ENDPOINTS } from "../transport/protocol";

const API_KEYS_URL = "https://platform.inceptionlabs.ai/dashboard/api-keys";

export function registerCommands(
  auth: InceptionAuth,
  provider: InceptionProvider,
  output: vscode.OutputChannel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("inceptionCopilot.manage", () => manage(auth, provider, output)),
    vscode.commands.registerCommand("inceptionCopilot.configureApiKey", () => configureApiKey(provider, output)),
    vscode.commands.registerCommand("inceptionCopilot.removeApiKey", () => removeApiKey(provider)),
    vscode.commands.registerCommand("inceptionCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("inceptionCopilot.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("inceptionCopilot.openApiKeys", () => openApiKeys()),
    vscode.commands.registerCommand("inceptionCopilot.diagnostics", () => diagnostics(auth, output)),
  ];
}

async function manage(
  auth: InceptionAuth,
  provider: InceptionProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  const configured = await auth.hasApiKey();
  const choices = configured
    ? [
        { label: "$(check) Test Inception inference", action: "test" },
        { label: "$(refresh) Refresh hosted models", action: "refresh" },
        { label: "$(key) Replace API key", action: "configure" },
        { label: "$(link-external) Open Inception API keys", action: "open" },
        { label: "$(output) Show Inception logs", action: "logs" },
        { label: "$(info) Show diagnostics", action: "diagnostics" },
        { label: "$(trash) Remove API key", action: "remove" },
      ]
    : [
        { label: "$(key) Configure Inception API key", action: "configure" },
        { label: "$(link-external) Open Inception API keys", action: "open" },
        { label: "$(output) Show Inception logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: `Inception Platform — API key ${configured ? "configured" : "not configured"}`,
  });
  if (!picked) return;
  if (picked.action === "configure") await configureApiKey(provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "open") await openApiKeys();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "diagnostics") await diagnostics(auth, output);
  else if (picked.action === "remove") await removeApiKey(provider);
}

async function configureApiKey(
  provider: InceptionProvider,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const apiKey = await vscode.window.showInputBox({
    title: "Configure Inception Platform API key",
    prompt: "The key is validated with Inception, then stored in VS Code Secret Storage.",
    placeHolder: "Paste your Inception API key",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : "Enter an Inception API key",
  });
  if (!apiKey) return false;

  try {
    const models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Validating Inception API key…" },
      () => provider.configureApiKey(apiKey),
    );
    output.appendLine(`[auth] API key configured; models=${models.join(",")}`);
    vscode.window.showInformationMessage(`Inception connected. Found ${models.length} hosted models.`);
    return true;
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[auth] API key validation failed: ${message}`);
    vscode.window.showErrorMessage(`Inception API key was not saved: ${message}`);
    return false;
  }
}

async function removeApiKey(provider: InceptionProvider): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Remove the Inception API key from VS Code Secret Storage?",
    { modal: true },
    "Remove API Key",
  );
  if (choice !== "Remove API Key") return;
  await provider.clearApiKey();
  vscode.window.showInformationMessage("Inception API key removed.");
}

async function refreshModels(provider: InceptionProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} Inception hosted models.`);
  } catch (error) {
    vscode.window.showErrorMessage(messageOf(error));
  }
}

async function testConnection(provider: InceptionProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Testing Inception inference…" },
      () => provider.testConnection(),
    );
    output.appendLine(`[test] model=${result.model} effort=${result.reasoningEffort}`);
    vscode.window.showInformationMessage(
      `Inception verified with ${result.model} (${result.reasoningEffort} effort): ${result.text}`,
    );
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[test] ${message}`);
    vscode.window.showErrorMessage(`Inception connection test failed: ${message}`);
  }
}

async function openApiKeys(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open Inception Platform.");
}

async function diagnostics(auth: InceptionAuth, output: vscode.OutputChannel): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "inception" });
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const autocomplete = resolveAutocompleteSettings(configuration);
  const nextEdit = resolveNextEditSettings(configuration);
  const lines = [
    "# Inception for Copilot Chat diagnostics",
    "",
    `- VS Code: ${vscode.version}`,
    `- API endpoint: ${API_BASE}`,
    `- Completion endpoints: ${INCEPTION_ENDPOINTS.fim}, ${INCEPTION_ENDPOINTS.edit}`,
    `- API key: ${(await auth.hasApiKey()) ? "configured in Secret Storage" : "missing"}`,
    `- Default reasoning effort: ${configuration.get("reasoningEffort", "medium")}`,
    `- Inline autocomplete: ${featureState(autocomplete)}`,
    `- Next edit suggestions: ${featureState(nextEdit)}`,
    `- Suggestion feedback: ${configuration.get("sendFeedback", true) ? "on" : "off"}`,
    `- Registered models: ${models.length}`,
    "",
    ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ];
  output.appendLine(`[diagnostics] models=${models.length}`);
  const doc = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

function featureState(settings: { enabled: boolean; model: string }): string {
  return settings.enabled ? `on (${settings.model})` : "off";
}
