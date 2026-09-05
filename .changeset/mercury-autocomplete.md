---
"inception-copilot-chat": minor
---

Add inline completions powered by the Inception Mercury Edit models:

- Inline autocomplete via the fill-in-the-middle endpoint (`inceptionCopilot.autocomplete`): debounced, cancellable, and configurable (enabled, model, debounce, token budgets, request timeout).
- Next-edit suggestions via the edit endpoint (`inceptionCopilot.nextEdit`): recently viewed snippets, a cursor-centered editable region, and recent edit history as context, mapped to the insertion and single-line replacement shapes the stable inline-completion API supports.
- A status bar menu to toggle either feature, switch the completion model, and open the completion settings page; completion settings are also in the extension's settings section.
- Streaming fill-in-the-middle requests, with mid-flight abandonment when the document changes while a suggestion is in flight.
- Optional outcome feedback to Inception on accepted suggestions (`inceptionCopilot.sendFeedback`, default on); requests contain only outcome metadata.
- Next-edit suggestions are off by default (`inceptionCopilot.nextEdit.enabled`); enable them from the status bar menu.
