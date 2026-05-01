// src/lib/risk/autoGenerate.ts
//
// Phase 5 PR 5 — converts NO/PARTIAL SRA or TA answers into RiskItem
// proposals. Pure function (no DB I/O); the projection callbacks call
// this then write the results via createMany({ skipDuplicates: true }).
//
// Severity mapping:
//   NO + HIGH weight  → HIGH severity
//   NO + MEDIUM       → MEDIUM
//   NO + LOW          → LOW
//   PARTIAL + HIGH    → MEDIUM   (downgraded one notch)
//   PARTIAL + MEDIUM  → LOW
//   PARTIAL + LOW     → INFO
//   YES / NA          → no proposal

import type { RiskWeight, RiskSeverity } from "./types";

export interface AnswerWithMeta {
  questionCode: string;
  answer: "YES" | "NO" | "PARTIAL" | "NA";
  riskWeight: RiskWeight;
  title: string;
  description: string;
  category: string;
}

export interface RiskItemProposal {
  practiceId: string;
  source: "SRA" | "TECHNICAL_ASSESSMENT";
  sourceCode: string;
  sourceRefId: string;
  category: string;
  severity: RiskSeverity;
  title: string;
  description: string;
}

const NO_BY_WEIGHT: Record<RiskWeight, RiskSeverity> = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

const PARTIAL_BY_WEIGHT: Record<RiskWeight, RiskSeverity> = {
  HIGH: "MEDIUM",
  MEDIUM: "LOW",
  LOW: "INFO",
};

export function generateRiskItemsFromAnswers(
  practiceId: string,
  assessmentId: string,
  answers: AnswerWithMeta[],
  source: "SRA" | "TECHNICAL_ASSESSMENT" = "SRA",
): RiskItemProposal[] {
  const proposals: RiskItemProposal[] = [];
  for (const a of answers) {
    if (a.answer === "YES" || a.answer === "NA") continue;
    const severity =
      a.answer === "NO"
        ? NO_BY_WEIGHT[a.riskWeight]
        : PARTIAL_BY_WEIGHT[a.riskWeight];
    proposals.push({
      practiceId,
      source,
      sourceCode: a.questionCode,
      sourceRefId: assessmentId,
      category: a.category,
      severity,
      title: a.title,
      description: a.description,
    });
  }
  return proposals;
}
