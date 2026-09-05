---
"inception-copilot-chat": minor
---

Track usage locally and surface model pricing:

- Local usage tracking for Copilot Chat, inline autocomplete, and next-edit requests, scoped per API key and persisted across sessions. The previous separate **$(sparkle) Mercury** status bar item and the usage indicator are merged into one status bar item: the text shows compact token totals (or **$(sparkle) Inception** / **$(key) Inception** before any usage), the tooltip adds completion feature states, and **Inception: Show Usage** opens a single menu with tracked tokens (input, output, cached, reasoning), an estimated spend, the inline-completion toggles and model picker, and connection actions. The old `inceptionCopilot.completionMenu` command remains as an alias to the same menu. Toggle the status bar with `inceptionCopilot.showUsageStatusBar`.
- Estimated spend uses the published Mercury rates ($0.25 input / $0.025 cached input / $0.75 output per 1M tokens); counts are device-local and the Inception dashboard remains authoritative. Quota (HTTP 402) and rate-limit (HTTP 429) failures are surfaced in the usage view.
- Model picker entries now carry pricing metadata from live discovery (per-token input, output, and cached-read rates converted to per-million costs), with documented Mercury rates as a fallback, plus richer tooltips and a `costCategory` badge.
- Usage payloads now accept Inception's flat `cached_input_tokens`/`reasoning_tokens` fields in addition to the nested OpenAI-style details, for chat, fill-in-the-middle, and edit completions alike.
