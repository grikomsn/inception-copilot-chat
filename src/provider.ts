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
  resolveReasoningEffort,
  type ReasoningEffort,
} from "./models/options";
import { ChatCompletionStreamParser, validateStreamCompletion } from "./transport/sse";
import { INCEPTION_ENDPOINTS, inceptionHeaders } from "./transport/protocol";
import { reportEvent } from "./provider/response";
import { buildRequest } from "./provider/request";
import { messageToText } from "./provider/messages";
import { apiKeyFromConfiguration, credentialRefForApiKey, qualifiedModelId } from "./provider-profile";

export { API_BASE } from "./transport/protocol";

export interface InceptionModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  credentialRef: string;
}

export class InceptionProvider implements vscode.LanguageModelChatProvider<InceptionModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  private readonly catalogs = new Map<string, InceptionModelMetadata[]>();
  private readonly refreshedAt = new Map<string, number>();
  private readonly apiKeys = new Map<string, string>();

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
    private readonly fetcher: typeof fetch = fetch,
  ) {}

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
    this.changeEmitter.fire();
  }

  async refreshModels(): Promise<string[]> {
    const apiKey = await this.requireApiKey(false, "legacy");
    const models = await this.refreshCatalog("legacy", apiKey);
    this.changeEmitter.fire();
    return models.map(({ id }) => id);
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
    return this.catalogFor(credentialRef).map((metadata) => ({
      id: qualifiedModelId(credentialRef, metadata.id),
      rawModelId: metadata.id,
      credentialRef,
      name: formatModelName(metadata.id),
      family: "inception-mercury",
      version: metadata.version,
      detail: credentialRef === "legacy"
        ? (apiKey ? "Inception Platform" : "Inception API key required")
        : `Inception Platform · ${credentialRef.slice(0, 8)}`,
      tooltip: `${metadata.id} via the hosted Inception API · ${formatTokenLimit(metadata.contextLength)} context · ${formatTokenLimit(metadata.maxOutputTokens)} max output · text only`,
      maxInputTokens: metadata.contextLength,
      maxOutputTokens: metadata.maxOutputTokens,
      isUserSelectable: true,
      ...(credentialRef !== "legacy" ? { isBYOK: true } : {}),
      ...(credentialRef === "legacy" && !apiKey
        ? { requiresAuthorization: { label: "Configure Inception API key" } }
        : {}),
      configurationSchema: buildModelConfigurationSchema(defaultEffort),
      capabilities: {
        imageInput: false,
        toolCalling: true,
      },
    }));
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
    const requestBody = buildRequest(model.rawModelId, messages, options, reasoningEffort, model.maxOutputTokens, this.configuration.get("maxOutputTokens", 16384));
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
      if (!response.ok) throw await apiError(`Inception request failed for ${model.rawModelId}`, response);
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
          reportEvent(event, progress, this.output, this.debugLogging);
        }
      }
      for (const event of parser.finish()) reportEvent(event, progress, this.output, this.debugLogging);
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
    if (!response.ok) throw await apiError("Inception connection test failed", response);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
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
