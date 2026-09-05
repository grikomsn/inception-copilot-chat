import * as vscode from "vscode";
import { InceptionAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { InceptionProvider } from "./provider";
import { extensionUserAgent } from "./transport/protocol";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Inception");
  const auth = new InceptionAuth(context.secrets);
  const provider = new InceptionProvider(
    auth,
    output,
    extensionUserAgent(context.extension.packageJSON.version, vscode.version),
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
