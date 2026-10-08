# API key and security

## Credential storage

All API keys belong to native entries in **Manage Language Models** and are supplied through VS Code's secret provider configuration. The extension holds provisioned keys in memory only; it does not read or write a command-managed key or mirror secrets into workspace settings, files, logs, or global state.

Every entry requires a unique `entryId` (1–64 lowercase letters, numbers, dots, underscores or hyphens). Use separate IDs for separate native entries, even if they share a display name. Keep the ID when rotating a key so model selections remain stable. Catalogs and request credentials are scoped by a one-way key fingerprint; model handles also carry an entry generation and are rejected after rotation or removal. Entries sharing the same API key share its credential scope.

Delete or update credentials through **Manage Language Models**. **Inception: Forget Loaded Entry** revokes the in-memory binding and persists its ID in an alias-only block list, preventing automatic rediscovery or restart from reviving credentials. **Inception: Restore Forgotten Entry** removes that block and lets VS Code provision a fresh binding. Only forgotten IDs are persisted; no credentials or key fingerprints enter this block list. After a restart, entries become available when VS Code provisions them again. Feature selectors never choose the first available key or another entry. Token snapshots contain counts, model IDs and times, indexed by a one-way credential fingerprint; they contain no key, prompt, or response.

## Network destination

The extension sends requests directly to:

- `https://api.inceptionlabs.ai/v1/chat/completions/models` for hosted-model discovery and key validation
- `https://api.inceptionlabs.ai/v1/chat/completions` for model responses
- `https://api.inceptionlabs.ai/v1/fim/completions` for inline autocomplete
- `https://api.inceptionlabs.ai/v1/edit/completions` for next-edit suggestions
- `https://api-feedback.inceptionlabs.ai/feedback` for suggestion-outcome feedback

There is no local proxy or project-operated relay. Prompts, conversation context, tool definitions, and tool results selected by Copilot Chat are sent to Inception as part of chat-completion requests. Inline autocomplete sends the document text around the cursor (a trimmed prefix and suffix) as fill-in-the-middle context. Next-edit suggestions send the current file (trimmed beyond a token budget), short excerpts of recently viewed files, and a diff summary of recent edits.

When `inceptionCopilot.sendFeedback` is enabled (default), accepting a suggestion sends a fire-and-forget report to the feedback endpoint containing only the suggestion's response id, the action, and the extension's provider name and version. Feedback requests never include code, prompts, conversation context, or API keys, and failures are silently ignored.

The inference base URL is fixed in the extension instead of being workspace-configurable. This prevents an untrusted workspace setting from redirecting the saved API key to another server.

## Logging

Debug logging is disabled by default. When enabled, the Inception output channel records model discovery, request metadata, token usage, and errors; it does not intentionally log prompts or API keys.

Report vulnerabilities according to the [security policy](https://github.com/grikomsn/inception-copilot-chat/security/policy) or email [security@nibras.co](mailto:security@nibras.co). Do not disclose credentials, sensitive prompts, or vulnerability details in a public issue.
