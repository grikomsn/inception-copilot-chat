# Models

The extension discovers the current Inception model catalog live from
`https://api.inceptionlabs.ai/v1/chat/completions/models`. Each model entry
carries its own context window, maximum output length, reasoning-effort support,
and per-model pricing, which are surfaced directly in the Copilot Chat model
picker tooltip.

A bundled fallback snapshot keeps model selection functional when no API key is
configured or during transient catalog failures. The snapshot is not a pricing
guarantee; live discovery results remain authoritative whenever available.

## Model families

The catalog typically exposes the following model families:

- **Mercury 2.5** — the default chat model with configurable reasoning effort and a ~194K context window.
- **Mercury 2** — a smaller, faster model with a ~78K context window.
- **Mercury Edit 2** — the fill-in-the-middle model used for inline autocomplete and next-edit suggestions.

## Reasoning efforts

Each model advertises its supported reasoning levels in the live catalog. The
Copilot Chat model picker lists only the efforts a given model accepts. The
workspace default (`inceptionCopilot.reasoningEffort`) applies when the model
supports it; otherwise the model's own default is used. A per-request picker
selection always overrides the workspace default.

## Context window

Each model entry also exposes a **Context Window** control in the Copilot Chat
model picker (`src/models/options.ts`). See [Setup](setup.md) for details on
how context tiers are derived and applied.

## Pricing

Per-model input, cached-input, and output pricing from live discovery is shown
in the model picker tooltip. Token counting is an estimate (characters divided
by four); see [Setup](setup.md) for details.
