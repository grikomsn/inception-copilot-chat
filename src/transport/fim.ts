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
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: FimUsage;
  readonly warning?: string;
}

interface FimResponsePayload {
  choices?: Array<{ text?: unknown; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  warning?: unknown;
}

/**
 * Client for the Inception fill-in-the-middle endpoint. FIM responses are
 * plain text completions (`choices[].text`), not chat deltas, and the endpoint
 * is treated as an undocumented integration surface: parse defensively and
 * never include upstream bodies in error messages.
 */
export class FimClient {
  constructor(
    private readonly endpoint: string,
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async complete(apiKey: string, request: FimCompletionRequest, signal: AbortSignal): Promise<FimCompletion> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: inceptionHeaders(apiKey, "application/json, application/problem+json", this.userAgent),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        suffix: request.suffix,
        max_tokens: request.maxTokens,
      }),
      signal,
    });
    if (!response.ok) throw await fimError(response);
    return parseFimResponse(await jsonBody(response));
  }
}

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Inception returned an invalid FIM response");
  }
}

function parseFimResponse(payload: unknown): FimCompletion {
  if (!payload || typeof payload !== "object") throw new Error("Inception returned an invalid FIM response");
  const body = payload as FimResponsePayload;
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (!choice || typeof choice.text !== "string") throw new Error("Inception returned no FIM completion text");
  return {
    text: choice.text,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
    usage: parseUsage(body.usage),
    warning: typeof body.warning === "string" && body.warning ? body.warning : undefined,
  };
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
