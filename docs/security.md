# API key and security

## Credential storage

All API keys belong to native entries in **Manage Language Models** and are supplied through VS Code's secret provider configuration. The extension holds provisioned keys in memory only; it does not read or write a command-managed key or mirror secrets into workspace settings, files, logs, or global state.

Entries are identified by the group name you type in **Manage Language Models**; VS Code namespaces each entry's model identifiers per group and never exposes the group name to the provider, so no entry identifiers are tracked by the extension. Catalogs, usage, and request credentials are scoped by a one-way key fingerprint. Entries sharing the same API key share its credential scope; rotating a key re-scopes the entry automatically and stale handles resolve against the current provisioning on the next request.

Delete or update credentials through **Manage Language Models**. VS Code stores and updates the key, and deleting an entry removes its VS Code-owned credential. The extension persists no entry identity between sessions; only token-count snapshots keyed by credential fingerprint survive restarts. Token snapshots contain counts, model IDs and times, indexed by a one-way credential fingerprint; they contain no key, prompt, or response.

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
