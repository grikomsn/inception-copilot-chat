const FENCE_START = /^```[^\n]*\n/;

/**
 * Normalizes a raw FIM completion for inline display. The Inception FIM
 * endpoint applies its own stop sequences; these guards are purely defensive
 * against model quirks seen on OpenAI-compatible completion surfaces.
 * Returns undefined when nothing usable remains.
 */
export function postprocessCompletion(raw: string, stopSequences: readonly string[] = []): string | undefined {
  let text = typeof raw === "string" ? raw : "";
  text = stripCodeFence(text);
  for (const stop of stopSequences) {
    if (!stop) continue;
    const index = text.indexOf(stop);
    if (index >= 0) text = text.slice(0, index);
  }
  text = text.trimEnd();
  if (!text.trim()) return undefined;
  return text;
}

/**
 * Strips a surrounding markdown code fence. Both an opening fence line and a
 * closing fence must be present; a lone fence may be legitimate content.
 */
function stripCodeFence(text: string): string {
  const opening = FENCE_START.exec(text);
  if (!opening || !text.endsWith("\n```")) return text;
  return text.slice(opening[0].length, -4);
}
