import * as vscode from "vscode";
import {
  AUTOCOMPLETE_DEFAULTS,
  featureState,
  resolveAutocompleteSettings,
  resolveNextEditSettings,
} from "./autocomplete/config";
import { MercuryNextEditProvider, NEXT_EDIT_ACCEPTED_COMMAND } from "./autocomplete/next-edit-provider";
import { MercuryAutocompleteProvider, AUTOCOMPLETE_ACCEPTED_COMMAND } from "./autocomplete/provider";
import { EditHistoryTracker, RecentSnippetsTracker } from "./autocomplete/tracker";
import { type InlineUsageListener } from "./autocomplete/usage";
import { InceptionAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { InceptionProvider } from "./provider";
import { EditClient } from "./transport/edit";
import { FeedbackClient } from "./transport/feedback";
import { FimClient } from "./transport/fim";
import { FEEDBACK_URL, INCEPTION_ENDPOINTS, extensionUserAgent } from "./transport/protocol";
import { mergeUsageSnapshots, type InceptionUsageSnapshot } from "./usage/domain";
import { renderUsageStatus, updateUsageStatusVisibility } from "./usage/presentation";

const RECENT_SNIPPET_COUNT = 5;
const PROVIDER_NAME = "inception-copilot-chat";
const USAGE_STATE_KEY = "inceptionCopilot.usageSnapshots.v1";

interface SuggestionSource {
  lastSuggestionId(): string | undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Inception");
  const auth = new InceptionAuth(context.secrets);
  const userAgent = extensionUserAgent(context.extension.packageJSON.version, vscode.version);
  const storedUsage = context.globalState.get<Record<string, InceptionUsageSnapshot>>(USAGE_STATE_KEY) ?? {};
  const provider = new InceptionProvider(auth, output, userAgent, storedUsage);
  const fim = new FimClient(INCEPTION_ENDPOINTS.fim, userAgent);
  const edit = new EditClient(INCEPTION_ENDPOINTS.edit, INCEPTION_ENDPOINTS.editModels, userAgent);
  const resolveApiKey = async (): Promise<string | undefined> =>
    (await auth.getApiKey()) ?? provider.firstConfiguredApiKey();
  const reportInlineUsage: InlineUsageListener = (event) => {
    provider.recordInlineUsage(event.usage ?? {}, event.model, event.apiKey);
  };
  const nextEditConfig = resolveNextEditSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
  const editHistory = new EditHistoryTracker(nextEditConfig.historyDepth);
  const recentSnippets = new RecentSnippetsTracker(nextEditConfig.snippetContextLines, RECENT_SNIPPET_COUNT);
  const autocomplete = new MercuryAutocompleteProvider(resolveApiKey, fim, output, reportInlineUsage);
  const nextEdit = new MercuryNextEditProvider(resolveApiKey, edit, editHistory, recentSnippets, output, reportInlineUsage);
  const feedback = new FeedbackClient(FEEDBACK_URL, PROVIDER_NAME, context.extension.packageJSON.version);
  const reportAcceptance = (feature: string, source: SuggestionSource): void => {
    logAcceptance(output, feature);
    void deliverFeedback(output, feedback, source);
  };
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  usageStatus.name = "Inception usage and completions";
  usageStatus.command = "inceptionCopilot.showUsage";
  const renderUsage = async (): Promise<void> => {
    const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
    renderUsageStatus(usageStatus, mergeUsageSnapshots(Object.values(provider.getUsageSnapshots())), {
      hasKey: Boolean(await resolveApiKey()),
      featureLines: [
        `Autocomplete: ${featureState(resolveAutocompleteSettings(configuration))}`,
        `Next Edit: ${featureState(resolveNextEditSettings(configuration))}`,
      ],
    });
    updateUsageStatusVisibility(usageStatus);
  };
  void renderUsage();

  context.subscriptions.push(
    output,
    editHistory,
    recentSnippets,
    autocomplete,
    nextEdit,
    usageStatus,
    provider.onDidChangeUsage(() => {
      void context.globalState.update(USAGE_STATE_KEY, provider.getUsageSnapshots());
      void renderUsage();
    }),
    provider.onDidChangeLanguageModelChatInformation(() => void renderUsage()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("inceptionCopilot.reasoningEffort")
        || event.affectsConfiguration("inceptionCopilot.catalogCacheMinutes")) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("inceptionCopilot.showUsageStatusBar")) updateUsageStatusVisibility(usageStatus);
      if (event.affectsConfiguration("inceptionCopilot.autocomplete")
        || event.affectsConfiguration("inceptionCopilot.nextEdit")) {
        void renderUsage();
      }
      if (event.affectsConfiguration("inceptionCopilot.nextEdit")) {
        const settings = resolveNextEditSettings(vscode.workspace.getConfiguration("inceptionCopilot"));
        editHistory.setDepth(settings.historyDepth);
      }
    }),
    vscode.lm.registerLanguageModelChatProvider("inception", provider),
    vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], autocomplete),
    vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], nextEdit),
    vscode.commands.registerCommand(AUTOCOMPLETE_ACCEPTED_COMMAND, () => reportAcceptance("autocomplete", autocomplete)),
    vscode.commands.registerCommand(NEXT_EDIT_ACCEPTED_COMMAND, () => reportAcceptance("next edit", nextEdit)),
    ...registerCommands(auth, provider, output, {
      resolveApiKey,
      listModels: async () => edit.listModels((await resolveApiKey()) ?? "", [AUTOCOMPLETE_DEFAULTS.model]),
    }),
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

/** Best-effort outcome feedback; never sends code, prompts, or API keys. */
async function deliverFeedback(output: vscode.OutputChannel, feedback: FeedbackClient, source: SuggestionSource): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("inceptionCopilot");
  if (!configuration.get("sendFeedback", true)) return;
  const requestId = source.lastSuggestionId();
  if (!requestId) return;
  const delivered = await feedback.report(undefined, { requestId, userAction: "accept" });
  if (!delivered && configuration.get("debugLogging", false)) {
    output.appendLine("[completions] feedback delivery failed");
  }
}
