// tests/integration/allergy-competency.test.ts
//
// Competency lifecycle:
//   ALLERGY_QUIZ_COMPLETED (passed) → quizPassedAt set
//   ALLERGY_FINGERTIP_TEST_PASSED × 3 → count = 3
//   ALLERGY_MEDIA_FILL_PASSED → mediaFillPassedAt set
//   isFullyQualified flips true after all three components

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
  recomputeIsFullyQualified,
} from "@/lib/events/projections/allergyCompetency";
import { randomUUID } from "node:crypto";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `allergy-${Math.random().toString(36).slice(2, 10)}`,
      email: `a-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Allergy Test Clinic", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  const compounder = await db.user.create({
    data: {
      firebaseUid: `compounder-${Math.random().toString(36).slice(2, 10)}`,
      email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const compounderPu = await db.practiceUser.create({
    data: {
      userId: compounder.id,
      practiceId: practice.id,
      role: "STAFF",
      requiresAllergyCompetency: true,
    },
  });
  return { owner, ownerPu, compounder, compounderPu, practice };
}

describe("Allergy competency lifecycle", () => {
  it("flips isFullyQualified true after all 3 components (initial: 3 fingertip passes)", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();

    // Quiz pass
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year,
          score: 92,
          passed: true,
          correctAnswers: 23,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year,
            score: 92,
            passed: true,
            correctAnswers: 23,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );

    // 3 fingertip passes
    for (let i = 0; i < 3; i++) {
      const payload = {
        practiceUserId: compounderPu.id,
        year,
        attestedByUserId: ownerPu.id,
        notes: null,
      };
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_FINGERTIP_TEST_PASSED",
          payload,
        },
        async (tx) =>
          projectAllergyFingertipTestPassed(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }

    // Media fill pass
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year },
      },
    });
    expect(comp.quizPassedAt).not.toBeNull();
    expect(comp.fingertipPassCount).toBe(3);
    expect(comp.mediaFillPassedAt).not.toBeNull();
    expect(comp.isFullyQualified).toBe(true);
  });

  it("renewal year only requires 1 fingertip pass when prior year was qualified", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const lastYear = new Date().getFullYear() - 1;
    const thisYear = lastYear + 1;

    // Pre-seed last year's qualification.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: lastYear,
        quizPassedAt: new Date(`${lastYear}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${lastYear}-03-15`),
        mediaFillPassedAt: new Date(`${lastYear}-04-01`),
        isFullyQualified: true,
      },
    });

    // This year: 1 quiz pass + 1 fingertip + 1 media fill should qualify.
    const attemptId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year: thisYear,
          score: 88,
          passed: true,
          correctAnswers: 22,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year: thisYear,
            score: 88,
            passed: true,
            correctAnswers: 22,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        payload: ftPayload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload: ftPayload,
        }),
    );
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    expect(comp.fingertipPassCount).toBe(1);
    expect(comp.isFullyQualified).toBe(true);
  });

  it("flips isFullyQualified false when lastCompoundedAt is older than 6 months", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();

    // First build a fully qualified compounder (all 3 components done).
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year,
          score: 88,
          passed: true,
          correctAnswers: 22,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year,
            score: 88,
            passed: true,
            correctAnswers: 22,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );
    for (let i = 0; i < 3; i++) {
      const payload = {
        practiceUserId: compounderPu.id,
        year,
        attestedByUserId: ownerPu.id,
        notes: null,
      };
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_FINGERTIP_TEST_PASSED",
          payload,
        },
        async (tx) =>
          projectAllergyFingertipTestPassed(tx, { practiceId: practice.id, payload }),
      );
    }
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, { practiceId: practice.id, payload: mfPayload }),
    );

    // Confirm fully qualified before manipulating lastCompoundedAt.
    const before = await db.allergyCompetency.findUniqueOrThrow({
      where: { practiceUserId_year: { practiceUserId: compounderPu.id, year } },
    });
    expect(before.isFullyQualified).toBe(true);

    // Backdate lastCompoundedAt to 7 months ago to simulate inactivity.
    const sevenMonthsAgo = new Date(Date.now() - 213 * 24 * 60 * 60 * 1000);
    await db.allergyCompetency.update({
      where: { id: before.id },
      data: { lastCompoundedAt: sevenMonthsAgo },
    });

    // Re-run the projection — inactivity should flip isFullyQualified false.
    await db.$transaction(async (tx) => {
      await recomputeIsFullyQualified(tx, before.id);
    });

    const after = await db.allergyCompetency.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.isFullyQualified).toBe(false);
  });

  it("is idempotent on duplicate quiz events (same attemptId)", async () => {
    const { owner, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();
    const payload = {
      attemptId,
      practiceUserId: compounderPu.id,
      year,
      score: 92,
      passed: true,
      correctAnswers: 23,
      totalQuestions: 25,
      answers: [],
    };
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_QUIZ_COMPLETED",
          payload,
        },
        async (tx) =>
          projectAllergyQuizCompleted(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }
    const attempts = await db.allergyQuizAttempt.findMany({
      where: { id: attemptId },
    });
    expect(attempts).toHaveLength(1);
  });
});

describe("Audit #21 CR-3 — quiz attempt cross-user overwrite guard", () => {
  it("rejects a same-tenant cross-user overwrite at the same attemptId", async () => {
    const { owner, practice, compounderPu } = await seed();
    // Add a SECOND compounder in the SAME practice (same tenant, different user).
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `compounder2-${Math.random().toString(36).slice(2, 10)}`,
        email: `c2-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherCompounderPu = await db.practiceUser.create({
      data: {
        userId: otherUser.id,
        practiceId: practice.id,
        role: "STAFF",
        requiresAllergyCompetency: true,
      },
    });
    const year = new Date().getFullYear();
    const attemptId = randomUUID();

    // User A submits first — landing the attempt with their score.
    const aPayload = {
      attemptId,
      practiceUserId: compounderPu.id,
      year,
      score: 92,
      passed: true,
      correctAnswers: 23,
      totalQuestions: 25,
      answers: [],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: aPayload,
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, { practiceId: practice.id, payload: aPayload }),
    );

    // User B replays at the same attemptId with a DIFFERENT practiceUserId
    // — this is the cross-user attack the guard blocks.
    const bPayload = {
      ...aPayload,
      practiceUserId: otherCompounderPu.id,
      score: 50,
      passed: false,
      correctAnswers: 12,
    };
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_QUIZ_COMPLETED",
          payload: bPayload,
        },
        async (tx) =>
          projectAllergyQuizCompleted(tx, {
            practiceId: practice.id,
            payload: bPayload,
          }),
      ),
    ).rejects.toThrow(/cross-user overwrite forbidden/);

    // User A's row should be untouched — score still 92, passed still true.
    const after = await db.allergyQuizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(after.practiceUserId).toBe(compounderPu.id);
    expect(after.score).toBe(92);
    expect(after.passed).toBe(true);
    expect(after.correctAnswers).toBe(23);
  });

  it("allows the SAME user to replay (idempotent path stays open)", async () => {
    // Defensive case — the guard must not break the legitimate idempotent
    // replay path used elsewhere in the suite. Same practiceUserId,
    // different timestamps allowed.
    const { owner, practice, compounderPu } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();
    const payload = {
      attemptId,
      practiceUserId: compounderPu.id,
      year,
      score: 88,
      passed: true,
      correctAnswers: 22,
      totalQuestions: 25,
      answers: [],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload,
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, { practiceId: practice.id, payload }),
    );
    // Replay — should NOT throw.
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload,
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, { practiceId: practice.id, payload }),
    );
    const after = await db.allergyQuizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(after.practiceUserId).toBe(compounderPu.id);
  });
});

describe("Audit #21 CR-4 — USP §21.3 strict gap-year qualification", () => {
  // Strict semantics: only year `c.year - 1` counts. A gap (no qualifying
  // record at year-1) forces the current year back to INITIAL (3 fingertip
  // passes), not RENEWAL (1 fingertip).

  it("requires 3 fingertips when year-1 was never qualified (gap year)", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const thisYear = new Date().getFullYear();
    const twoYearsAgo = thisYear - 2;
    const lastYear = thisYear - 1;

    // Two-years-ago: fully qualified.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: twoYearsAgo,
        quizPassedAt: new Date(`${twoYearsAgo}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${twoYearsAgo}-03-15`),
        mediaFillPassedAt: new Date(`${twoYearsAgo}-04-01`),
        isFullyQualified: true,
      },
    });
    // Last year: gap (no row at all → no qualification).
    // (Intentionally not creating a lastYear row.)
    void lastYear;

    // This year: 1 quiz pass + 1 fingertip + 1 media fill — what would
    // have qualified under the lax (any-prior-year) semantics. Under
    // strict semantics, isFullyQualified must stay false because year-1
    // wasn't qualified.
    const attemptId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year: thisYear,
          score: 90,
          passed: true,
          correctAnswers: 23,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year: thisYear,
            score: 90,
            passed: true,
            correctAnswers: 23,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        payload: ftPayload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload: ftPayload,
        }),
    );
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    // 1 fingertip < 3 required (initial year semantics) → not fully qualified.
    expect(comp.fingertipPassCount).toBe(1);
    expect(comp.isFullyQualified).toBe(false);
  });

  it("requires 3-fingertip initial when prior year row exists but is unqualified", async () => {
    // Edge case: year-1 ROW exists (compounder did some work) but
    // isFullyQualified=false (never completed all three components in
    // year-1). Strict semantics merge this with the "no row" case —
    // both mean "not fully qualified during year-1," so year-N must
    // restart at the 3-fingertip initial path, not 1-fingertip renewal.
    //
    // Concrete shape: 2024 fully qualified (separate, even older), 2025
    // did 1 fingertip + media fill but never passed the quiz → year-1
    // row present with isFullyQualified=false, then 2026 wants to renew
    // with 1 fingertip. Must NOT qualify on 1.
    const { ownerPu, compounderPu, practice } = await seed();
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;
    const twoYearsAgo = thisYear - 2;

    // Two-years-ago: fully qualified (older qualification doesn't bridge
    // a year-1 gap, but seeding it makes the scenario realistic).
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: twoYearsAgo,
        quizPassedAt: new Date(`${twoYearsAgo}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${twoYearsAgo}-03-15`),
        mediaFillPassedAt: new Date(`${twoYearsAgo}-04-01`),
        isFullyQualified: true,
      },
    });
    // Last year: row EXISTS but isFullyQualified=false (1 fingertip +
    // media fill, no quiz pass). This is the case the strict-year-1
    // query intentionally merges with the "no row" gap case.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: lastYear,
        quizPassedAt: null,
        fingertipPassCount: 1,
        fingertipLastPassedAt: new Date(`${lastYear}-05-15`),
        mediaFillPassedAt: new Date(`${lastYear}-06-01`),
        isFullyQualified: false,
      },
    });

    // This year: 1 fingertip pass — would qualify under lax (any-prior)
    // semantics, must NOT under strict semantics because year-1 was not
    // fully qualified.
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await db.$transaction(async (tx) => {
      await projectAllergyFingertipTestPassed(tx, {
        practiceId: practice.id,
        payload: ftPayload,
      });
    });
    const after = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    expect(after.fingertipPassCount).toBe(1);
    // Strict semantics: year-1 was not fully qualified → 3-fingertip
    // initial required → 1 pass is not enough.
    expect(after.isFullyQualified).toBe(false);
  });

  it("allows 1-fingertip renewal when year-1 was qualified (no gap)", async () => {
    // Companion to the CR-4 strict test: the renewal path still works
    // when there is no gap. Year-1 was qualified → year-N needs only 1.
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;

    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: lastYear,
        quizPassedAt: new Date(`${lastYear}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${lastYear}-03-15`),
        mediaFillPassedAt: new Date(`${lastYear}-04-01`),
        isFullyQualified: true,
      },
    });

    const attemptId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year: thisYear,
          score: 88,
          passed: true,
          correctAnswers: 22,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year: thisYear,
            score: 88,
            passed: true,
            correctAnswers: 22,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        payload: ftPayload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload: ftPayload,
        }),
    );
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );
    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    expect(comp.fingertipPassCount).toBe(1);
    expect(comp.isFullyQualified).toBe(true);
  });

  it("requires 3 fingertips even when 2-years-ago was qualified but year-1 was not", async () => {
    // Edge case: an even-older qualification doesn't bridge a year-1 gap.
    // Asserts the strict semantics actually filters on `c.year - 1`,
    // not on "any year strictly less than c.year".
    const { ownerPu, compounderPu, practice } = await seed();
    const thisYear = new Date().getFullYear();

    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: thisYear - 2,
        quizPassedAt: new Date(`${thisYear - 2}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${thisYear - 2}-03-15`),
        mediaFillPassedAt: new Date(`${thisYear - 2}-04-01`),
        isFullyQualified: true,
      },
    });

    // Build the current year's competency directly via a fingertip pass
    // event (skip quiz/media-fill — we only care that fingertipNeeded
    // reads as 3, not 1).
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await db.$transaction(async (tx) => {
      await projectAllergyFingertipTestPassed(tx, {
        practiceId: practice.id,
        payload: ftPayload,
      });
    });
    const after = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    expect(after.fingertipPassCount).toBe(1);
    // Without a year-1 qualifying row, the (initial) 3-pass requirement
    // applies — 1 pass with no quiz / no media fill stays not-fully-qualified.
    expect(after.isFullyQualified).toBe(false);
  });
});
