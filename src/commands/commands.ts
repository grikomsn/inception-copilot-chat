/** User-facing Inception commands and connection workflows. */

import * as vscode from "vscode";
import {
  featureState,
  resolveAutocompleteSettings,
  resolveNextEditSettings,
} from "../autocomplete/config";
import { InceptionAuth } from "../auth/auth";
import { messageOf } from "../errors";
import { InceptionProvider } from "../provider";
import { API_BASE, INCEPTION_ENDPOINTS } from "../transport/protocol";
import { formatUsageRows, mergeUsageSnapshots } from "../usage/domain";
import { toUsageQuickPickItem, type UsageMenuAction, type UsageQuickPickItem } from "../usage/presentation";

const API_KEYS_URL = "https://platform.inceptionlabs.ai/dashboard/api-keys";
const USAGE_DASHBOARD_URL = "https://platform.inceptionlabs.ai/dashboard/logs";

/** Access needed by the merged status menu: completion model discovery and key state. */
export interface StatusMenuDeps {
  readonly resolveApiKey: () => Promise<string | undefined>;
  readonly listModels: () => Promise<string[]>;
}

export function registerCommands(
  auth: InceptionAuth,
  provider: InceptionProvider,
  output: vscode.OutputChannel,
  deps: StatusMenuDeps,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("inceptionCopilot.manage", () => manage(auth, provider, output, deps)),
    vscode.commands.registerCommand("inceptionCopilot.configureApiKey", () => configureApiKey(provider, output)),
    vscode.commands.registerCommand("inceptionCopilot.removeApiKey", () => removeApiKey(provider)),
    vscode.commands.registerCommand("inceptionCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("inceptionCopilot.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("inceptionCopilot.openApiKeys", () => openApiKeys()),
    vscode.commands.registerCommand("inceptionCopilot.diagnostics", () => diagnostics(auth, output)),
    vscode.commands.registerCommand("inceptionCopilot.showUsage", () => showUsage(provider, auth, output, deps)),
    vscode.commands.registerCommand("inceptionCopilot.openUsage", () => openUsageDashboard()),
    // Back-compat alias: the pre-merge completion status bar entry.
    vscode.commands.registerCommand("inceptionCopilot.completionMenu", () => showUsage(provider, auth, output, deps)),
  ];
}

async function manage(
  auth: InceptionAuth,
  provider: InceptionProvider,
  output: vscode.OutputChannel,
  deps: StatusMenuDeps,
): Promise<void> {
  const configured = await auth.hasApiKey();
  const choices = configured
    ? [
        { label: "$(check) Test Inception inference", action: "test" },
        { label: "$(graph) Show Inception usage", action: "usage" },
        { label: "$(refresh) Refresh hosted models", action: "refresh" },
        { label: "$(key) Replace API key", action: "configure" },
        { label: "$(link-external) Open Inception usage dashboard", action: "usageDashboard" },
        { label: "$(link-external) Open Inception API keys", action: "open" },
        { label: "$(output) Show Inception logs", action: "logs" },
        { label: "$(info) Show diagnostics", action: "diagnostics" },
        { label: "$(trash) Remove API key", action: "remove" },
      ]
    : [
        { label: "$(key) Configure Inception API key", action: "configure" },
        { label: "$(link-external) Open Inception usage dashboard", action: "usageDashboard" },
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
  else if (picked.action === "usage") await showUsage(provider, auth, output, deps);
  else if (picked.action === "usageDashboard") await openUsageDashboard();
  else if (picked.action === "open") await openApiKeys();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "diagnostics") await diagnostics(auth, output);
  else if (picked.action === "remove") await removeApiKey(provider);
}

/**
 * Merged status menu: locally tracked usage rows followed by the inline
 * completion controls (formerly the separate Mercury status bar item) and
 * connection actions. `inceptionCopilot.completionMenu` opens the same menu.
 */
async function showUsage(
  provider: InceptionProvider,
  auth: InceptionAuth,
  output: vscode.OutputChannel,
  deps: StatusMenuDeps,
): Promise<void> {
  const snapshot = mergeUsageSnapshots(Object.values(provider.getUsageSnapshots()));
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const autocomplete = resolveAutocompleteSettings(configuration);
  const nextEdit = resolveNextEditSettings(configuration);
  const hasKey = Boolean(await deps.resolveApiKey());

  const entries: Array<{ item: UsageQuickPickItem; action?: UsageMenuAction }> = [
    ...formatUsageRows(snapshot).map((row) => ({ item: toUsageQuickPickItem(row) })),
    { item: { label: "", kind: vscode.QuickPickItemKind.Separator } },
    {
      action: "toggleAutocomplete",
      item: {
        label: `${autocomplete.enabled ? "$(check)" : "$(circle-slash)"} Inline Autocomplete`,
        description: `${autocomplete.enabled ? "On" : "Off"} · ${autocomplete.model}`,
      },
    },
    {
      action: "toggleNextEdit",
      item: {
        label: `${nextEdit.enabled ? "$(check)" : "$(circle-slash)"} Next Edit Suggestions`,
        description: `${nextEdit.enabled ? "On" : "Off"} · ${nextEdit.model}`,
      },
    },
    { action: "chooseModel", item: { label: "$(zap) Choose Completion Model…", description: autocomplete.model } },
    { action: "openCompletionSettings", item: { label: "$(gear) Open Completion Settings" } },
  ];
  if (!hasKey) entries.push({ action: "configureApiKey", item: { label: "$(key) Configure API Key…" } });
  entries.push(
    { item: { label: "", kind: vscode.QuickPickItemKind.Separator } },
    { action: "openDashboard", item: { label: "$(link-external) Open Inception usage dashboard" } },
    { action: "manage", item: { label: "$(tools) Manage connection…" } },
  );

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => entry.item),
    {
      title: "Inception — usage & settings",
      placeHolder: "Local usage counts, completion controls, and connection actions",
    },
  );
  const action = entries.find((entry) => entry.item === picked)?.action;
  if (action === "toggleAutocomplete") toggleSection("autocomplete", autocomplete.enabled);
  else if (action === "toggleNextEdit") toggleSection("nextEdit", nextEdit.enabled);
  else if (action === "chooseModel") await chooseModel(deps, autocomplete.model);
  else if (action === "openCompletionSettings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:grikomsn.inception-copilot-chat completion");
  } else if (action === "configureApiKey") await configureApiKey(provider, output);
  else if (action === "openDashboard") await openUsageDashboard();
  else if (action === "manage") await manage(auth, provider, output, deps);
}

function toggleSection(section: string, current: boolean): void {
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const raw: Record<string, unknown> = { ...configuration.get<Record<string, unknown>>(section) };
  raw.enabled = !current;
  void configuration.update(section, raw, vscode.ConfigurationTarget.Global);
}

async function chooseModel(deps: StatusMenuDeps, current: string): Promise<void> {
  const models = await deps.listModels();
  if (!models.length) return;
  const picked = await vscode.window.showQuickPick(
    models.map((id) => ({ label: id, description: id === current ? "current" : undefined })),
    { title: "Completion model (applies to autocomplete and next edit)" },
  );
  if (!picked) return;
  for (const section of ["autocomplete", "nextEdit"]) {
    const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
    const raw: Record<string, unknown> = { ...configuration.get<Record<string, unknown>>(section) };
    raw.model = picked.label;
    void configuration.update(section, raw, vscode.ConfigurationTarget.Global);
  }
}

async function openUsageDashboard(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(USAGE_DASHBOARD_URL));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open Inception Platform.");
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
