# Models

The extension discovers the current Inception model catalog live from
`https://api.inceptionlabs.ai/v1/chat/completions/models`. Each model entry
carries its own context window, maximum output length, reasoning-effort support,
and per-model pricing, which are surfaced in the Copilot Chat model picker.

A bundled fallback snapshot keeps model selection functional when no API key is
configured or during transient catalog failures. Live discovery results remain
authoritative whenever available.

## Models

The catalog typically exposes the following models:

- **Mercury 2.5** (`mercury-2.5`) — the default chat model, with a 260K-token
  context window (~194K usable input) and configurable reasoning effort.
- **Mercury 2** (`mercury-2`) — a smaller, faster chat model with a 128K-token
  context window (~78K usable input).
- **Mercury Edit 2** (`mercury-edit-2`) — the fill-in-the-middle model used for
  inline autocomplete and next-edit suggestions.

## Reasoning efforts

Each model advertises its supported reasoning levels in the live catalog. The
Copilot Chat model picker lists only the efforts a given model accepts. The
workspace default (`inceptionCopilot.reasoningEffort`) applies when the model
supports it; otherwise the model's own default is used. A per-request picker
selection overrides the workspace default.

## Context window

Each model entry exposes a **Context Window** control in the Copilot Chat model
picker (`src/models/options.ts`). See [Setup](setup.md) for how the tiers are
derived and applied.

## Pricing

Per-model input, cached-input, and output pricing is shown in the model picker
when the live catalog provides it; otherwise the bundled snapshot rates apply.
See [Setup](setup.md) for how usage and spend are tracked.
