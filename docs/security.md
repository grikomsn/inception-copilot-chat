# API key and security

## Credential storage

Command-managed Inception API keys are stored in VS Code `SecretStorage`; provider-entry keys are supplied through VS Code's secret provider configuration. They are not written to workspace settings, files, extension logs, or this repository. A key is validated against the hosted model-list endpoint before it is used for model discovery.

Use **Inception: Remove API Key** to delete the saved credential. Replacing a key validates the replacement before overwriting the existing secret.

Provider entries created through **Manage Language Models** receive their API key through VS Code's provider configuration and are kept separate from the legacy command-managed key. A short one-way fingerprint is used in memory only to distinguish entries; the key itself is never used as a model identifier or log value.

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
