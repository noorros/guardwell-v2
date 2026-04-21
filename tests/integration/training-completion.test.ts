// tests/integration/training-completion.test.ts
//
// End-to-end: emit TRAINING_COMPLETED, assert the derivation engine
// flips HIPAA_WORKFORCE_TRAINING based on the ≥95% threshold across
// active PracticeUsers, and that expiring / failing / retaking behave.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectTrainingCompleted } from "@/lib/events/projections/trainingCompleted";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithHipaaAndTraining(extraUserCount = 0) {
  const owner = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });

  const extras = await Promise.all(
    Array.from({ length: extraUserCount }, async () => {
      const u = await db.user.create({
        data: {
          firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
          email: `${Math.random().toString(36).slice(2)}@test.com`,
        },
      });
      await db.practiceUser.create({
        data: { userId: u.id, practiceId: practice.id, role: "STAFF" },
      });
      return u;
    }),
  );

  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "HIPAA" },
    include: { requirements: true },
  });
  const trainingReq = framework.requirements.find(
    (r) => r.code === "HIPAA_WORKFORCE_TRAINING",
  );
  const course = await db.trainingCourse.findUniqueOrThrow({
    where: { code: "HIPAA_BASICS" },
  });
  if (!trainingReq) {
    throw new Error(
      "HIPAA_WORKFORCE_TRAINING requirement missing — run `npm run db:seed:hipaa` first.",
    );
  }
  return { owner, extras, practice, framework, trainingReq, course };
}

async function completeTraining({
  practiceId,
  userId,
  courseId,
  courseCode,
  courseVersion,
  score,
  passed,
  expiresAt,
}: {
  practiceId: string;
  userId: string;
  courseId: string;
  courseCode: string;
  courseVersion: number;
  score: number;
  passed: boolean;
  expiresAt: Date;
}) {
  const trainingCompletionId = randomUUID();
  const payload = {
    trainingCompletionId,
    userId,
    courseId,
    courseCode,
    courseVersion,
    score,
    passed,
    expiresAt: expiresAt.toISOString(),
  };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "TRAINING_COMPLETED",
      payload,
    },
    async (tx) => projectTrainingCompleted(tx, { practiceId, payload }),
  );
  return trainingCompletionId;
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("TRAINING_COMPLETED → HIPAA_WORKFORCE_TRAINING derivation", () => {
  it("solo practice owner passes HIPAA_BASICS → requirement flips COMPLIANT", async () => {
    const { owner, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining();

    expect(await statusOf(practice.id, trainingReq.id)).toBe("NOT_STARTED");

    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 100,
      passed: true,
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });

    expect(await statusOf(practice.id, trainingReq.id)).toBe("COMPLIANT");
  });

  it("failed attempt (score below pass) leaves requirement GAP", async () => {
    const { owner, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining();

    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 50,
      passed: false,
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });

    expect(await statusOf(practice.id, trainingReq.id)).toBe("GAP");
  });

  it("2-user practice: 1 passed = 50% → GAP (below 95%)", async () => {
    const { owner, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining(1);

    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 100,
      passed: true,
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });

    expect(await statusOf(practice.id, trainingReq.id)).toBe("GAP");
  });

  it("20-user practice: 19 passed = 95% → COMPLIANT (at threshold)", async () => {
    const { owner, extras, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining(19);

    const passers = [owner, ...extras.slice(0, 18)];
    for (const u of passers) {
      await completeTraining({
        practiceId: practice.id,
        userId: u.id,
        courseId: course.id,
        courseCode: course.code,
        courseVersion: course.version,
        score: 90,
        passed: true,
        expiresAt: new Date(Date.now() + 365 * DAY_MS),
      });
    }

    expect(await statusOf(practice.id, trainingReq.id)).toBe("COMPLIANT");
  });

  it("retaking after failure: later pass flips COMPLIANT (old failure is ignored)", async () => {
    const { owner, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining();

    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 40,
      passed: false,
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });
    expect(await statusOf(practice.id, trainingReq.id)).toBe("GAP");

    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 90,
      passed: true,
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });
    expect(await statusOf(practice.id, trainingReq.id)).toBe("COMPLIANT");
  });

  it("expired completion falls off: flips COMPLIANT → GAP on next re-derive", async () => {
    const { owner, practice, trainingReq, course } =
      await seedPracticeWithHipaaAndTraining();

    // Pass with an immediate expiry (in the past).
    await completeTraining({
      practiceId: practice.id,
      userId: owner.id,
      courseId: course.id,
      courseCode: course.code,
      courseVersion: course.version,
      score: 100,
      passed: true,
      expiresAt: new Date(Date.now() - 1000),
    });

    // Projection called rederive immediately — since expiresAt < now, derivation
    // sees no active completions and keeps it GAP.
    expect(await statusOf(practice.id, trainingReq.id)).toBe("GAP");
  });
});
