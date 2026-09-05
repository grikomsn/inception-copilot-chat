/** VS Code presentation for locally tracked Inception usage. */

import * as vscode from "vscode";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  type InceptionUsageSnapshot,
  type UsageDisplayRow,
} from "./domain";

export interface UsageQuickPickItem extends vscode.QuickPickItem {
  readonly action?: "openDashboard";
}

export function renderUsageStatus(item: vscode.StatusBarItem, snapshot: InceptionUsageSnapshot): void {
  item.text = formatUsageStatusBar(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
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
