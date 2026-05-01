// src/lib/sra/scoring.ts
//
// Pure helper that converts SRA answers + question weights into a
// 0-100 overallScore plus addressedCount (YES + NA) and totalCount.
// Weighting: LOW=1, MEDIUM=2, HIGH=3. PARTIAL counts as 0.5 of
// addressed in the score formula but does NOT increment addressedCount
// (which tracks only fully-addressed questions for the wizard's
// progress indicator).

import type { RiskWeight } from "@/lib/risk/types";

const WEIGHT_VALUES: Record<RiskWeight, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export interface SraAnswerForScoring {
  questionCode: string;
  answer: "YES" | "NO" | "PARTIAL" | "NA";
  riskWeight: RiskWeight;
}

export interface SraScoreResult {
  overallScore: number;
  addressedCount: number;
  totalCount: number;
}

export function computeSraScore(
  answers: SraAnswerForScoring[],
): SraScoreResult {
  if (answers.length === 0) {
    return { overallScore: 0, addressedCount: 0, totalCount: 0 };
  }
  let weightedAddressed = 0;
  let totalWeight = 0;
  let addressedCount = 0;
  for (const a of answers) {
    const w = WEIGHT_VALUES[a.riskWeight];
    totalWeight += w;
    if (a.answer === "YES" || a.answer === "NA") {
      weightedAddressed += w;
      addressedCount += 1;
    } else if (a.answer === "PARTIAL") {
      weightedAddressed += w * 0.5;
    }
  }
  return {
    overallScore: Math.round((weightedAddressed / totalWeight) * 100),
    addressedCount,
    totalCount: answers.length,
  };
}
