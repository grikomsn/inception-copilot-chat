import { inceptionHeaders } from "./protocol";

export interface EditCompletionRequest {
  readonly model: string;
  /** Single user message containing the required edit prompt tags. */
  readonly content: string;
  readonly maxTokens: number;
}

export interface EditUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface EditCompletion {
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: EditUsage;
  readonly warning?: string;
}

interface EditResponsePayload {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  warning?: unknown;
}

/**
 * Client for the Inception next-edit endpoint. Requests carry a single user
 * message with the required edit prompt tags; responses are non-streaming
 * chat-shaped payloads. The endpoint is treated as an undocumented
 * integration surface: parse defensively and never include upstream bodies in
 * error messages.
 */
export class EditClient {
  constructor(
    private readonly endpoint: string,
    private readonly modelsEndpoint: string,
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async complete(apiKey: string, request: EditCompletionRequest, signal: AbortSignal): Promise<EditCompletion> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: inceptionHeaders(apiKey, "application/json, application/problem+json", this.userAgent),
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content: request.content }],
        max_tokens: request.maxTokens,
      }),
      signal,
    });
    if (!response.ok) throw await editError(response);
    return parseEditResponse(await jsonBody(response));
  }

  /** Lists model ids available for edit completions; falls back to a default. */
  async listModels(apiKey: string, fallback: readonly string[]): Promise<string[]> {
    try {
      const response = await this.fetcher(this.modelsEndpoint, {
        headers: inceptionHeaders(apiKey, "application/json", this.userAgent),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return [...fallback];
      const body = (await response.json()) as { data?: Array<{ id?: unknown }> } | null;
      const ids = (body?.data ?? [])
        .map((entry) => (typeof entry?.id === "string" ? entry.id : undefined))
        .filter((id): id is string => Boolean(id))
        .filter((id) => id.startsWith("mercury") && !/embedding/i.test(id));
      const unique = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
      return unique.length ? unique : [...fallback];
    } catch {
      return [...fallback];
    }
  }
}

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Inception returned an invalid edit response");
  }
}

function parseEditResponse(payload: unknown): EditCompletion {
  if (!payload || typeof payload !== "object") throw new Error("Inception returned an invalid edit response");
  const body = payload as EditResponsePayload;
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : contentTextParts(content);
  if (text === undefined) throw new Error("Inception returned no edit completion content");
  return {
    text,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
    usage: parseUsage(body.usage),
    warning: typeof body.warning === "string" && body.warning ? body.warning : undefined,
  };
}

/** Defensive: content may arrive as OpenAI-style text parts instead of a string. */
function contentTextParts(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : undefined))
    .filter((part): part is string => part !== undefined);
  return parts.length ? parts.join("") : undefined;
}

function parseUsage(usage: unknown): EditUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokens = positiveInteger((usage as { prompt_tokens?: unknown }).prompt_tokens);
  const completionTokens = positiveInteger((usage as { completion_tokens?: unknown }).completion_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  return { promptTokens, completionTokens };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function editError(response: Response): Promise<Error> {
  // Upstream error bodies can echo prompt context. Keep diagnostics safe.
  await response.body?.cancel();
  return new Error(`Inception edit request failed (HTTP ${response.status})`);
}