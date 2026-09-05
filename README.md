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
- Model picker pricing from live discovery (per-million input/output/cached rates) shown in the picker tooltip and fields.
- Merged status bar indicator (**$(sparkle) Inception**): locally tracked token usage in the text and tooltip, with one menu (**Inception: Show Usage**) covering usage details, inline-completion toggles, the completion model, and connection actions.
- Local usage tracking across Copilot Chat and inline completions, persisted across sessions, with a dashboard deep link (`inceptionCopilot.openUsage`).
- Inline autocomplete for any file via the Inception fill-in-the-middle endpoint and Mercury Edit, with debounce, cancellation, and a per-request timeout.
- Next-edit suggestions via the Inception edit endpoint, using recently viewed snippets, a cursor-centered editable region, and your recent edit history.
- Inline-completion controls (toggle either feature, switch the completion model, open settings) live in the merged status bar menu (**Inception: Show Usage**).
- Optional outcome feedback: accepted suggestions are reported to Inception to improve model quality, sending only outcome metadata (`inceptionCopilot.sendFeedback`).

Mercury 2 currently advertises a 128,000-token context window and 50,000-token maximum output. The default request output budget is 16,384 tokens. Live model limits override fallback metadata. Token counting is an estimate (characters divided by four).

## Autocomplete

Inline suggestions come from the Mercury Edit fill-in-the-middle endpoint, separate from Copilot Chat's model picker. Suggestions are insertions at the cursor (or a replace-to-end-of-line while the IntelliSense widget is open); multi-line edits and deletions are not provided.

## Next edit

Next-edit suggestions watch your recent edits and cursor positions in other files, send a cursor-centered editable region (default 15 lines) plus recent snippets and a diff history to the Inception edit endpoint, and show the predicted change inline. The stable VS Code inline-completion API can only express insertions and single-line replacements, so multi-line rewrites and deletions are skipped rather than approximated.

Next-edit is **off by default** — enable it from the status bar menu or with `inceptionCopilot.nextEdit.enabled`. Autocomplete remains on by default so a fresh install sends one request per typing pause instead of two.

## Using both with Copilot

Multiple inline-completion extensions can compete for Tab. For the best experience, disable other providers (for example `editor.inlineSuggest` toggles the feature globally, and GitHub Copilot's own suggestions can be turned off per language). Both Inception features can be toggled independently from the status bar menu or disabled in settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `inceptionCopilot.autocomplete.enabled` | `true` | Provide inline autocomplete suggestions |
| `inceptionCopilot.autocomplete.model` | `mercury-edit-2` | FIM model used for suggestions |
| `inceptionCopilot.autocomplete.debounceMs` | `100` | Delay after typing stops; explicit invocations skip it |
| `inceptionCopilot.autocomplete.maxTokens` | `256` | Tokens generated per suggestion |
| `inceptionCopilot.autocomplete.maxPromptTokens` | `8192` | Prompt context budget; the prefix keeps three quarters |
| `inceptionCopilot.autocomplete.requestTimeoutMs` | `5000` | Per-request timeout in milliseconds |
| `inceptionCopilot.nextEdit.enabled` | `false` | Provide next-edit suggestions; off by default |
| `inceptionCopilot.nextEdit.model` | `mercury-edit-2` | Edit model used for suggestions |
| `inceptionCopilot.nextEdit.debounceMs` | `150` | Delay after typing stops; explicit invocations skip it |
| `inceptionCopilot.nextEdit.maxTokens` | `1024` | Tokens generated for the updated region |
| `inceptionCopilot.nextEdit.editableLines` | `15` | Editable-region size around the cursor in lines |
| `inceptionCopilot.nextEdit.maxPromptTokens` | `16384` | Current-file context budget; distant regions are trimmed |
| `inceptionCopilot.nextEdit.snippetContextLines` | `10` | Context lines captured for recently viewed snippets |
| `inceptionCopilot.nextEdit.historyDepth` | `5` | Recent edits sent as diff history; 0 disables |
| `inceptionCopilot.nextEdit.requestTimeoutMs` | `8000` | Per-request timeout in milliseconds |
| `inceptionCopilot.sendFeedback` | `true` | Report accepted-suggestion outcomes to Inception (metadata only) |
| `inceptionCopilot.showUsageStatusBar` | `true` | Show locally tracked token usage and estimated spend in the status bar |

## Usage tracking

The extension tracks tokens and requests locally on this device: every Copilot Chat response plus accepted inline autocomplete and next-edit requests accumulate into a per-credential snapshot that survives restarts. A single merged status bar item shows compact totals (**$(graph) Inception …**) with completion feature states in its tooltip, and **Inception: Show Usage** opens one menu with tracked tokens (input, output, cached, reasoning), an estimated spend, the inline-completion toggles and model picker, and a dashboard deep link (**Inception: Open Usage Dashboard** opens the Inception Platform usage page). The `inceptionCopilot.showUsageStatusBar` setting hides the item (the menu stays reachable from the command palette).

Estimates use the published Mercury rates ($0.25 input, $0.025 cached input, $0.75 output per 1M tokens) applied to reported token counts. Counts are device-local: they start when the extension first records usage, exclude other tools sharing your key, and do not reflect Inception's billing or the free-token grant — the [Inception dashboard](https://platform.inceptionlabs.ai/dashboard/logs) is authoritative. No prompts, responses, or API keys are stored; only token counts, model ids, and request outcome metadata.

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
