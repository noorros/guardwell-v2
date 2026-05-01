// src/lib/events/projections/sraSubmitted.ts
//
// Phase 5 PR 5 — auto-creates RiskItem rows from every NO/PARTIAL
// answer in a completed SRA. The legacy projectSraCompleted projection
// still owns the isDraft → false / completedAt / overallScore flip; this
// projection focuses solely on the risk register feed so a future
// completion path that fires only SRA_SUBMITTED still produces RiskItem
// rows. The dual-event split is documented in actions.ts.
//
// skipDuplicates handles replay: the @@unique([practiceId, source,
// sourceCode, sourceRefId]) constraint dedupes on (SRA, questionCode,
// assessmentId). A second submit of the same assessment is therefore
// a no-op for risk register growth.
//
// Cross-tenant guard mirrors sraCompleted.ts: a forged SRA_SUBMITTED
// referencing another practice's assessment is refused before any row
// is touched.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { assertProjectionPracticeOwned } from "./guards";
import {
  generateRiskItemsFromAnswers,
  type AnswerWithMeta,
} from "@/lib/risk/autoGenerate";
import type { RiskWeight } from "@/lib/risk/types";

type Payload = PayloadFor<"SRA_SUBMITTED", 1>;

export async function projectSraSubmitted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1 cross-tenant guard — refuse a forged SRA_SUBMITTED carrying
  // another practice's assessmentId.
  const existing = await tx.practiceSraAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "practiceSraAssessment",
    id: payload.assessmentId,
  });
  if (!existing) {
    // sraCompleted creates the row before this projection runs in the
    // same submit call. If it's missing, the event is malformed (the
    // wizard never persisted answers) and we should not silently no-op.
    throw new Error(
      `SRA_SUBMITTED refused: assessment ${payload.assessmentId} not found`,
    );
  }

  // Pull the saved answers with question metadata so we can map to
  // AnswerWithMeta for the proposal generator.
  const answerRows = await tx.practiceSraAnswer.findMany({
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
    "SRA",
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
