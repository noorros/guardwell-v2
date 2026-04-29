// src/lib/ai/pricing.ts
//
// Shared pricing table + cost helper for every Anthropic call site.
// Both runLlm (single-turn) and streamConciergeTurn (multi-turn streaming)
// import from here so a model price update lives in exactly one place.
//
// Updated 2026-04 from Anthropic pricing page. When a new model is added
// to the registry, add its price here too — `estimateCostUsd` returns null
// when the model is missing from this table, which surfaces as a null
// `costUsd` on the LlmCall row (visible in the cost dashboard).

export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7":  { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3,  output: 15 },
  "claude-haiku-4-5-20251001":  { input: 1,  output: 5  },
};

/**
 * Estimate USD cost for a single Anthropic call.
 *
 * @returns USD cost rounded to 6 decimals, or null if `model` is not in
 *   the pricing table (caller should persist null in that case so we can
 *   audit which models are escaping the table).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = PRICING_PER_MTOK[model];
  if (!p) return null;
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return Number(cost.toFixed(6));
}
