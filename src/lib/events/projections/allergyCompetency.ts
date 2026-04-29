// src/lib/events/projections/allergyCompetency.ts
//
// Three projections for the AllergyCompetency lifecycle:
//   ALLERGY_QUIZ_COMPLETED        → upsert AllergyQuizAttempt + (if passed)
//                                   set quizPassedAt on year's competency
//   ALLERGY_FINGERTIP_TEST_PASSED → increment fingertipPassCount
//   ALLERGY_MEDIA_FILL_PASSED     → set mediaFillPassedAt
// After every write, recomputes isFullyQualified per USP §21:
//   - Initial year: 3 fingertip passes required
//   - Renewal year (prior year had isFullyQualified=true): 1 pass required

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type QuizPayload = PayloadFor<"ALLERGY_QUIZ_COMPLETED", 1>;
type FingertipPayload = PayloadFor<"ALLERGY_FINGERTIP_TEST_PASSED", 1>;
type MediaFillPayload = PayloadFor<"ALLERGY_MEDIA_FILL_PASSED", 1>;

async function ensureCompetency(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; practiceUserId: string; year: number },
): Promise<string> {
  // Audit C-1: refuse cross-tenant writes. The natural-key lookup is
  // (practiceUserId, year) — without verifying that practiceUserId
  // belongs to args.practiceId, a forged event could create or mutate
  // a competency row for another practice's compounder, e.g. flipping
  // their `fingertipPassCount` or `isFullyQualified`.
  const pu = await tx.practiceUser.findUnique({
    where: { id: args.practiceUserId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(
    pu,
    args.practiceId,
    `allergy competency for practiceUser ${args.practiceUserId}`,
  );

  const existing = await tx.allergyCompetency.findUnique({
    where: {
      practiceUserId_year: {
        practiceUserId: args.practiceUserId,
        year: args.year,
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.allergyCompetency.create({
    data: {
      practiceId: args.practiceId,
      practiceUserId: args.practiceUserId,
      year: args.year,
    },
    select: { id: true },
  });
  return created.id;
}

// 6 months expressed as milliseconds (183 days, matching v1's sixMonthsAgo)
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

export async function recomputeIsFullyQualified(
  tx: Prisma.TransactionClient,
  competencyId: string,
): Promise<void> {
  const c = await tx.allergyCompetency.findUniqueOrThrow({
    where: { id: competencyId },
  });
  const priorQualified = await tx.allergyCompetency.findFirst({
    where: {
      practiceUserId: c.practiceUserId,
      year: { lt: c.year },
      isFullyQualified: true,
    },
    select: { id: true },
  });
  const fingertipNeeded = priorQualified ? 1 : 3;

  // USP §21 inactivity rule: if a compounder has logged at least one
  // session (lastCompoundedAt is set) but hasn't compounded in 6+ months,
  // re-evaluation of all 3 components is required.
  const isInactive =
    c.lastCompoundedAt !== null &&
    Date.now() - c.lastCompoundedAt.getTime() >= SIX_MONTHS_MS;

  const qualified =
    Boolean(c.quizPassedAt) &&
    c.fingertipPassCount >= fingertipNeeded &&
    Boolean(c.mediaFillPassedAt) &&
    !isInactive;

  if (qualified !== c.isFullyQualified) {
    await tx.allergyCompetency.update({
      where: { id: competencyId },
      data: { isFullyQualified: qualified },
    });
  }
}

export async function projectAllergyQuizCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: QuizPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Idempotent on attemptId: upsert the AllergyQuizAttempt row.
  const attempt = await tx.allergyQuizAttempt.upsert({
    where: { id: payload.attemptId },
    create: {
      id: payload.attemptId,
      practiceId,
      practiceUserId: payload.practiceUserId,
      year: payload.year,
      completedAt: new Date(),
      score: payload.score,
      passed: payload.passed,
      totalQuestions: payload.totalQuestions,
      correctAnswers: payload.correctAnswers,
    },
    update: {
      completedAt: new Date(),
      score: payload.score,
      passed: payload.passed,
      totalQuestions: payload.totalQuestions,
      correctAnswers: payload.correctAnswers,
    },
  });

  // Insert per-question answer rows (skipDuplicates makes this idempotent
  // on the @@unique([attemptId, questionId])).
  if (payload.answers.length > 0) {
    await tx.allergyQuizAnswer.createMany({
      data: payload.answers.map((a) => ({
        attemptId: attempt.id,
        questionId: a.questionId,
        selectedId: a.selectedId,
        isCorrect: a.isCorrect,
      })),
      skipDuplicates: true,
    });
  }

  if (payload.passed) {
    const compId = await ensureCompetency(tx, {
      practiceId,
      practiceUserId: payload.practiceUserId,
      year: payload.year,
    });
    await tx.allergyCompetency.update({
      where: { id: compId },
      data: { quizAttemptId: attempt.id, quizPassedAt: new Date() },
    });
    await recomputeIsFullyQualified(tx, compId);
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_COMPETENCY",
    );
  }
}

export async function projectAllergyFingertipTestPassed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: FingertipPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const compId = await ensureCompetency(tx, {
    practiceId,
    practiceUserId: payload.practiceUserId,
    year: payload.year,
  });
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: {
      fingertipPassCount: { increment: 1 },
      fingertipLastPassedAt: new Date(),
      fingertipAttestedById: payload.attestedByUserId,
      fingertipNotes: payload.notes ?? null,
    },
  });
  await recomputeIsFullyQualified(tx, compId);
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}

export async function projectAllergyMediaFillPassed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: MediaFillPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const compId = await ensureCompetency(tx, {
    practiceId,
    practiceUserId: payload.practiceUserId,
    year: payload.year,
  });
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: {
      mediaFillPassedAt: new Date(),
      mediaFillAttestedById: payload.attestedByUserId,
      mediaFillNotes: payload.notes ?? null,
    },
  });
  await recomputeIsFullyQualified(tx, compId);
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}
