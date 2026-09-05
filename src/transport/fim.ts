import { inceptionHeaders } from "./protocol";

export interface FimCompletionRequest {
  readonly model: string;
  readonly prompt: string;
  readonly suffix: string;
  readonly maxTokens: number;
}

export interface FimUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface FimCompletion {
  /** Response identifier, used as the feedback request id. */
  readonly id?: string;
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: FimUsage;
  readonly warning?: string;
}

/** Returns `false` to abandon an in-flight suggestion (e.g. stale document). */
export type FimContinuation = () => boolean;

interface TextChunkPayload {
  id?: unknown;
  choices?: Array<{ text?: unknown; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  warning?: unknown;
}

/**
 * Client for the Inception fill-in-the-middle endpoint. Requests stream SSE
 * text-completion chunks (`choices[].text`, not chat deltas); text is
 * accumulated into one completion because the stable inline-completion API
 * cannot render partial items. An optional continuation predicate abandons
 * mid-flight reads so superseded suggestions stop consuming tokens. The
 * endpoint is treated as an undocumented integration surface: parse
 * defensively and never include upstream bodies in error messages.
 */
export class FimClient {
  constructor(
    private readonly endpoint: string,
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async complete(
    apiKey: string,
    request: FimCompletionRequest,
    signal: AbortSignal,
    shouldContinue?: FimContinuation,
  ): Promise<FimCompletion | undefined> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: inceptionHeaders(apiKey, "text/event-stream, application/json, application/problem+json", this.userAgent),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        suffix: request.suffix,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
    if (!response.ok) throw await fimError(response);
    if (!response.body) throw new Error("Inception returned an empty FIM response stream");
    return await this.readStream(response.body, shouldContinue);
  }

  private async readStream(body: ReadableStream<Uint8Array>, shouldContinue?: FimContinuation): Promise<FimCompletion | undefined> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const session: FimSession = { id: undefined, text: "", finishReason: undefined, usage: undefined, warning: undefined };
    let buffer = "";
    try {
      while (true) {
        if (shouldContinue?.() === false) {
          await reader.cancel();
          return undefined;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeLines(buffer, session);
        if (session.done) {
          await reader.cancel();
          break;
        }
      }
      if (!session.done) consumeLines(`${buffer}\n`, session);
    } finally {
      reader.releaseLock();
    }
    return {
      id: session.id,
      text: session.text,
      finishReason: session.finishReason,
      usage: session.usage,
      warning: session.warning,
    };
  }
}

interface FimSession {
  id: string | undefined;
  text: string;
  finishReason: string | undefined;
  usage: FimUsage | undefined;
  warning: string | undefined;
  done?: boolean;
}

/** Consumes complete SSE lines from `buffer`, mutating `session`. */
function consumeLines(buffer: string, session: FimSession): string {
  let remaining = buffer;
  let newline = remaining.indexOf("\n");
  while (newline >= 0) {
    const line = remaining.slice(0, newline).replace(/\r$/, "");
    remaining = remaining.slice(newline + 1);
    consumeLine(line, session);
    if (session.done) return remaining;
    newline = remaining.indexOf("\n");
  }
  return remaining;
}

function consumeLine(line: string, session: FimSession): void {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload) return;
  if (payload === "[DONE]") {
    session.done = true;
    return;
  }
  if (!payload.startsWith("{")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const chunk = parsed as TextChunkPayload;
  if (session.id === undefined && typeof chunk.id === "string") session.id = chunk.id;
  if (typeof chunk.warning === "string" && chunk.warning) session.warning = chunk.warning;
  const usage = parseUsage(chunk.usage);
  if (usage) session.usage = usage;
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  if (!choice) return;
  if (typeof choice.text === "string") session.text += choice.text;
  if (typeof choice.finish_reason === "string") session.finishReason = choice.finish_reason;
}

function parseUsage(usage: unknown): FimUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokens = positiveInteger((usage as { prompt_tokens?: unknown }).prompt_tokens);
  const completionTokens = positiveInteger((usage as { completion_tokens?: unknown }).completion_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  return { promptTokens, completionTokens };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function fimError(response: Response): Promise<Error> {
  // Upstream error bodies can echo prompt context. Keep diagnostics safe.
  await response.body?.cancel();
  return new Error(`Inception FIM request failed (HTTP ${response.status})`);
}
