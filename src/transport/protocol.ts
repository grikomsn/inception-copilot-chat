export const API_BASE = "https://api.inceptionlabs.ai/v1";

export const INCEPTION_ENDPOINTS = {
  models: `${API_BASE}/chat/completions/models`,
  chat: `${API_BASE}/chat/completions`,
  fim: `${API_BASE}/fim/completions`,
} as const;

export function extensionUserAgent(version: string, vscodeVersion: string): string {
  return `inception-copilot-chat/${version} VSCode/${vscodeVersion}`;
}

export function inceptionHeaders(apiKey: string, accept: string, userAgent: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: accept,
    "User-Agent": userAgent,
  };
}
