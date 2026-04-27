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
