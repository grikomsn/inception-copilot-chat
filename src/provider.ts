import * as vscode from "vscode";
import { InceptionAuth } from "./auth/auth";
import { messageOf } from "./errors";
import {
  FALLBACK_MODEL_METADATA,
  FALLBACK_MODELS,
  formatTokenLimit,
  formatModelName,
  orderModelMetadata,
  type InceptionApiModel,
  type InceptionModelMetadata,
} from "./models/catalog";
import {
  DEFAULT_REASONING_EFFORT,
  applyReasoningEffort,
  buildModelConfigurationSchema,
  contextSizeOptions,
  resolveContextCap,
  resolveContextSize,
  resolveReasoningEffort,
  type ReasoningEffort,
} from "./models/options";
import { ChatCompletionStreamParser, validateStreamCompletion, type ChatStreamEvent } from "./transport/sse";
import { INCEPTION_ENDPOINTS, inceptionHeaders } from "./transport/protocol";
import { reportEvent } from "./provider/response";
import { buildRequest } from "./provider/request";
import { messageToText } from "./provider/messages";
import { modelPricingFields } from "./models/pricing";
import {
  mergeUsageError,
  recordRequestUsage,
  toProviderUsagePayload,
  type InceptionUsageSnapshot,
  type ProviderUsagePayload,
} from "./usage/domain";
import { apiKeyFromConfiguration, credentialRefForApiKey, qualifiedModelId } from "./provider-profile";

export { API_BASE } from "./transport/protocol";

export interface InceptionModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  credentialRef: string;
}

export class InceptionProvider implements vscode.LanguageModelChatProvider<InceptionModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  private readonly usageEmitter = new vscode.EventEmitter<string>();
  /** Fires with the credential ref whose locally tracked usage changed. */
  readonly onDidChangeUsage = this.usageEmitter.event;
  private readonly catalogs = new Map<string, InceptionModelMetadata[]>();
  private readonly refreshedAt = new Map<string, number>();
  private readonly apiKeys = new Map<string, string>();
  private readonly usage = new Map<string, InceptionUsageSnapshot>();

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("inceptionCopilot");
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  constructor(
    private readonly auth: InceptionAuth,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: Record<string, InceptionUsageSnapshot> = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    for (const [credentialRef, snapshot] of Object.entries(initialUsage)) {
      if (snapshot && typeof snapshot === "object") this.usage.set(credentialRef, snapshot);
    }
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  async configureApiKey(apiKey: string): Promise<string[]> {
    const models = await this.fetchModels(apiKey.trim());
    await this.auth.storeApiKey(apiKey);
    this.setCatalog("legacy", models);
    this.changeEmitter.fire();
    return models.map(({ id }) => id);
  }

  async clearApiKey(): Promise<void> {
    await this.auth.clearApiKey();
    this.apiKeys.delete("legacy");
    this.setCatalog("legacy", [...FALLBACK_MODEL_METADATA]);
    this.refreshedAt.delete("legacy");
    this.clearUsage("legacy");
    this.changeEmitter.fire();
  }

  getUsageSnapshot(credentialRef: string): InceptionUsageSnapshot | undefined {
    return this.usage.get(credentialRef);
  }

  getUsageSnapshots(): Record<string, InceptionUsageSnapshot> {
    return Object.fromEntries(this.usage);
  }

  clearUsage(credentialRef: string): void {
    if (!this.usage.delete(credentialRef)) return;
    this.usageEmitter.fire(credentialRef);
  }

  /**
   * Records usage from the inline-completion providers (FIM/next edit). The
   * resolved API key identifies the credential so inline usage joins the same
   * snapshot as chat usage; unmatched keys fall back to the legacy scope.
   */
  recordInlineUsage(
    usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number; reasoningTokens?: number },
    modelId: string,
    apiKey: string | undefined,
  ): void {
    const payload = toProviderUsagePayload({
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      prompt_tokens_details: usage.cachedTokens === undefined ? undefined : { cached_tokens: usage.cachedTokens },
      completion_tokens_details: usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
    });
    this.setUsage(this.credentialRefForApiKey(apiKey), payload, modelId);
  }

  private credentialRefForApiKey(apiKey: string | undefined): string {
    if (apiKey !== undefined) {
      for (const [credentialRef, stored] of this.apiKeys) {
        if (stored === apiKey) return credentialRef;
      }
    }
    return "legacy";
  }

  private setUsage(credentialRef: string, usage: ProviderUsagePayload, modelId: string): void {
    const next = recordRequestUsage(this.usage.get(credentialRef), usage, modelId);
    this.usage.set(credentialRef, next);
    this.usageEmitter.fire(credentialRef);
  }

  /** Surfaces quota (402) and rate-limit (429) failures in the usage snapshot. */
  private recordRequestFailure(status: number, credentialRef: string): void {
    if (status !== 402 && status !== 429) return;
    this.setUsageError(credentialRef, status === 402
      ? "Inception rejected the request (HTTP 402): billing inactive or free tokens exhausted"
      : "Inception rate limit reached (HTTP 429)");
  }

  private setUsageError(credentialRef: string, error: string): void {
    this.usage.set(credentialRef, mergeUsageError(this.usage.get(credentialRef), error));
    this.usageEmitter.fire(credentialRef);
  }

  private reportStreamEvent(
    event: ChatStreamEvent,
    model: InceptionModel,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  ): void {
    if (event.usage) this.setUsage(model.credentialRef, toProviderUsagePayload(event.usage), model.rawModelId);
    reportEvent(event, progress, this.output, this.debugLogging);
  }

  async refreshModels(): Promise<string[]> {
    const apiKey = await this.requireApiKey(false, "legacy");
    const models = await this.refreshCatalog("legacy", apiKey);
    this.changeEmitter.fire();
    return models.map(({ id }) => id);
  }

  /**
   * Any API key captured from a native provider entry during model discovery.
   * Used as a fallback when the command-managed key is absent.
   */
  firstConfiguredApiKey(): string | undefined {
    return this.apiKeys.values().next().value ?? undefined;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<InceptionModel[]> {
    const legacyApiKey = await this.auth.getApiKey();
    const configuredApiKey = options.configuration
      ? apiKeyFromConfiguration(options.configuration)
      : undefined;
    if (token.isCancellationRequested || (options.configuration && !configuredApiKey)) return [];
    const apiKey = configuredApiKey ?? legacyApiKey;
    const credentialRef = configuredApiKey
      ? credentialRefForApiKey(configuredApiKey, legacyApiKey)
      : "legacy";
    if (apiKey) this.apiKeys.set(credentialRef, apiKey);
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 5)) * 60_000;
    if (apiKey && Date.now() - (this.refreshedAt.get(credentialRef) ?? 0) > maxAge) {
      try {
        await this.refreshCatalog(credentialRef, apiKey, token);
      } catch (error) {
        if (!token.isCancellationRequested) {
          this.output.appendLine(`[models] discovery failed; using cached/fallback list: ${messageOf(error)}`);
        }
      }
    }

    const defaultEffort = resolveReasoningEffort(
      undefined,
      this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT),
    );
    return this.catalogFor(credentialRef).map((metadata) => {
      const pricing = modelPricingFields(metadata.cost);
      const tooltipParts = [
        `${metadata.id} via the hosted Inception API`,
        `${formatTokenLimit(metadata.contextLength)} context`,
        `${formatTokenLimit(metadata.maxOutputTokens)} max output`,
        "text only",
      ];
      if (pricing) tooltipParts.push(pricing.pricing);
      return {
        id: qualifiedModelId(credentialRef, metadata.id),
        rawModelId: metadata.id,
        credentialRef,
        name: formatModelName(metadata.id),
        family: "inception-mercury",
        version: metadata.version,
        detail: credentialRef === "legacy"
          ? (apiKey ? "Inception Platform" : "Inception API key required")
          : `Inception Platform · ${credentialRef.slice(0, 8)}`,
        tooltip: tooltipParts.join(" · "),
        maxInputTokens: metadata.contextLength,
        maxOutputTokens: metadata.maxOutputTokens,
        isUserSelectable: true,
        ...(pricing === undefined ? {} : pricing),
        ...(credentialRef !== "legacy" ? { isBYOK: true } : {}),
        ...(credentialRef === "legacy" && !apiKey
          ? { requiresAuthorization: { label: "Configure Inception API key" } }
          : {}),
        configurationSchema: buildModelConfigurationSchema(defaultEffort, contextSizeOptions(metadata.contextLength)),
        capabilities: {
          imageInput: false,
          toolCalling: true,
        },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: InceptionModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (token.isCancellationRequested) return;
    const apiKey = await this.requireApiKey(false, model.credentialRef);
    const reasoningEffort = resolveReasoningEffort(
      options.modelConfiguration,
      this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT),
    );
    const requestBody = buildRequest(model.rawModelId, messages, options, reasoningEffort, model.maxOutputTokens, this.configuration.get("maxOutputTokens", 16384), resolveContextCap(resolveContextSize(options.modelConfiguration), model.maxInputTokens));
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const timeoutSeconds = Math.max(10, this.configuration.get("requestTimeoutSeconds", 600));
    const idleTimeoutSeconds = Math.max(10, this.configuration.get("streamIdleTimeoutSeconds", 120));
    let timedOut: "total" | "idle" | undefined;
    const totalTimeout = setTimeout(() => {
      timedOut = "total";
      controller.abort();
    }, timeoutSeconds * 1000);
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimeout = (): void => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        timedOut = "idle";
        controller.abort();
      }, idleTimeoutSeconds * 1000);
    };
    resetIdleTimeout();
    try {
      if (this.debugLogging) {
        this.output.appendLine(`[request] model=${model.rawModelId} effort=${reasoningEffort} initiator=${options.requestInitiator ?? "unknown"}`);
      }
      const response = await this.fetcher(INCEPTION_ENDPOINTS.chat, {
        method: "POST",
        headers: this.requestHeaders(apiKey, "text/event-stream"),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.recordRequestFailure(response.status, model.credentialRef);
        throw await apiError(`Inception request failed for ${model.rawModelId}`, response);
      }
      if (!response.body) throw new Error("Inception returned an empty response stream");

      const parser = new ChatCompletionStreamParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        if (token.isCancellationRequested) {
          await reader.cancel();
          return;
        }
        const result = await reader.read();
        if (result.done) break;
        resetIdleTimeout();
        for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
          this.reportStreamEvent(event, model, progress);
        }
      }
      for (const event of parser.finish()) this.reportStreamEvent(event, model, progress);
      validateStreamCompletion(parser.finishReason);
    } catch (error) {
      if (token.isCancellationRequested) return;
      if (timedOut === "idle") throw new Error(`Inception request for ${model.rawModelId} received no data for ${idleTimeoutSeconds} seconds`);
      if (timedOut === "total") throw new Error(`Inception request for ${model.rawModelId} exceeded ${timeoutSeconds} seconds`);
      throw error;
    } finally {
      clearTimeout(totalTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: InceptionModel,
    value: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const text = typeof value === "string" ? value : messageToText(value);
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async testConnection(): Promise<{ model: string; reasoningEffort: ReasoningEffort; text: string }> {
    const credentialRef = "legacy";
    const apiKey = await this.requireApiKey(false, credentialRef);
    const models = this.catalogFor(credentialRef);
    const model = models.some(({ id }) => id === "mercury-2")
      ? "mercury-2"
      : models[0]?.id ?? FALLBACK_MODELS[0];
    const reasoningEffort = resolveReasoningEffort(
      undefined,
      this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT),
    );
    const response = await this.fetcher(INCEPTION_ENDPOINTS.chat, {
      method: "POST",
      headers: this.requestHeaders(apiKey, "application/json"),
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify(applyReasoningEffort({
        model,
        messages: [{ role: "user", content: "Reply with exactly: Inception connection verified" }],
        max_completion_tokens: 4096,
        stream: false,
      }, reasoningEffort)),
    });
    if (!response.ok) {
      this.recordRequestFailure(response.status, credentialRef);
      throw await apiError("Inception connection test failed", response);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };
    if (body.usage) this.setUsage(credentialRef, toProviderUsagePayload(body.usage), model);
    return { model, reasoningEffort, text: body.choices?.[0]?.message?.content?.trim() ?? "(empty response)" };
  }

  private async fetchModels(apiKey: string): Promise<InceptionModelMetadata[]> {
    if (!apiKey) throw new Error("Inception API key is not configured");
    const response = await this.fetcher(INCEPTION_ENDPOINTS.models, {
      headers: this.requestHeaders(apiKey, "application/json, application/problem+json"),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await apiError("Unable to list Inception models", response);
    const body = (await response.json()) as { data?: InceptionApiModel[] } | null;
    if (!body || !Array.isArray(body.data)) throw new Error("Inception returned an invalid model catalog");
    const models = orderModelMetadata(body.data);
    if (!models.length) throw new Error("Inception returned no chat-capable models");
    if (this.debugLogging) this.output.appendLine(`[models] ${models.map(({ id }) => id).join(", ")}`);
    return models;
  }

  private async requireApiKey(prompt: boolean, credentialRef: string): Promise<string> {
    let apiKey = credentialRef === "legacy" ? await this.auth.getApiKey() : this.apiKeys.get(credentialRef);
    if (!apiKey && prompt && credentialRef === "legacy") {
      await vscode.commands.executeCommand("inceptionCopilot.configureApiKey");
      apiKey = await this.auth.getApiKey();
    }
    if (!apiKey) {
      throw new Error(credentialRef === "legacy"
        ? "Inception API key is not configured. Run ‘Inception: Configure API Key’."
        : "The API key for this Inception provider entry is unavailable. Update the entry in Manage Language Models.");
    }
    return apiKey;
  }

  private catalogFor(credentialRef: string): InceptionModelMetadata[] {
    let catalog = this.catalogs.get(credentialRef);
    if (!catalog) {
      catalog = [...FALLBACK_MODEL_METADATA];
      this.catalogs.set(credentialRef, catalog);
    }
    return catalog;
  }

  private setCatalog(credentialRef: string, models: readonly InceptionModelMetadata[]): void {
    this.catalogs.set(credentialRef, [...models]);
    this.refreshedAt.set(credentialRef, Date.now());
  }

  private async refreshCatalog(
    credentialRef: string,
    apiKey: string,
    token?: vscode.CancellationToken,
  ): Promise<InceptionModelMetadata[]> {
    if (token?.isCancellationRequested) return this.catalogFor(credentialRef);
    const models = await this.fetchModels(apiKey);
    this.setCatalog(credentialRef, models);
    return models;
  }

  private requestHeaders(apiKey: string, accept: string): Record<string, string> {
    return inceptionHeaders(apiKey, accept, this.userAgent);
  }


}

async function apiError(prefix: string, response: Response): Promise<Error> {
  // Upstream error bodies can echo prompts or credentials. Keep diagnostics safe.
  await response.body?.cancel();
  return new Error(`${prefix} (HTTP ${response.status})`);
}
