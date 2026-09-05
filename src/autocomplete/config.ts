export interface ConfigurationReader {
  get<T>(section: string): T | undefined;
}

export const AUTOCOMPLETE_SECTION = "autocomplete";

export interface AutocompleteSettings {
  readonly enabled: boolean;
  readonly model: string;
  readonly debounceMs: number;
  readonly maxTokens: number;
  readonly maxPromptTokens: number;
  readonly requestTimeoutMs: number;
}

export const AUTOCOMPLETE_DEFAULTS: AutocompleteSettings = {
  enabled: true,
  model: "mercury-edit-2",
  debounceMs: 100,
  maxTokens: 256,
  maxPromptTokens: 8192,
  requestTimeoutMs: 5000,
};

export function resolveAutocompleteSettings(reader: ConfigurationReader | undefined): AutocompleteSettings {
  const raw = reader?.get<Record<string, unknown>>(AUTOCOMPLETE_SECTION) ?? {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : AUTOCOMPLETE_DEFAULTS.enabled,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : AUTOCOMPLETE_DEFAULTS.model,
    debounceMs: clampNumber(raw.debounceMs, 0, 2000, AUTOCOMPLETE_DEFAULTS.debounceMs),
    maxTokens: clampNumber(raw.maxTokens, 16, 8192, AUTOCOMPLETE_DEFAULTS.maxTokens),
    maxPromptTokens: clampNumber(raw.maxPromptTokens, 256, 32000, AUTOCOMPLETE_DEFAULTS.maxPromptTokens),
    requestTimeoutMs: clampNumber(raw.requestTimeoutMs, 500, 60000, AUTOCOMPLETE_DEFAULTS.requestTimeoutMs),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
