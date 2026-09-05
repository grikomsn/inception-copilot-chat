/** Provider usage normalization, local token tracking, and display formatting. */

export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

/**
 * Published Mercury rates as integer nanodollars (10^-9 USD) per token:
 * $0.25/1M input, $0.025/1M cached input, $0.75/1M output. Cache-write tokens
 * are currently free. Local estimates only; Inception billing is authoritative.
 */
export const INPUT_NANODOLLARS_PER_TOKEN = 250;
export const CACHED_INPUT_NANODOLLARS_PER_TOKEN = 25;
export const OUTPUT_NANODOLLARS_PER_TOKEN = 750;

export interface RequestTokenUsage {
  readonly modelId: string;
  readonly recordedAt: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly costUsdNanos?: number;
}

export interface TrackedTokenUsage {
  readonly requests: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdNanos: number;
}

export interface InceptionUsageSnapshot {
  readonly lastRequest?: RequestTokenUsage;
  readonly tracked?: TrackedTokenUsage;
  readonly error?: string;
  readonly updatedAt?: number;
}

export interface UsageDisplayRow {
  readonly kind: "tracked" | "request" | "estimate" | "warning" | "empty";
  readonly label: string;
  readonly description: string;
  readonly detail?: string;
}

export function toProviderUsagePayload(raw: Record<string, unknown>): ProviderUsagePayload {
  const promptTokens = finiteNumber(raw.prompt_tokens ?? raw.input_tokens);
  const completionTokens = finiteNumber(raw.completion_tokens ?? raw.output_tokens);
  const totalTokens = finiteNumber(raw.total_tokens)
    ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  const promptDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined;
  const completionDetails = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : undefined;
  // Inception responses also carry flat `cached_input_tokens`/`reasoning_tokens`.
  const cachedTokens = finiteNumber(promptDetails?.cached_tokens ?? raw.cached_input_tokens);
  const reasoningTokens = finiteNumber(completionDetails?.reasoning_tokens ?? raw.reasoning_tokens);

  return compactObject({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: cachedTokens === undefined ? undefined : { cached_tokens: cachedTokens },
    completion_tokens_details: reasoningTokens === undefined ? undefined : { reasoning_tokens: reasoningTokens },
  });
}

/**
 * Local cost estimate from published Mercury rates. Cached prompt tokens are a
 * subset of `prompt_tokens`, so they are billed at the cached rate instead of
 * the input rate. Returns `undefined` when token counts are incomplete.
 */
export function estimateCostUsdNanos(usage: ProviderUsagePayload): number | undefined {
  if (usage.prompt_tokens === undefined || usage.completion_tokens === undefined) return undefined;
  const prompt = Math.max(0, usage.prompt_tokens);
  const cached = Math.min(Math.max(0, usage.prompt_tokens_details?.cached_tokens ?? 0), prompt);
  const completion = Math.max(0, usage.completion_tokens);
  return (prompt - cached) * INPUT_NANODOLLARS_PER_TOKEN
    + cached * CACHED_INPUT_NANODOLLARS_PER_TOKEN
    + completion * OUTPUT_NANODOLLARS_PER_TOKEN;
}

export function recordRequestUsage(
  current: InceptionUsageSnapshot | undefined,
  usage: ProviderUsagePayload,
  modelId: string,
  recordedAt: number = Date.now(),
): InceptionUsageSnapshot {
  const totalTokens = usage.total_tokens
    ?? (usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined
      ? usage.prompt_tokens + usage.completion_tokens
      : undefined);
  const lastRequest: RequestTokenUsage = compactObject({
    modelId,
    recordedAt,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    costUsdNanos: estimateCostUsdNanos(usage),
  });
  const previous = current?.tracked;
  const tracked: TrackedTokenUsage = {
    requests: (previous?.requests ?? 0) + 1,
    promptTokens: (previous?.promptTokens ?? 0) + (usage.prompt_tokens ?? 0),
    completionTokens: (previous?.completionTokens ?? 0) + (usage.completion_tokens ?? 0),
    totalTokens: (previous?.totalTokens ?? 0) + (totalTokens ?? 0),
    cachedTokens: (previous?.cachedTokens ?? 0) + (usage.prompt_tokens_details?.cached_tokens ?? 0),
    reasoningTokens: (previous?.reasoningTokens ?? 0) + (usage.completion_tokens_details?.reasoning_tokens ?? 0),
    costUsdNanos: (previous?.costUsdNanos ?? 0) + (estimateCostUsdNanos(usage) ?? 0),
  };
  return { ...current, lastRequest, tracked, updatedAt: recordedAt };
}

/** Records a request failure (HTTP status only) while keeping tracked totals. */
export function mergeUsageError(
  current: InceptionUsageSnapshot | undefined,
  error: string,
  updatedAt: number = Date.now(),
): InceptionUsageSnapshot {
  return { ...current, error, updatedAt };
}

/** Aggregates per-credential snapshots into one view: summed counters, most recent request. */
export function mergeUsageSnapshots(snapshots: readonly InceptionUsageSnapshot[]): InceptionUsageSnapshot {
  let lastRequest: RequestTokenUsage | undefined;
  let updatedAt: number | undefined;
  const errors: string[] = [];
  const tracked = emptyTracked();
  let hasTracked = false;
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    const candidate = snapshot.lastRequest;
    if (candidate && (lastRequest === undefined || candidate.recordedAt > lastRequest.recordedAt)) lastRequest = candidate;
    if (snapshot.tracked) {
      hasTracked = true;
      tracked.requests += snapshot.tracked.requests;
      tracked.promptTokens += snapshot.tracked.promptTokens;
      tracked.completionTokens += snapshot.tracked.completionTokens;
      tracked.totalTokens += snapshot.tracked.totalTokens;
      tracked.cachedTokens += snapshot.tracked.cachedTokens;
      tracked.reasoningTokens += snapshot.tracked.reasoningTokens;
      tracked.costUsdNanos += snapshot.tracked.costUsdNanos;
    }
    if (snapshot.error) errors.push(snapshot.error);
    if (snapshot.updatedAt !== undefined && (updatedAt === undefined || snapshot.updatedAt > updatedAt)) {
      updatedAt = snapshot.updatedAt;
    }
  }
  return compactObject({
    lastRequest,
    tracked: hasTracked ? tracked : undefined,
    error: errors.join("; ") || undefined,
    updatedAt,
  });
}

export function formatUsageStatusBar(snapshot: InceptionUsageSnapshot, hasKey = true): string {
  const tracked = snapshot.tracked;
  if (tracked?.requests) return `$(graph) Inception ${compactTokens(tracked.totalTokens)}`;
  if (snapshot.error) return "$(warning) Inception usage";
  return hasKey ? "$(sparkle) Inception" : "$(key) Inception";
}

export function formatUsageTooltip(snapshot: InceptionUsageSnapshot): string {
  const lines = ["Inception usage tracked on this device"];
  const tracked = snapshot.tracked;
  if (tracked) {
    lines.push(`Tokens: ${tracked.totalTokens.toLocaleString()} across ${tracked.requests.toLocaleString()} requests`);
    lines.push(`Estimated spend: ${formatUsdNanos(tracked.costUsdNanos)} (published Mercury rates)`);
  }
  if (snapshot.lastRequest) lines.push(`Last request: ${formatRequestUsage(snapshot.lastRequest)}`);
  if (snapshot.error) lines.push("Inception reported a request error; see details");
  if (snapshot.updatedAt) lines.push(`Updated ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Counts are local; the Inception dashboard is authoritative");
  lines.push("Click for usage and settings");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: InceptionUsageSnapshot): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  const tracked = snapshot.tracked;
  if (tracked) {
    rows.push({
      kind: "tracked",
      label: "Tracked usage (this device)",
      description: `${compactTokens(tracked.totalTokens)} tokens across ${tracked.requests.toLocaleString()} requests`,
      detail: [
        `${exactCount(tracked.promptTokens)} input`,
        `${exactCount(tracked.completionTokens)} output`,
        `${exactCount(tracked.cachedTokens)} cached`,
        `${exactCount(tracked.reasoningTokens)} reasoning`,
      ].join(" · "),
    });
    rows.push({
      kind: "estimate",
      label: "Estimated spend",
      description: formatUsdNanos(tracked.costUsdNanos),
      detail: "Local estimate from published Mercury rates ($0.25 / $0.025 cached / $0.75 per 1M tokens); excludes free-grant tokens. The Inception dashboard is authoritative.",
    });
  }
  if (snapshot.lastRequest) {
    rows.push({
      kind: "request",
      label: "Last request",
      description: formatRequestUsage(snapshot.lastRequest),
      detail: `${snapshot.lastRequest.modelId} · ${new Date(snapshot.lastRequest.recordedAt).toLocaleString()}`,
    });
  }
  if (snapshot.error) {
    rows.push({
      kind: "warning",
      label: "Inception request error",
      description: "Check connection, billing, or rate limits",
      detail: snapshot.error,
    });
  }
  if (!rows.length) {
    rows.push({
      kind: "empty",
      label: "No usage recorded yet",
      description: "Use Mercury in Copilot Chat or accept an inline suggestion",
    });
  }
  return rows;
}

export function formatUsdNanos(nanos: number): string {
  const usd = nanos / 1_000_000_000;
  if (usd > 0 && usd < 0.000001) return "<$0.000001";
  if (usd > 0 && usd < 0.1) return `$${trimZeroes(usd.toFixed(6))}`;
  return `$${usd.toFixed(2)}`;
}

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimDecimal(tokens / 1_000_000)}M`;
  if (tokens >= 1000) return `${trimDecimal(tokens / 1000)}K`;
  return String(tokens);
}

interface MutableTrackedUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsdNanos: number;
}

function emptyTracked(): MutableTrackedUsage {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsdNanos: 0,
  };
}

function formatRequestUsage(usage: RequestTokenUsage): string {
  const tokens = `${exactCount(usage.promptTokens)} in + ${exactCount(usage.completionTokens)} out`;
  return usage.costUsdNanos === undefined ? tokens : `${formatUsdNanos(usage.costUsdNanos)} · ${tokens}`;
}

function exactCount(value: number | undefined): string {
  return value === undefined ? "?" : value.toLocaleString();
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function trimZeroes(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
