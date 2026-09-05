import * as vscode from "vscode";
import type { ChatStreamEvent } from "../transport/sse";
import { toProviderUsagePayload } from "../usage/domain";

export function reportEvent(
  event: ChatStreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  output: vscode.OutputChannel,
  debugLogging: boolean,
): void {
  if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
  if (event.reasoning) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart })
      .LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart(event.reasoning));
  }
  for (const tool of event.toolCalls ?? []) {
    progress.report(new vscode.LanguageModelToolCallPart(
      tool.id || `inception-tool-${Date.now()}`,
      tool.name,
      parseArguments(tool.arguments),
    ));
  }
  if (event.usage) {
    const payload = toProviderUsagePayload(event.usage);
    if (debugLogging) output.appendLine(`[usage] ${JSON.stringify(payload)}`);
    progress.report(new vscode.LanguageModelDataPart(
      new TextEncoder().encode(JSON.stringify(payload)),
      "usage",
    ));
  }
}

function parseArguments(value: string): object {
  try {
    const parsed = JSON.parse(value || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}
