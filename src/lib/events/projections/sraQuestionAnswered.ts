// src/lib/events/projections/sraQuestionAnswered.ts
//
// Phase 5 — granular SRA partial-save projection. Upserts a single
// answer row and bumps the parent assessment's updatedAt so listeners
// can detect activity. Distinct from sraDraftSaved (legacy bulk-save)
// which lives alongside.
//
// The action layer creates the assessment row with isDraft=true on
// first answer (via this projection's create-on-missing path) and
// passes through subsequent SRA_QUESTION_ANSWERED events as upserts.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"SRA_QUESTION_ANSWERED", 1>;

export async function projectSraQuestionAnswered(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; actorUserId: string; payload: Payload },
): Promise<void> {
  const { practiceId, actorUserId, payload } = args;

  // Audit C-1 cross-tenant guard. assessmentId arrives in the event
  // payload; if a forged event references another practice's draft,
  // refuse the write.
  const existing = await tx.practiceSraAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true, isDraft: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "practiceSraAssessment",
    id: payload.assessmentId,
  });
  if (existing && !existing.isDraft) {
    throw new Error(
      `SRA_QUESTION_ANSWERED refused: assessment ${payload.assessmentId} is already completed`,
    );
  }

  // Resolve question code → id.
  const question = await tx.sraQuestion.findUnique({
    where: { code: payload.questionCode },
    select: { id: true },
  });
  if (!question) {
    throw new Error(`Unknown SRA question code: ${payload.questionCode}`);
  }

  // Lazily create the assessment shell on the first answer so the
  // wizard doesn't need a separate "create draft" round-trip.
  if (!existing) {
    await tx.practiceSraAssessment.create({
      data: {
        id: payload.assessmentId,
        practiceId,
        completedByUserId: actorUserId,
        isDraft: true,
        currentStep: 0,
      },
    });
  } else {
    // Bump updatedAt so listeners (badges, progress widgets) can
    // detect activity. Also keep completedByUserId fresh in case the
    // last editor is a different ADMIN.
    await tx.practiceSraAssessment.update({
      where: { id: payload.assessmentId },
      data: {
        completedByUserId: actorUserId,
        updatedAt: new Date(),
      },
    });
  }

  await tx.practiceSraAnswer.upsert({
    where: {
      assessmentId_questionId: {
        assessmentId: payload.assessmentId,
        questionId: question.id,
      },
    },
    update: {
      answer: payload.answer,
      notes: payload.notes ?? null,
    },
    create: {
      assessmentId: payload.assessmentId,
      questionId: question.id,
      answer: payload.answer,
      notes: payload.notes ?? null,
    },
  });
}
