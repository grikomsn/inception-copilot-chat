import type { EditUsage } from "../transport/edit";
import type { FimUsage } from "../transport/fim";

/** Usage payload surfaced by the inline-completion providers after each request. */
export interface InlineUsageEvent {
  readonly feature: "autocomplete" | "next-edit";
  readonly model: string;
  /** Key actually used for the request, so usage joins the right credential scope. */
  readonly apiKey: string | undefined;
  readonly usage: FimUsage | EditUsage | undefined;
}

export type InlineUsageListener = (event: InlineUsageEvent) => void;
