// src/lib/events/projections/allergyCompetency.ts
//
// Five projections for the AllergyCompetency lifecycle:
//   ALLERGY_QUIZ_COMPLETED        → upsert AllergyQuizAttempt + (if passed)
//                                   set quizPassedAt on year's competency
//   ALLERGY_FINGERTIP_TEST_PASSED → increment fingertipPassCount
//   ALLERGY_MEDIA_FILL_PASSED     → set mediaFillPassedAt
//   ALLERGY_COMPOUNDING_LOGGED    → set lastCompoundedAt (audit #9)
//   ALLERGY_REQUIREMENT_TOGGLED   → flip PracticeUser.requiresAllergyCompetency
//                                   (audit #9)
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
type CompoundingPayload = PayloadFor<"ALLERGY_COMPOUNDING_LOGGED", 1>;
type RequirementTogglePayload = PayloadFor<"ALLERGY_REQUIREMENT_TOGGLED", 1>;

async function ensureCompetency(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; practiceUserId: string; year: number },
): Promise<string> {
  // Audit C-1: gate on practiceUserId — without this guard, a forged
  // event could create a competency row with our practiceId pointing
  // to another practice's PracticeUser (FK invariant break) AND
  // mutate another practice's compounder's competency totals via the
  // (practiceUserId, year) unique key.
  const targetUser = await tx.practiceUser.findUnique({
    where: { id: args.practiceUserId },
    select: { practiceId: true },
  });
  if (!targetUser) {
    throw new Error(
      `Allergy projection refused: practiceUser ${args.practiceUserId} not found`,
    );
  }
  assertProjectionPracticeOwned(targetUser, args.practiceId, {
    table: "practiceUser",
    id: args.practiceUserId,
  });

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
  // Audit #21 CR-4 (2026-04-30): USP §21.3 requires re-qualification
  // (3 fingertips, not 1) after a year off. The previous "any prior
  // year qualified" lookup let a 2024-qualified compounder skip 2025
  // entirely and renew with a single fingertip in 2026 — the regulation
  // treats that as INITIAL, not RENEWAL.
  //
  // Strict semantics: only `c.year - 1` counts as the prior-year
  // qualifying record. Schema has no separate "inactivity flag" column
  // (the audit had assumed one); presence of `isFullyQualified=true` on
  // the year-1 row IS the inactivity check — if year-1 was never built
  // up to qualified, the compounder went a year without competency by
  // definition.
  //
  // Intentional merger: "no year-1 row" and "year-1 row exists but
  // isFullyQualified=false" are treated identically here — both mean
  // the compounder was not fully qualified at any point during year-1.
  // Per USP §21.3 strict reading that requires the initial 3-fingertip
  // path, not the 1-fingertip renewal. Example: compounder qualified
  // 2024, did 1 fingertip + media fill in 2025 but never passed the
  // quiz (year-1 row exists, isFullyQualified=false), wants to renew
  // with 1 fingertip in 2026 → forced into 3-fingertip initial. Correct.
  const priorYearQualified = await tx.allergyCompetency.findFirst({
    where: {
      practiceUserId: c.practiceUserId,
      year: c.year - 1,
      isFullyQualified: true,
    },
    select: { id: true },
  });
  const fingertipNeeded = priorYearQualified ? 1 : 3;

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

  // Audit C-1: refuse a forged ALLERGY_QUIZ_COMPLETED carrying another
  // practice's attemptId — without this guard, an existing attempt in
  // Practice B could be overwritten with attacker-supplied score /
  // passed flag. The ensureCompetency call below also guards the
  // practiceUserId path.
  const existingAttempt = await tx.allergyQuizAttempt.findUnique({
    where: { id: payload.attemptId },
    select: { practiceId: true, practiceUserId: true },
  });
  assertProjectionPracticeOwned(existingAttempt, practiceId, {
    table: "allergyQuizAttempt",
    id: payload.attemptId,
  });
  // Audit #21 CR-3 (2026-04-30): same-tenant cross-user overwrite guard.
  // Tenancy alone isn't enough — STAFF user B inside the same practice
  // could submit at user A's attemptId and overwrite A's score / passed
  // / correctAnswers. The existing row's practiceUserId stays correct on
  // upsert (we don't update it), but the OTHER fields would be replaced
  // with B's results, silently corrupting A's competency record.
  if (
    existingAttempt &&
    existingAttempt.practiceUserId !== payload.practiceUserId
  ) {
    throw new Error(
      `Projection refused: allergyQuizAttempt ${payload.attemptId} cross-user overwrite forbidden (existing practiceUserId=${existingAttempt.practiceUserId}, payload practiceUserId=${payload.practiceUserId})`,
    );
  }

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

/**
 * ALLERGY_COMPOUNDING_LOGGED — admin records a compounding session.
 * Sets lastCompoundedAt; the recompute call may flip
 * isFullyQualified back to true if the inactivity wall was the
 * limiting factor. Audit #9 (2026-04-29) — closes the silent
 * projection-mutation gap from logCompoundingActivityAction.
 */
export async function projectAllergyCompoundingLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: CompoundingPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const compId = await ensureCompetency(tx, {
    practiceId,
    practiceUserId: payload.practiceUserId,
    year: payload.year,
  });
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: { lastCompoundedAt: new Date(payload.loggedAt) },
  });
  await recomputeIsFullyQualified(tx, compId);
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}

/**
 * ALLERGY_REQUIREMENT_TOGGLED — admin flips
 * PracticeUser.requiresAllergyCompetency on/off for a staff member.
 * Idempotent: if `required` already matches DB state, this is a
 * no-op (the action layer reads previousValue first to decide
 * whether to emit, but we still gate here in case of replay).
 * Audit #9 (2026-04-29) — closes the silent toggleStaffAllergyRequirement
 * projection-mutation gap.
 */
export async function projectAllergyRequirementToggled(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RequirementTogglePayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: gate on practiceUserId — without this guard, a forged
  // ALLERGY_REQUIREMENT_TOGGLED could flip another practice's user
  // requiresAllergyCompetency flag, mutating their compliance state.
  const targetUser = await tx.practiceUser.findUnique({
    where: { id: payload.practiceUserId },
    select: { practiceId: true },
  });
  if (!targetUser) {
    throw new Error(
      `ALLERGY_REQUIREMENT_TOGGLED refused: practiceUser ${payload.practiceUserId} not found`,
    );
  }
  assertProjectionPracticeOwned(targetUser, practiceId, {
    table: "practiceUser",
    id: payload.practiceUserId,
  });

  await tx.practiceUser.update({
    where: { id: payload.practiceUserId },
    data: { requiresAllergyCompetency: payload.required },
  });
  // Toggling the requirement may flip ALLERGY_COMPETENCY's overall
  // status — staff who no longer require competency stop counting
  // toward the gap.
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}
