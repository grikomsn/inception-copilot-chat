export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const DEFAULT_PREFIX_SHARE = 0.75;

export interface PromptContext {
  readonly prompt: string;
  readonly suffix: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Builds the FIM prompt (prefix) and suffix from the document around the
 * cursor, trimming whole lines so both sides fit the token budget. The prefix
 * keeps the majority of the budget because the text before the cursor carries
 * the strongest signal for fill-in-the-middle models.
 */
export function buildPromptContext(
  prefix: string,
  suffix: string,
  maxPromptTokens: number,
  prefixShare: number = DEFAULT_PREFIX_SHARE,
): PromptContext {
  const budget = Math.max(2, Math.floor(maxPromptTokens));
  const prefixBudget = Math.min(budget, Math.max(1, Math.floor(budget * Math.min(1, Math.max(0, prefixShare)))));
  const suffixBudget = Math.max(1, budget - prefixBudget);
  return {
    prompt: trimLinesFromTop(prefix, prefixBudget),
    suffix: trimLinesFromBottom(suffix, suffixBudget),
  };
}

/** Drops whole lines from the top of `text` until it fits `maxTokens`. */
export function trimLinesFromTop(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  const lines = text.split("\n");
  let start = lines.length;
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = estimateTokens(i === lines.length - 1 ? lines[i] : `${lines[i]}\n`);
    if (used + cost > maxTokens) break;
    used += cost;
    start = i;
  }
  if (start === lines.length) {
    // The final line alone exceeds the budget; keep its tail so the cursor
    // line still ends the prompt.
    return text.slice(Math.max(0, text.length - maxTokens * CHARS_PER_TOKEN_ESTIMATE));
  }
  return lines.slice(start).join("\n");
}

/** Drops whole lines from the bottom of `text` until it fits `maxTokens`. */
export function trimLinesFromBottom(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  const lines = text.split("\n");
  let end = 0;
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const cost = estimateTokens(i === lines.length - 1 ? lines[i] : `${lines[i]}\n`);
    if (used + cost > maxTokens) break;
    used += cost;
    end = i + 1;
  }
  if (end === 0) {
    // The first line alone exceeds the budget; keep its head so the text
    // immediately after the cursor still starts the suffix.
    return text.slice(0, Math.max(0, maxTokens * CHARS_PER_TOKEN_ESTIMATE));
  }
  return lines.slice(0, end).join("\n");
}
