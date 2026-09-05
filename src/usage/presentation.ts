/** VS Code presentation for locally tracked Inception usage. */

import * as vscode from "vscode";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  type InceptionUsageSnapshot,
  type UsageDisplayRow,
} from "./domain";

export type UsageMenuAction =
  | "openDashboard"
  | "manage"
  | "toggleAutocomplete"
  | "toggleNextEdit"
  | "chooseModel"
  | "openCompletionSettings"
  | "configureApiKey";

export interface UsageQuickPickItem extends vscode.QuickPickItem {
  readonly action?: UsageMenuAction;
}

/** Extra context rendered into the merged status bar item. */
export interface UsageStatusContext {
  /** Whether any Inception API key (command-managed or provider entry) is available. */
  readonly hasKey: boolean;
  /** Completion feature lines appended to the tooltip, e.g. `Autocomplete: on (mercury-edit-2)`. */
  readonly featureLines: readonly string[];
}

export function renderUsageStatus(
  item: vscode.StatusBarItem,
  snapshot: InceptionUsageSnapshot,
  context?: UsageStatusContext,
): void {
  item.text = formatUsageStatusBar(snapshot, context?.hasKey ?? true);
  const tooltip = [formatUsageTooltip(snapshot)];
  if (context?.featureLines.length) tooltip.push("", ...context.featureLines);
  item.tooltip = tooltip.join("\n");
}

export function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  const enabled = vscode.workspace.getConfiguration("inceptionCopilot").get("showUsageStatusBar", true);
  if (enabled) item.show();
  else item.hide();
}

export function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = {
    tracked: "$(history)",
    request: "$(sync)",
    estimate: "$(graph)",
    warning: "$(warning)",
    empty: "$(info)",
  }[row.kind];
  return {
    label: `${icon} ${row.label}`,
    description: row.description,
    detail: row.detail,
    alwaysShow: true,
  };
}
