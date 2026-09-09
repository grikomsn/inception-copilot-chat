# Changelog

## 0.4.0

### Minor Changes

- a715958: Add Mercury 2.5 as the preferred Inception chat model, with documented 260K context, 65,536 max output, and current launch pricing, while keeping Mercury 2 available.

## 0.3.0

### Minor Changes

- 2b138bb: Adds a Context Window picker control (Auto, 64K, Maximum) that caps how much conversation history each request sends, clamped to the model's registered input limit.

### Patch Changes

- 2b138bb: Report each model's `maxInputTokens` as context minus the output budget so the picker's context window matches the model's real usable input and no longer collapses to the output cap.
- 2b138bb: Fix Auto context size being interpreted as zero input tokens by VS Code, collapsing the context indicator to the output reserve and triggering premature compaction.

## 0.2.0

### Minor Changes

- a402f91: Add inline completions powered by the Inception Mercury Edit models:

  - Inline autocomplete via the fill-in-the-middle endpoint (`inceptionCopilot.autocomplete`): debounced, cancellable, and configurable (enabled, model, debounce, token budgets, request timeout).
  - Next-edit suggestions via the edit endpoint (`inceptionCopilot.nextEdit`): recently viewed snippets, a cursor-centered editable region, and recent edit history as context, mapped to the insertion and single-line replacement shapes the stable inline-completion API supports.
  - A status bar menu to toggle either feature, switch the completion model, and open the completion settings page; completion settings are also in the extension's settings section.
  - Streaming fill-in-the-middle requests, with mid-flight abandonment when the document changes while a suggestion is in flight.
  - Optional outcome feedback to Inception on accepted suggestions (`inceptionCopilot.sendFeedback`, default on); requests contain only outcome metadata.
  - Next-edit suggestions are off by default (`inceptionCopilot.nextEdit.enabled`); enable them from the status bar menu.

- 9f71dca: Track usage locally and surface model pricing:

  - Local usage tracking for Copilot Chat, inline autocomplete, and next-edit requests, scoped per API key and persisted across sessions. The previous separate **$(sparkle) Mercury** status bar item and the usage indicator are merged into one status bar item: the text shows compact token totals (or **$(sparkle) Inception** / **$(key) Inception** before any usage), the tooltip adds completion feature states, and **Inception: Show Usage** opens a single menu with tracked tokens (input, output, cached, reasoning), an estimated spend, the inline-completion toggles and model picker, and connection actions. The old `inceptionCopilot.completionMenu` command remains as an alias to the same menu. Toggle the status bar with `inceptionCopilot.showUsageStatusBar`.
  - Estimated spend uses the published Mercury rates ($0.25 input / $0.025 cached input / $0.75 output per 1M tokens); counts are device-local and the Inception dashboard remains authoritative. Quota (HTTP 402) and rate-limit (HTTP 429) failures are surfaced in the usage view.
  - Model picker entries now carry pricing metadata from live discovery (per-token input, output, and cached-read rates converted to per-million costs), with documented Mercury rates as a fallback, plus richer tooltips and a `costCategory` badge.
  - Usage payloads now accept Inception's flat `cached_input_tokens`/`reasoning_tokens` fields in addition to the nested OpenAI-style details, for chat, fill-in-the-middle, and edit completions alike.

## 0.1.1

### Patch Changes

- b199ce7: Add the initial Inception Mercury provider with secure credentials, live chat discovery, streaming tool calls, and reasoning controls.
- 00c6dc5: Match sibling provider artwork and README presentation, and colocate provider conversion helpers.

## 0.1.0

Initial Inception Mercury chat provider with secure API-key configuration, live discovery, streaming, tools, and reasoning controls.
