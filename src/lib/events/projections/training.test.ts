// src/lib/events/projections/training.test.ts
//
// Phase 4 PR 1 — projection tests for the 6 new training events.
// Pure data plane: each test calls the projection directly inside an
// ad-hoc db.$transaction so we can assert on the projected row shape
// without going through appendEventAndApply (the event-validation +
// transactional wrapping is exercised by tests under tests/integration).
//
// The shared tests/setup.ts cleanup wipes the new tables; per-test
// inline seed creates User + Practice + PracticeUser + a TrainingCourse.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { projectTrainingAssigned } from "./training";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `tp-${Math.random().toString(36).slice(2, 10)}`,
      email: `tp-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Training Proj Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const course = await db.trainingCourse.upsert({
    where: { code: "TEST_COURSE_TRAINING_PROJ" },
    update: {},
    create: {
      code: "TEST_COURSE_TRAINING_PROJ",
      title: "Test Course",
      type: "HIPAA",
      lessonContent: "lesson body",
      durationMinutes: 30,
      passingScore: 80,
      sortOrder: 5,
    },
  });
  return { practice, course, actor: { userId: user.id, practiceId: practice.id } };
}

describe("projectTrainingAssigned", () => {
  it("creates a TrainingAssignment row with the right fields", async () => {
    const { practice, course, actor } = await seed();
    const assignmentId = randomUUID();
    const dueDate = new Date("2026-12-31T00:00:00.000Z");
    await db.$transaction(async (tx) => {
      await projectTrainingAssigned(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload: {
          assignmentId,
          courseId: course.id,
          assignedToUserId: actor.userId,
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: dueDate.toISOString(),
          requiredFlag: true,
        },
      });
    });
    const row = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(row.practiceId).toBe(practice.id);
    expect(row.courseId).toBe(course.id);
    expect(row.assignedToUserId).toBe(actor.userId);
    expect(row.assignedToRole).toBeNull();
    expect(row.assignedToCategory).toBeNull();
    expect(row.dueDate?.getTime()).toBe(dueDate.getTime());
    expect(row.requiredFlag).toBe(true);
    expect(row.createdByUserId).toBe(actor.userId);
    expect(row.revokedAt).toBeNull();
  });

  it("is idempotent on replay (only one row after two calls)", async () => {
    const { practice, course, actor } = await seed();
    const assignmentId = randomUUID();
    const payload = {
      assignmentId,
      courseId: course.id,
      assignedToUserId: null,
      assignedToRole: "STAFF" as const,
      assignedToCategory: null,
      dueDate: null,
      requiredFlag: true,
    };
    await db.$transaction(async (tx) => {
      await projectTrainingAssigned(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload,
      });
    });
    await db.$transaction(async (tx) => {
      await projectTrainingAssigned(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload,
      });
    });
    const count = await db.trainingAssignment.count({
      where: { id: assignmentId },
    });
    expect(count).toBe(1);
  });
});
