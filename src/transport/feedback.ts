export type FeedbackAction = "accept" | "reject" | "ignore";

export interface FeedbackReport {
  /** Suggestion identifier from the corresponding completion response. */
  readonly requestId: string;
  readonly userAction: FeedbackAction;
}

/**
 * Fire-and-forget reporter for Inception's suggestion-outcome feedback
 * endpoint. The payload contains outcome metadata only (request id, action,
 * and provider identity) — never code, prompts, or credentials. Failures are
 * never fatal and are left for callers to log at debug level.
 */
export class FeedbackClient {
  constructor(
    private readonly endpoint: string,
    private readonly providerName: string,
    private readonly providerVersion: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /**
   * Sends one outcome report; resolves `true` when accepted upstream. Network
   * failures resolve `false` so callers can treat feedback as best-effort.
   * The API key is optional and is never sent unless provided.
   */
  async report(apiKey: string | undefined, report: FeedbackReport): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": this.userAgent(),
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          request_id: report.requestId,
          provider_name: this.providerName,
          user_action: report.userAction,
          provider_version: this.providerVersion,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  private userAgent(): string {
    return `${this.providerName}-feedback/${this.providerVersion}`;
  }
}