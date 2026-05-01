// src/lib/events/projections/techAssessmentQuestionAnswered.ts
//
// Phase 5 PR 4 — granular Tech Assessment partial-save projection.
// Mirrors sraQuestionAnswered.ts: assert practice ownership, resolve
// question by code, lazily create the assessment shell on the first
// answer, and upsert the answer row.
//
// The action layer creates the assessment row with isDraft=true on the
// first answer (via this projection's create-on-missing path) and passes
// through subsequent TECH_ASSESSMENT_QUESTION_ANSWERED events as upserts.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"TECH_ASSESSMENT_QUESTION_ANSWERED", 1>;

export async function projectTechAssessmentQuestionAnswered(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; actorUserId: string; payload: Payload },
): Promise<void> {
  const { practiceId, actorUserId, payload } = args;

  // Audit C-1 cross-tenant guard. assessmentId arrives in the event
  // payload; if a forged event references another practice's draft,
  // refuse the write.
  const existing = await tx.techAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true, isDraft: true, completedAt: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "techAssessment",
    id: payload.assessmentId,
  });
  if (existing && (!existing.isDraft || existing.completedAt !== null)) {
    throw new Error(
      `TECH_ASSESSMENT_QUESTION_ANSWERED refused: assessment ${payload.assessmentId} is already completed`,
    );
  }

  // Resolve question code → id.
  const question = await tx.techAssessmentQuestion.findUnique({
    where: { code: payload.questionCode },
    select: { id: true },
  });
  if (!question) {
    throw new Error(
      `Unknown Tech Assessment question code: ${payload.questionCode}`,
    );
  }

  // Lazily create the assessment shell on the first answer so the
  // wizard doesn't need a separate "create draft" round-trip.
  if (!existing) {
    await tx.techAssessment.create({
      data: {
        id: payload.assessmentId,
        practiceId,
        completedByUserId: actorUserId,
        isDraft: true,
        currentStep: 0,
      },
    });
  } else {
    // Bump updatedAt so listeners (badges, progress widgets) can detect
    // activity. Also keep completedByUserId fresh in case the last
    // editor is a different ADMIN.
    await tx.techAssessment.update({
      where: { id: payload.assessmentId },
      data: {
        completedByUserId: actorUserId,
        updatedAt: new Date(),
      },
    });
  }

  await tx.techAssessmentAnswer.upsert({
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
