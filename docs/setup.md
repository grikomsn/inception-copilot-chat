# Setup

See the [README](../README.md#setup) for native provider configuration, commands, and settings. API keys are available from [Inception Platform](https://platform.inceptionlabs.ai/dashboard/api-keys).

## Context window size

Each model entry exposes a Context Window control in the Copilot Chat model
picker (`src/models/options.ts`). The options are Auto (the default), fixed
64K, 128K, and 200K tiers that fit below the model's registered input limit,
and Maximum. Auto and Maximum keep the default behavior.

A specific tier acts as a local upper limit: the selection is stored per model
by VS Code, never exceeds the model's registered input limit, and when the
converted messages exceed the selected tier the oldest conversation turns are
trimmed before the request is built (`src/provider/history-trim.ts`). The
first message, the current turn, and tool-call/result adjacency are always
preserved, and models without a fitting tier keep their picker unchanged.
