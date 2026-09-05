/** Mercury per-token pricing, shared by the model picker and local usage estimates. */

export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

export interface ModelPricingFields {
  readonly pricing: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheCost?: number;
  readonly priceCategory: "low" | "medium" | "high" | "very_high";
}

/**
 * Published Mercury rates (USD per 1M tokens): $0.25 input, $0.025 cached
 * input, $0.75 output. Used only when live discovery omits pricing; Mercury 2
 * and Mercury Edit 2 share these rates.
 */
export const MERCURY_MODEL_COST: ModelCost = { input: 0.25, cacheRead: 0.025, output: 0.75 };

/** Live discovery is authoritative; this is a passthrough kept for parity. */
export function inceptionModelCost(_id: string, discovered?: ModelCost): ModelCost | undefined {
  return discovered;
}

/**
 * Converts the per-token pricing strings from `GET /v1/models` into per-million
 * costs. Inception uses `input_cache_reads`/`input_cache_writes` (unlike the
 * OpenAI-style `cache_prompt`); cache writes are currently free and ignored.
 */
export function modelCostFromApi(value: unknown): ModelCost | undefined {
  const pricing = record(value);
  if (!pricing) return undefined;
  const input = nonNegativeNumber(pricing.prompt);
  const output = nonNegativeNumber(pricing.completion);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = nonNegativeNumber(pricing.input_cache_reads);
  return {
    input: perMillion(input),
    output: perMillion(output),
    ...(cacheRead === undefined ? {} : { cacheRead: perMillion(cacheRead) }),
  };
}

export function modelPricingFields(cost: ModelCost | undefined): ModelPricingFields | undefined {
  if (!cost) return undefined;
  if (cost.input === 0 && cost.output === 0) {
    return {
      pricing: "Free",
      inputCost: 0,
      outputCost: 0,
      ...(cost.cacheRead === undefined ? {} : { cacheCost: 0 }),
      priceCategory: "low",
    };
  }
  return {
    pricing: `In: $${formatPrice(cost.input)} · Out: $${formatPrice(cost.output)} /1M tokens`,
    inputCost: Math.round(cost.input * 100),
    outputCost: Math.round(cost.output * 100),
    ...(cost.cacheRead === undefined ? {} : { cacheCost: Math.round(cost.cacheRead * 100) }),
    priceCategory: costCategory(cost),
  };
}

export function costCategory(cost: Pick<ModelCost, "input" | "output">): ModelPricingFields["priceCategory"] {
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function perMillion(value: number): number {
  return Number((value * 1_000_000).toFixed(6));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
