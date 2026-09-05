import * as vscode from "vscode";
import { AUTOCOMPLETE_DEFAULTS, resolveNextEditSettings } from "./autocomplete/config";
import { MercuryNextEditProvider, NEXT_EDIT_ACCEPTED_COMMAND } from "./autocomplete/next-edit-provider";
import { MercuryAutocompleteProvider, AUTOCOMPLETE_ACCEPTED_COMMAND } from "./autocomplete/provider";
import { registerCompletionStatusBar } from "./autocomplete/status";
import { EditHistoryTracker, RecentSnippetsTracker } from "./autocomplete/tracker";
import { InceptionAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { InceptionProvider } from "./provider";
import { EditClient } from "./transport/edit";
import { FimClient } from "./transport/fim";
import { INCEPTION_ENDPOINTS, extensionUserAgent } from "./transport/protocol";

const RECENT_SNIPPET_COUNT = 5;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Inception");
  const auth = new InceptionAuth(context.secrets);
  const userAgent = extensionUserAgent(context.extension.packageJSON.version, vscode.version);
  const provider = new InceptionProvider(auth, output, userAgent);
  const fim = new FimClient(INCEPTION_ENDPOINTS.fim, userAgent);
  const edit = new EditClient(INCEPTION_ENDPOINTS.edit, INCEPTION_ENDPOINTS.editModels, userAgent);
  const resolveApiKey = async (): Promise<string | undefined> =>
    (await auth.getApiKey()) ?? provider.firstConfiguredApiKey();
  const nextEditConfig = resolveNextEditSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
  const editHistory = new EditHistoryTracker(nextEditConfig.historyDepth);
  const recentSnippets = new RecentSnippetsTracker(nextEditConfig.snippetContextLines, RECENT_SNIPPET_COUNT);
  const autocomplete = new MercuryAutocompleteProvider(resolveApiKey, fim, output);
  const nextEdit = new MercuryNextEditProvider(resolveApiKey, edit, editHistory, recentSnippets, output);

  context.subscriptions.push(
    output,
    editHistory,
    recentSnippets,
    autocomplete,
    nextEdit,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("inceptionCopilot.reasoningEffort")
        || event.affectsConfiguration("inceptionCopilot.catalogCacheMinutes")) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("inceptionCopilot.nextEdit")) {
        const settings = resolveNextEditSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
        editHistory.setDepth(settings.historyDepth);
      }
    }),
    vscode.lm.registerLanguageModelChatProvider("inception", provider),
    vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], autocomplete),
    vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], nextEdit),
    vscode.commands.registerCommand(AUTOCOMPLETE_ACCEPTED_COMMAND, () => logAcceptance(output, "autocomplete")),
    vscode.commands.registerCommand(NEXT_EDIT_ACCEPTED_COMMAND, () => logAcceptance(output, "next edit")),
    registerCompletionStatusBar({
      resolveApiKey,
      listModels: async () => edit.listModels((await resolveApiKey()) ?? "", [AUTOCOMPLETE_DEFAULTS.model]),
    }),
    ...registerCommands(auth, provider, output),
  );

  output.appendLine(
    `[activate] Inception for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`,
  );
  void auth.hasApiKey().then((configured) => {
    if (!configured) return;
    void provider.refreshModels().catch((error) => {
      output.appendLine(`[models] initial refresh failed: ${messageOf(error)}`);
    });
  });
}

function logAcceptance(output: vscode.OutputChannel, feature: string): void {
  if (!vscode.workspace.getConfiguration("inceptionCopilot").get("debugLogging", false)) return;
  output.appendLine(`[completions] ${feature} suggestion accepted`);
}
