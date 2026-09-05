<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/inception-copilot-chat/main/assets/cover.jpg" alt="Inception and GitHub Copilot" width="960">
</p>

<h1 align="center">Inception for GitHub Copilot Chat</h1>

<p align="center">Use Inception Mercury models directly from the GitHub Copilot Chat model picker in Visual Studio Code.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.inception-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.inception-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://github.com/grikomsn/inception-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/inception-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/inception-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/inception-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

## Setup

1. Install the extension in VS Code 1.125 or newer with GitHub Copilot Chat available.
2. Create an API key in [Inception Platform](https://platform.inceptionlabs.ai/dashboard/api-keys).
3. Open **Chat: Manage Language Models**, add **Inception**, and enter your API key. Each provider entry keeps its own credentials.
4. Select **Mercury 2** in Copilot Chat.

Alternatively, run **Inception: Configure API Key** to keep a command-managed key in VS Code Secret Storage. Use **Inception: Test Inference** to check that key, **Inception: Refresh Models** to refresh discovery, or **Inception: Remove API Key** to remove it. These commands operate on the command-managed key; native provider entries are managed through Manage Language Models.

## Features

- Live chat-only model discovery, with a Mercury 2 fallback when discovery is unavailable.
- Streaming text, sequential tool calling, usage reporting, cancellation, and total/idle request timeouts.
- Mercury 2 reasoning choices: **Instant**, **Low**, **Medium** (default), and **High**.
- Inline autocomplete for any file via the Inception fill-in-the-middle endpoint and Mercury Edit, with debounce, cancellation, and a per-request timeout.

Mercury 2 currently advertises a 128,000-token context window and 50,000-token maximum output. The default request output budget is 16,384 tokens. Live model limits override fallback metadata. Token counting is an estimate (characters divided by four).

## Autocomplete

Inline suggestions come from the Mercury Edit fill-in-the-middle endpoint, separate from Copilot Chat's model picker. Suggestions are insertions at the cursor (or a replace-to-end-of-line while the IntelliSense widget is open); multi-line edits and deletions are not provided.

Multiple inline-completion extensions can compete for Tab. For the best experience, disable other providers (for example `editor.inlineSuggest` toggles the feature globally, and GitHub Copilot's own suggestions can be turned off per language).

| Setting | Default | Purpose |
| --- | --- | --- |
| `inceptionCopilot.autocomplete.enabled` | `true` | Provide inline autocomplete suggestions |
| `inceptionCopilot.autocomplete.model` | `mercury-edit-2` | FIM model used for suggestions |
| `inceptionCopilot.autocomplete.debounceMs` | `100` | Delay after typing stops; explicit invocations skip it |
| `inceptionCopilot.autocomplete.maxTokens` | `256` | Tokens generated per suggestion |
| `inceptionCopilot.autocomplete.maxPromptTokens` | `8192` | Prompt context budget; the prefix keeps three quarters |
| `inceptionCopilot.autocomplete.requestTimeoutMs` | `5000` | Per-request timeout in milliseconds |

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `inceptionCopilot.reasoningEffort` | `medium` | Default effort; the model picker overrides it |
| `inceptionCopilot.maxOutputTokens` | `16384` | Output budget, capped to the model limit; 0 uses that limit |
| `inceptionCopilot.requestTimeoutSeconds` | `600` | Total inference timeout |
| `inceptionCopilot.streamIdleTimeoutSeconds` | `120` | Timeout without response data |
| `inceptionCopilot.catalogCacheMinutes` | `5` | Model catalog refresh interval |
| `inceptionCopilot.debugLogging` | `false` | Metadata-only diagnostics |

## Development

Use Node.js 22+ and npm. Run `npm ci`, `npm run check`, and `npm run package`. Press F5 to launch the Extension Development Host. Tests are colocated under `src/`. See [development](docs/development.md) and [security](docs/security.md).

API credentials stay in VS Code Secret Storage or native secret provider configuration. Requests go directly to `https://api.inceptionlabs.ai/v1`; no proxy is involved. `.env` is only for explicitly invoked local smoke tests and is excluded from Git and the VSIX.

This is an independent community extension, unaffiliated with Inception Labs, Microsoft, or GitHub. API usage is billed by Inception.

## References

- [Inception documentation](https://docs.inceptionlabs.ai/llms-full.txt)
- [Inception API schema](https://api.inceptionlabs.ai/openapi.json)
- [Sibling Poolside provider](https://github.com/grikomsn/poolside-copilot-chat)
- [Sibling OpenAI OAuth provider](https://github.com/grikomsn/openai-oauth-copilot-chat)

MIT license.
