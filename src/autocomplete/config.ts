export interface ConfigurationReader {
  get<T>(section: string): T | undefined;
}

export const AUTOCOMPLETE_SECTION = "autocomplete";
export const NEXT_EDIT_SECTION = "nextEdit";

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

export interface NextEditSettings {
  readonly enabled: boolean;
  readonly model: string;
  readonly debounceMs: number;
  readonly maxTokens: number;
  /** Editable-region size in lines; region size dominates output latency. */
  readonly editableLines: number;
  /** Estimated token budget for the current-file context. */
  readonly maxPromptTokens: number;
  /** Lines of context kept around the cursor for recently viewed snippets. */
  readonly snippetContextLines: number;
  /** Maximum recorded edit-history hunks sent with each request. */
  readonly historyDepth: number;
  readonly requestTimeoutMs: number;
}

export const NEXT_EDIT_DEFAULTS: NextEditSettings = {
  enabled: false,
  model: "mercury-edit-2",
  debounceMs: 150,
  maxTokens: 1024,
  editableLines: 15,
  maxPromptTokens: 16384,
  snippetContextLines: 10,
  historyDepth: 5,
  requestTimeoutMs: 8000,
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

export function resolveNextEditSettings(reader: ConfigurationReader | undefined): NextEditSettings {
  const raw = reader?.get<Record<string, unknown>>(NEXT_EDIT_SECTION) ?? {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : NEXT_EDIT_DEFAULTS.enabled,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : NEXT_EDIT_DEFAULTS.model,
    maxPromptTokens: clampNumber(raw.maxPromptTokens, 1024, 32000, NEXT_EDIT_DEFAULTS.maxPromptTokens),
    debounceMs: clampNumber(raw.debounceMs, 0, 2000, NEXT_EDIT_DEFAULTS.debounceMs),
    maxTokens: clampNumber(raw.maxTokens, 64, 8192, NEXT_EDIT_DEFAULTS.maxTokens),
    editableLines: clampNumber(raw.editableLines, 5, 25, NEXT_EDIT_DEFAULTS.editableLines),
    snippetContextLines: clampNumber(raw.snippetContextLines, 0, 50, NEXT_EDIT_DEFAULTS.snippetContextLines),
    historyDepth: clampNumber(raw.historyDepth, 0, 10, NEXT_EDIT_DEFAULTS.historyDepth),
    requestTimeoutMs: clampNumber(raw.requestTimeoutMs, 1000, 60000, NEXT_EDIT_DEFAULTS.requestTimeoutMs),
  };
}
