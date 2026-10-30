import { MERCURY_3_MODEL_COST, modelCostFromApi, type ModelCost } from "./pricing";

export const FALLBACK_MODELS = ["mercury-3"] as const;
export const DEFAULT_MAX_INPUT_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 50_000;

/**
 * Hosted models Inception closed to new users at the Mercury 3 launch
 * (2026-10-19). Existing customers keep access until 2026-11-15, after which
 * the service stops serving them; the catalog filters them out ahead of the
 * cutover and points at Mercury 3 instead. Enterprise agreements are separate.
 */
const RETIRED_MODEL_IDS: ReadonlySet<string> = new Set(["mercury-2", "mercury-2.5"]);

export interface InceptionModelMetadata {
  readonly id: string;
  readonly version: string;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly cost?: ModelCost;
}
export interface InceptionApiModel {
  readonly id?: unknown;
  readonly context_length?: unknown;
  readonly max_output_length?: unknown;
  readonly pricing?: unknown;
}
export const FALLBACK_MODEL_METADATA: readonly InceptionModelMetadata[] = [
  {
    id: "mercury-3",
    version: "3",
    contextLength: 1_000_000,
    maxOutputTokens: 131_072,
    cost: MERCURY_3_MODEL_COST,
  },
];
export function isInceptionChatModel(id: string): boolean {
  // Decide serves a separate decision endpoint and never chat completions.
  return id.startsWith("mercury") && !/(edit|fim|embedding|decide)/i.test(id);
}
/** Whether the hosted model id is retired and leaves the picker. */
export function isRetiredModel(id: string): boolean {
  return RETIRED_MODEL_IDS.has(id.trim().toLowerCase());
}
export function orderModels(ids: readonly string[]): string[] {
  const preferred = new Map(FALLBACK_MODEL_METADATA.map((model, index) => [model.id, index]));
  return [...new Set(ids)]
    .filter((id) => isInceptionChatModel(id) && !isRetiredModel(id))
    .sort((a, b) => {
      const left = preferred.get(a) ?? Number.MAX_SAFE_INTEGER;
      const right = preferred.get(b) ?? Number.MAX_SAFE_INTEGER;
      return left !== right ? left - right : a.localeCompare(b);
    });
}
export function getModelMetadata(id: string): InceptionModelMetadata {
  return FALLBACK_MODEL_METADATA.find(model => model.id === id) ?? {
    id, version: "unknown", contextLength: DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  };
}
export function orderModelMetadata(models: readonly InceptionApiModel[]): InceptionModelMetadata[] {
  const found = new Map<string, InceptionModelMetadata>();
  for (const model of models) {
    if (!model || typeof model.id !== "string" || !isInceptionChatModel(model.id) || isRetiredModel(model.id)) continue;
    const baseline = getModelMetadata(model.id);
    const cost = modelCostFromApi(model.pricing) ?? baseline.cost;
    found.set(model.id, {
      ...baseline,
      contextLength: positiveInteger(model.context_length) ?? baseline.contextLength,
      maxOutputTokens: positiveInteger(model.max_output_length) ?? baseline.maxOutputTokens,
      ...(cost === undefined ? {} : { cost }),
    });
  }
  return orderModels([...found.keys()]).map(id => found.get(id)!);
}
function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
export function resolveMaxOutputTokens(configured: number, advertised: number): number {
  return Number.isFinite(configured) && configured > 0 ? Math.min(Math.floor(configured), advertised) : advertised;
}
export function formatTokenLimit(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}
export function formatModelName(id: string): string {
  return id.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
