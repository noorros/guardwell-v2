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
import {
  projectTrainingAssigned,
  projectTrainingAssignmentRevoked,
  projectStaffExcludedFromAssignment,
  projectTrainingCourseCreated,
  projectTrainingCourseUpdated,
  projectTrainingCourseRetired,
} from "./training";

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

describe("projectTrainingAssignmentRevoked", () => {
  it("stamps revokedAt + reason + revokedByUserId on the row", async () => {
    const { practice, course, actor } = await seed();
    const assignmentId = randomUUID();
    // Direct create is allowed in tests (tests/ is in ALLOWED_PATHS).
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: actor.userId,
      },
    });
    await db.$transaction(async (tx) => {
      await projectTrainingAssignmentRevoked(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload: { assignmentId, reason: "Course retired" },
      });
    });
    const row = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedReason).toBe("Course retired");
    expect(row.revokedByUserId).toBe(actor.userId);
  });
});

describe("projectStaffExcludedFromAssignment", () => {
  it("creates an AssignmentExclusion row keyed by (assignmentId, userId)", async () => {
    const { practice, course, actor } = await seed();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: actor.userId,
      },
    });
    const excludedUser = await db.user.create({
      data: {
        firebaseUid: `tp-excl-${Math.random().toString(36).slice(2, 10)}`,
        email: `tp-excl-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.$transaction(async (tx) => {
      await projectStaffExcludedFromAssignment(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload: {
          assignmentId,
          userId: excludedUser.id,
          reason: "On medical leave",
        },
      });
    });
    const row = await db.assignmentExclusion.findUniqueOrThrow({
      where: {
        assignmentId_userId: { assignmentId, userId: excludedUser.id },
      },
    });
    expect(row.reason).toBe("On medical leave");
    expect(row.excludedByUserId).toBe(actor.userId);
  });

  it("is idempotent on replay (upsert collapses to one row, latest reason wins)", async () => {
    const { practice, course, actor } = await seed();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: actor.userId,
      },
    });
    const excludedUser = await db.user.create({
      data: {
        firebaseUid: `tp-excl-${Math.random().toString(36).slice(2, 10)}`,
        email: `tp-excl-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.$transaction(async (tx) => {
      await projectStaffExcludedFromAssignment(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload: { assignmentId, userId: excludedUser.id, reason: "First" },
      });
    });
    await db.$transaction(async (tx) => {
      await projectStaffExcludedFromAssignment(tx, {
        practiceId: practice.id,
        actorUserId: actor.userId,
        payload: { assignmentId, userId: excludedUser.id, reason: "Second" },
      });
    });
    const rows = await db.assignmentExclusion.findMany({
      where: { assignmentId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("Second");
  });
});

describe("projectTrainingCourseCreated", () => {
  it("creates a TrainingCourse row with the projection's authored defaults", async () => {
    const { actor } = await seed();
    const courseId = randomUUID();
    const code = `CUSTOM_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await db.$transaction(async (tx) => {
      await projectTrainingCourseCreated(tx, {
        practiceId: actor.practiceId,
        actorUserId: actor.userId,
        payload: {
          courseId,
          code,
          title: "My Custom Course",
          type: "CUSTOM",
          durationMinutes: 45,
          passingScore: 70,
          isCustom: true,
        },
      });
    });
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: courseId },
    });
    expect(row.code).toBe(code);
    expect(row.title).toBe("My Custom Course");
    expect(row.type).toBe("CUSTOM");
    expect(row.durationMinutes).toBe(45);
    expect(row.passingScore).toBe(70);
    expect(row.isRequired).toBe(false);
    expect(row.version).toBe(1);
    expect(row.sortOrder).toBe(999);
    expect(row.lessonContent).toBe("");
    // cleanup so a later test doesn't observe this row through cascade
    await db.trainingCourse.delete({ where: { id: courseId } });
  });
});

describe("projectTrainingCourseUpdated", () => {
  it("bumps the version on the TrainingCourse row", async () => {
    const { actor } = await seed();
    const courseId = randomUUID();
    const code = `CUSTOM_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await db.trainingCourse.create({
      data: {
        id: courseId,
        code,
        title: "Original",
        type: "CUSTOM",
        lessonContent: "v1 body",
        version: 1,
      },
    });
    await db.$transaction(async (tx) => {
      await projectTrainingCourseUpdated(tx, {
        practiceId: actor.practiceId,
        actorUserId: actor.userId,
        payload: {
          courseId,
          version: 2,
          changedFields: ["title", "lessonContent"],
        },
      });
    });
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: courseId },
    });
    expect(row.version).toBe(2);
    await db.trainingCourse.delete({ where: { id: courseId } });
  });
});

describe("projectTrainingCourseRetired", () => {
  it("soft-retires the course by setting sortOrder to 9999", async () => {
    const { actor } = await seed();
    const courseId = randomUUID();
    const code = `CUSTOM_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await db.trainingCourse.create({
      data: {
        id: courseId,
        code,
        title: "Retire Me",
        type: "CUSTOM",
        lessonContent: "soon to retire",
        sortOrder: 5,
      },
    });
    await db.$transaction(async (tx) => {
      await projectTrainingCourseRetired(tx, {
        practiceId: actor.practiceId,
        actorUserId: actor.userId,
        payload: { courseId },
      });
    });
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: courseId },
    });
    expect(row.sortOrder).toBe(9999);
    await db.trainingCourse.delete({ where: { id: courseId } });
  });
});
