import * as vscode from "vscode";
import {
  resolveAutocompleteSettings,
  resolveNextEditSettings,
} from "./config";

export const COMPLETION_MENU_COMMAND = "inceptionCopilot.completionMenu";

export interface CompletionStatusDeps {
  readonly resolveApiKey: () => Promise<string | undefined>;
  readonly listModels: () => Promise<string[]>;
}

type MenuAction = "toggleAutocomplete" | "toggleNextEdit" | "chooseModel" | "openSettings" | "configureKey";

/**
 * Status bar entry and QuickPick menu for the inline completion features:
 * toggling autocomplete and next-edit suggestions, choosing the completion
 * model, and jumping to the extension's settings page.
 */
export function registerCompletionStatusBar(deps: CompletionStatusDeps): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  item.name = "Inception Completions";
  item.command = COMPLETION_MENU_COMMAND;
  const refresh = (): void => {
    void refreshItem(item, deps);
  };
  refresh();
  return vscode.Disposable.from(
    item,
    vscode.commands.registerCommand(COMPLETION_MENU_COMMAND, () => openMenu(deps)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("inceptionCopilot.autocomplete")
        || event.affectsConfiguration("inceptionCopilot.nextEdit")) {
        refresh();
      }
    }),
  );
}

async function refreshItem(item: vscode.StatusBarItem, deps: CompletionStatusDeps): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const autocomplete = resolveAutocompleteSettings(configuration);
  const nextEdit = resolveNextEditSettings(configuration);
  const hasKey = Boolean(await deps.resolveApiKey());
  item.text = hasKey ? "$(sparkle) Mercury" : "$(key) Mercury";
  item.tooltip = [
    "Inception inline completions",
    `Autocomplete: ${featureState(autocomplete)}`,
    `Next Edit: ${featureState(nextEdit)}`,
    hasKey ? "API key configured" : "No API key configured — click to set one up",
    "",
    "Click to configure completions",
  ].join("\n");
  item.show();
}

function featureState(settings: { enabled: boolean; model: string }): string {
  return settings.enabled ? `on (${settings.model})` : "off";
}

async function openMenu(deps: CompletionStatusDeps): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const autocomplete = resolveAutocompleteSettings(configuration);
  const nextEdit = resolveNextEditSettings(configuration);
  const hasKey = Boolean(await deps.resolveApiKey());

  const entries: Array<{ item: vscode.QuickPickItem; action: MenuAction }> = [
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
    { action: "openSettings", item: { label: "$(gear) Open Completion Settings" } },
  ];
  if (!hasKey) entries.push({ action: "configureKey", item: { label: "$(key) Configure API Key…" } });

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => entry.item),
    { title: "Inception Completions", placeHolder: "Toggle suggestions, pick a model, or open settings" },
  );
  const action = entries.find((entry) => entry.item === picked)?.action;
  if (action === "toggleAutocomplete") toggleSection("autocomplete", autocomplete.enabled);
  if (action === "toggleNextEdit") toggleSection("nextEdit", nextEdit.enabled);
  if (action === "chooseModel") await chooseModel(deps, autocomplete.model);
  if (action === "openSettings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:grikomsn.inception-copilot-chat completion");
  }
  if (action === "configureKey") await vscode.commands.executeCommand("inceptionCopilot.configureApiKey");
}

function toggleSection(section: string, current: boolean): void {
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  const raw: Record<string, unknown> = { ...configuration.get<Record<string, unknown>>(section) };
  raw.enabled = !current;
  void configuration.update(section, raw, vscode.ConfigurationTarget.Global);
}

async function chooseModel(deps: CompletionStatusDeps, current: string): Promise<void> {
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
