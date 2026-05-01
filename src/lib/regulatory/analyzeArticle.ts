// src/lib/regulatory/analyzeArticle.ts
//
// Wraps runLlm to score one article. Cost-guarded + fail-soft: if the
// monthly budget is tripped or Claude throws, returns null so the caller
// can skip without surfacing partial / hallucinated output.

import { runLlm } from "@/lib/ai";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";
import type {
  RegulatoryRelevanceInput,
  RegulatoryRelevanceOutput,
} from "@/lib/ai/prompts/regulatoryRelevance";

export async function analyzeArticle(
  input: RegulatoryRelevanceInput,
  context: { practiceId: string; actorUserId: string },
): Promise<RegulatoryRelevanceOutput | null> {
  try {
    await assertMonthlyCostBudget();
    const result = await runLlm("analyzer.regulatory-relevance.v1", input, {
      practiceId: context.practiceId,
      actorUserId: context.actorUserId,
    });
    return result.output;
  } catch (err) {
    console.error("[regulatory:analyze] analyzeArticle failed", err);
    return null;
  }
}
