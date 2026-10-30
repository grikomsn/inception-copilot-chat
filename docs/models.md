# Models

The extension discovers the current Inception model catalog live from
`https://api.inceptionlabs.ai/v1/chat/completions/models`. Each model entry
carries its own context window, maximum output length, and per-model pricing,
which are surfaced in the Copilot Chat model picker.

A bundled fallback snapshot keeps model selection functional when no API key is
configured or during transient catalog failures. Live discovery results remain
authoritative whenever available.

## Models

The catalog exposes the following chat models:

- **Mercury 3** (`mercury-3`) — the default chat model, with a 1M-token
  context window (~869K usable input), up to 131,072 output tokens, and
  configurable reasoning effort. Priced at $0.10 input / $0.01 cached input /
  $0.35 output per 1M tokens at the 50%-off launch rate ($0.20 / $0.02 /
  $0.70 regular).
- **Mercury Edit 2** (`mercury-edit-2`) — the fill-in-the-middle model used for
  inline autocomplete and next-edit suggestions.

## Mercury 2 and 2.5 retirement

Inception closed Mercury 2 and Mercury 2.5 to new users when Mercury 3
launched on 2026-10-19, with existing-customer access scheduled to end on
**2026-11-15** (enterprise agreements are separate). The extension filters
both ids out of discovery and the bundled fallback, mirroring the service's
own deprecation, and Mercury 3 remains the default. See Inception's [models
page](https://www.inceptionlabs.ai/models) for the authoritative schedule.
The published Mercury 2 rates remain the default basis for local usage
cost estimates and still cover Mercury Edit 2.

Enterprise-only Mercury Voice and the decisions-only Mercury Decide endpoints
are not part of chat model discovery.

## Reasoning efforts

The extension offers a fixed set of reasoning efforts — **Instant**, Low,
Medium (the default), and High — sent as the `reasoning_effort` request field.
The live catalog does not advertise per-model effort support, so every model
gets the same picker. The workspace default
(`inceptionCopilot.reasoningEffort`) applies unless a per-request picker
selection overrides it.

## Context window

Each model entry exposes a **Context Window** control in the Copilot Chat model
picker (`src/models/options.ts`). See [Setup](setup.md) for how the tiers are
derived and applied.

## Pricing

Per-model input, cached-input, and output pricing is shown in the model picker
when the live catalog provides it; otherwise the bundled snapshot rates apply.
See [Setup](setup.md) for how usage and spend are tracked.

## Copilot SDK sessions

The **Copilot** session runtime uses a separate model-discovery path from
ordinary **Local** chat. Its BYOK bridge discovers effort options specifically
from `configurationSchema.properties.reasoningEffort`. Keep that property
separate from Context Window and other controls, with the model's supported
values and a default from that list.

In VS Code 1.141, the SDK picker further restricts efforts to `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Each model exposes only the
intersection with its own supported list. The extension continues translating
selected efforts to the provider's native request fields.

Inception's `instant` choice remains available in Local chat, but the SDK
picker filters it out and offers Low, Medium, and High. Use Local chat for
Instant and the extension's Context Window control; the SDK picker does not
expose the context control.

After installing an extension update, restart VS Code or reload every open
window so the shared BYOK bridge receives fresh model metadata.

References: [VS Code BYOK discovery](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts),
[SDK Thinking Level filtering](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L2757),
and [accepted agent-host effort tiers](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/common/reasoningEffort.ts).
