// src/lib/events/projections/sraCompleted.ts
//
// Projects SRA_COMPLETED events. One event represents a completed HIPAA
// Security Risk Assessment. If a draft row already exists (from prior
// SRA_DRAFT_SAVED events), it is promoted — isDraft flips to false and
// completedAt is set. Otherwise a fresh row is created. Answers are
// always rewritten from the event payload so the final completion is
// the source of truth. Then rederives HIPAA_SRA.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"SRA_COMPLETED", 1>;

export async function projectSraCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse cross-tenant writes. If `assessmentId` belongs to
  // another practice, a forged event would otherwise overwrite that
  // practice's row.
  const existing = await tx.practiceSraAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(
    existing,
    practiceId,
    `SRA_COMPLETED ${payload.assessmentId}`,
  );

  // Resolve question codes to question IDs in bulk for the FK writes.
  const codes = payload.answers.map((a) => a.questionCode);
  const questions = await tx.sraQuestion.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const byCode = new Map(questions.map((q) => [q.code, q.id]));

  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Unknown SRA question codes: ${missing.join(", ")}`);
  }

  // Upsert handles both the fresh-completion and draft-promotion paths.
  // Answers are fully replaced so the final SRA_COMPLETED payload is the
  // source of truth for the assessment's question set.
  await tx.practiceSraAssessment.upsert({
    where: { id: payload.assessmentId },
    create: {
      id: payload.assessmentId,
      practiceId,
      completedByUserId: payload.completedByUserId,
      completedAt: new Date(),
      overallScore: payload.overallScore,
      addressedCount: payload.addressedCount,
      totalCount: payload.totalCount,
      isDraft: false,
    },
    update: {
      completedByUserId: payload.completedByUserId,
      completedAt: new Date(),
      overallScore: payload.overallScore,
      addressedCount: payload.addressedCount,
      totalCount: payload.totalCount,
      isDraft: false,
    },
  });

  await tx.practiceSraAnswer.deleteMany({
    where: { assessmentId: payload.assessmentId },
  });
  await tx.practiceSraAnswer.createMany({
    data: payload.answers.map((a) => ({
      assessmentId: payload.assessmentId,
      questionId: byCode.get(a.questionCode)!,
      answer: a.answer,
      notes: a.notes ?? null,
    })),
  });

  await rederiveRequirementStatus(tx, practiceId, "SRA_COMPLETED");
}
