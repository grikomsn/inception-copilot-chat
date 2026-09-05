import * as vscode from "vscode";
import { MercuryAutocompleteProvider, AUTOCOMPLETE_ACCEPTED_COMMAND } from "./autocomplete/provider";
import { InceptionAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { InceptionProvider } from "./provider";
import { FimClient } from "./transport/fim";
import { INCEPTION_ENDPOINTS, extensionUserAgent } from "./transport/protocol";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Inception");
  const auth = new InceptionAuth(context.secrets);
  const userAgent = extensionUserAgent(context.extension.packageJSON.version, vscode.version);
  const provider = new InceptionProvider(auth, output, userAgent);
  const fim = new FimClient(INCEPTION_ENDPOINTS.fim, userAgent);
  const autocomplete = new MercuryAutocompleteProvider(
    async () => (await auth.getApiKey()) ?? provider.firstConfiguredApiKey(),
    fim,
    output,
  );

  context.subscriptions.push(
    output,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("inceptionCopilot.reasoningEffort")
        || event.affectsConfiguration("inceptionCopilot.catalogCacheMinutes")) {
        provider.fireDidChange();
      }
    }),
    vscode.lm.registerLanguageModelChatProvider("inception", provider),
    vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], autocomplete),
    vscode.commands.registerCommand(AUTOCOMPLETE_ACCEPTED_COMMAND, () => {
      if (vscode.workspace.getConfiguration("inceptionCopilot").get("debugLogging", false)) {
        output.appendLine("[autocomplete] suggestion accepted");
      }
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
