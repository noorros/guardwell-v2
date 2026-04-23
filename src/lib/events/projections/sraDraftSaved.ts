// src/lib/events/projections/sraDraftSaved.ts
//
// Projects SRA_DRAFT_SAVED events. Idempotent on assessmentId — each
// save overwrites the draft's answer set to reflect the wizard's current
// state. Does NOT rederive HIPAA_SRA (drafts never satisfy the rule).

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"SRA_DRAFT_SAVED", 1>;

export async function projectSraDraftSaved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; actorUserId: string; payload: Payload },
): Promise<void> {
  const { practiceId, actorUserId, payload } = args;

  // Resolve question codes → ids so we can write the answer rows.
  const codes = payload.answers.map((a) => a.questionCode);
  const questions = codes.length
    ? await tx.sraQuestion.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true },
      })
    : [];
  const byCode = new Map(questions.map((q) => [q.code, q.id]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Unknown SRA question codes: ${missing.join(", ")}`);
  }

  // Running totals so the summary cards stay accurate even on partial drafts.
  const totalCount = payload.answers.length;
  const addressedCount = payload.answers.filter(
    (a) => a.answer === "YES" || a.answer === "NA",
  ).length;
  const overallScore =
    totalCount > 0 ? Math.round((addressedCount / totalCount) * 100) : 0;

  // Upsert the draft shell. Guard against promoting a completed assessment
  // back into draft state — once SRA_COMPLETED has run, further drafts
  // must use a new assessmentId.
  const existing = await tx.practiceSraAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { isDraft: true, practiceId: true },
  });
  if (existing && !existing.isDraft) {
    throw new Error(
      `SRA_DRAFT_SAVED refused: assessment ${payload.assessmentId} is already completed`,
    );
  }
  if (existing && existing.practiceId !== practiceId) {
    throw new Error(
      `SRA_DRAFT_SAVED refused: assessment ${payload.assessmentId} belongs to a different practice`,
    );
  }

  await tx.practiceSraAssessment.upsert({
    where: { id: payload.assessmentId },
    create: {
      id: payload.assessmentId,
      practiceId,
      completedByUserId: actorUserId,
      isDraft: true,
      currentStep: payload.currentStep,
      overallScore,
      addressedCount,
      totalCount,
    },
    update: {
      currentStep: payload.currentStep,
      overallScore,
      addressedCount,
      totalCount,
      // Capture the most recent editor so the UI can show who last touched
      // the draft. Harmless if it's the same user.
      completedByUserId: actorUserId,
    },
  });

  // Replace the answer set atomically. The draft is the live projection of
  // the wizard's state, so old rows are discarded on each save.
  await tx.practiceSraAnswer.deleteMany({
    where: { assessmentId: payload.assessmentId },
  });
  if (payload.answers.length > 0) {
    await tx.practiceSraAnswer.createMany({
      data: payload.answers.map((a) => ({
        assessmentId: payload.assessmentId,
        questionId: byCode.get(a.questionCode)!,
        answer: a.answer,
        notes: a.notes ?? null,
      })),
    });
  }
}
