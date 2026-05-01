// src/lib/events/projections/techAssessmentSubmitted.ts
//
// Phase 5 PR 4 — flips the Tech Assessment draft to completed and
// stamps the score.
//
// Phase 5 PR 5 — also auto-creates RiskItem rows from every NO/PARTIAL
// answer in the completed assessment. Unlike SRA, there is no legacy
// projection for Tech Assessment, so this projection owns BOTH the
// draft promotion AND the risk register feed.
//
// skipDuplicates handles replay: the @@unique([practiceId, source,
// sourceCode, sourceRefId]) constraint on RiskItem dedupes on
// (TECHNICAL_ASSESSMENT, questionCode, assessmentId).

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { assertProjectionPracticeOwned } from "./guards";
import {
  generateRiskItemsFromAnswers,
  type AnswerWithMeta,
} from "@/lib/risk/autoGenerate";
import type { RiskWeight } from "@/lib/risk/types";

type Payload = PayloadFor<"TECH_ASSESSMENT_SUBMITTED", 1>;

export async function projectTechAssessmentSubmitted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1 cross-tenant guard — a forged event referencing another
  // practice's draft must be refused.
  const existing = await tx.techAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true, isDraft: true, completedAt: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "techAssessment",
    id: payload.assessmentId,
  });
  if (!existing) {
    throw new Error(
      `TECH_ASSESSMENT_SUBMITTED refused: assessment ${payload.assessmentId} not found`,
    );
  }
  if (!existing.isDraft || existing.completedAt !== null) {
    throw new Error(
      `TECH_ASSESSMENT_SUBMITTED refused: assessment ${payload.assessmentId} is already completed`,
    );
  }

  await tx.techAssessment.update({
    where: { id: payload.assessmentId },
    data: {
      isDraft: false,
      completedAt: new Date(),
      overallScore: payload.overallScore,
      addressedCount: payload.addressedCount,
      totalCount: payload.totalCount,
    },
  });

  // Phase 5 PR 5 — feed the risk register. Pull saved answers with
  // question metadata, map to AnswerWithMeta, generate proposals,
  // createMany with skipDuplicates so replays don't duplicate.
  const answerRows = await tx.techAssessmentAnswer.findMany({
    where: { assessmentId: payload.assessmentId },
    include: {
      question: {
        select: {
          code: true,
          title: true,
          description: true,
          category: true,
          riskWeight: true,
        },
      },
    },
  });

  const answers: AnswerWithMeta[] = answerRows.map((r) => ({
    questionCode: r.question.code,
    answer: r.answer,
    riskWeight: r.question.riskWeight as RiskWeight,
    title: r.question.title,
    description: r.question.description,
    category: r.question.category,
  }));

  const proposals = generateRiskItemsFromAnswers(
    practiceId,
    payload.assessmentId,
    answers,
    "TECHNICAL_ASSESSMENT",
  );

  if (proposals.length === 0) return;

  await tx.riskItem.createMany({
    data: proposals.map((p) => ({
      practiceId: p.practiceId,
      source: p.source,
      sourceCode: p.sourceCode,
      sourceRefId: p.sourceRefId,
      category: p.category,
      severity: p.severity,
      title: p.title,
      description: p.description,
    })),
    skipDuplicates: true,
  });
}
