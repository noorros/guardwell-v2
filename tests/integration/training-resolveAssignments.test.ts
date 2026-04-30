// tests/integration/training-resolveAssignments.test.ts
//
// Phase 4 PR 3 — read-time resolver tests. The helper takes a (practice,
// user, role) tuple and returns the user's "My Training" view, joined to
// the latest passing TrainingCompletion to compute a 4-state status
// (TO_DO / IN_PROGRESS / COMPLETED / OVERDUE). These tests pin every
// branch of that derivation against a real Postgres so a regression in
// the OR-clause shape, the exclusion filter, or the expiry check fails
// loudly.
//
// IN_PROGRESS is intentionally NOT exercised here — PR 6 wires that
// state through VideoProgress; until then nothing can land in it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { resolveAssignmentsForUser } from "@/lib/training/resolveAssignments";

async function seedUser(prefix = "rs") {
  return db.user.create({
    data: {
      firebaseUid: `${prefix}-${Math.random().toString(36).slice(2, 10)}`,
      email: `${prefix}-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
}

async function seedPractice(name = "RS Practice") {
  return db.practice.create({
    data: { name, primaryState: "AZ" },
  });
}

async function seedCourse(opts?: { code?: string }) {
  const code =
    opts?.code ??
    `RS_COURSE_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return db.trainingCourse.upsert({
    where: { code },
    update: {},
    create: {
      code,
      title: `Course ${code}`,
      type: "HIPAA",
      lessonContent: "lesson body",
      durationMinutes: 30,
      passingScore: 80,
      isRequired: false,
      roles: [],
    },
  });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("resolveAssignmentsForUser (Phase 4 PR 3)", () => {
  afterEach(() => {
    // Restore real timers in case a test invoked vi.useFakeTimers().
    // Tests that don't fake the clock are unaffected.
    vi.useRealTimers();
  });

  it("returns empty arrays for a user with no assignments", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toEqual([]);
    expect(result.completed).toBe(0);
    expect(result.inProgress).toBe(0);
    expect(result.toDo).toBe(0);
  });

  it("resolves a direct user assignment", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    const a = result.assignments[0]!;
    expect(a.id).toBe(assignment.id);
    expect(a.courseId).toBe(course.id);
    expect(a.courseCode).toBe(course.code);
    expect(a.courseTitle).toBe(course.title);
    expect(a.type).toBe("HIPAA");
    expect(a.status).toBe("TO_DO");
    expect(a.requiredFlag).toBe(true);
    expect(result.toDo).toBe(1);
    expect(result.completed).toBe(0);
  });

  it("resolves a role-wide assignment", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.status).toBe("TO_DO");
  });

  it("does NOT resolve a role-wide assignment when the user has a different role", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "ADMIN", // different role
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(0);
  });

  it("filters out users with an AssignmentExclusion row", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    await db.assignmentExclusion.create({
      data: {
        assignmentId: assignment.id,
        userId: user.id,
        reason: "On extended leave",
        excludedByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(0);
  });

  it("marks status OVERDUE when dueDate < now and no completion exists", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 7 * DAY_MS),
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.status).toBe("OVERDUE");
    expect(result.toDo).toBe(1);
  });

  it("marks status COMPLETED when a passing completion exists and is not expired", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 92,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    const a = result.assignments[0]!;
    expect(a.status).toBe("COMPLETED");
    expect(a.completionScore).toBe(92);
    expect(a.completionExpiresAt).toBeTruthy();
    expect(result.completed).toBe(1);
    expect(result.toDo).toBe(0);
  });

  it("marks status TO_DO when the latest passing completion is expired (retake required)", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 88,
        passed: true,
        completedAt: new Date(Date.now() - 400 * DAY_MS),
        expiresAt: new Date(Date.now() - 35 * DAY_MS), // expired 35 days ago
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.status).toBe("TO_DO");
    expect(result.toDo).toBe(1);
  });

  it("treats expiresAt === now as expired (TO_DO, not COMPLETED)", async () => {
    // Boundary case: a completion whose expiresAt is exactly the same
    // instant the resolver evaluates `now`. <TrainingStatusBadge> uses
    // `<=` for the same boundary ("expired · retake required"), so the
    // resolver must agree — otherwise the legacy badge and the new
    // badge would disagree on a row whose cert has just expired.
    //
    // We pin `now` with fake timers so the equality is exact, not flaky.
    const fixedNow = new Date("2026-04-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(fixedNow.getTime() - 365 * DAY_MS),
        expiresAt: fixedNow, // exactly === now
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.status).toBe("TO_DO");
    expect(result.toDo).toBe(1);
    expect(result.completed).toBe(0);
  });

  it("excludes revokedAt assignments", async () => {
    const user = await seedUser();
    const practice = await seedPractice();
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
        revokedAt: new Date(),
        revokedByUserId: user.id,
        revokedReason: "no longer applicable",
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(0);
  });

  it("scopes by practiceId — assignments from another practice are not returned", async () => {
    const user = await seedUser();
    const practice = await seedPractice("RS Mine");
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "STAFF" },
    });
    const otherPractice = await seedPractice("RS Other");
    const course = await seedCourse();
    // Same userId, but assignment is owned by a different practice. Must
    // be invisible to a query scoped to `practice`.
    await db.trainingAssignment.create({
      data: {
        practiceId: otherPractice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const result = await resolveAssignmentsForUser({
      practiceId: practice.id,
      userId: user.id,
      role: "STAFF",
    });
    expect(result.assignments).toHaveLength(0);
  });
});
