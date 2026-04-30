// tests/integration/training-actions.test.ts
//
// Phase 4 PR 2 — server actions for the Training assignment + course
// CRUD layer. Each action is ADMIN-gated (createCustomCourseAction +
// the four assignment actions); each emits an event via
// appendEventAndApply and relies on the PR 1 projection to materialize
// the row. Tests pin: role gates, cross-tenant guards, idempotency, and
// the Zod refines that make exactly-one-of constraints explicit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

declare global {
  var __trainingActionsTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__trainingActionsTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__trainingActionsTestUser) throw new Error("Unauthorized");
      return globalThis.__trainingActionsTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__trainingActionsTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `ta-${Math.random().toString(36).slice(2, 10)}`,
      email: `ta-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `TA ${role} Practice`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__trainingActionsTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice };
}

async function seedCourse(opts?: {
  code?: string;
  isRequired?: boolean;
  roles?: string[];
}) {
  const code =
    opts?.code ??
    `TA_COURSE_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
      isRequired: opts?.isRequired ?? false,
      roles: opts?.roles ?? [],
    },
  });
}

describe("assignTrainingAction (Phase 4 PR 2)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    await seed("STAFF");
    const course = await seedCourse();
    const { assignTrainingAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      assignTrainingAction({
        courseId: course.id,
        assignedToRole: "STAFF",
        dueDate: null,
        requiredFlag: true,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("creates a single-user assignment as ADMIN", async () => {
    const { user, practice } = await seed("ADMIN");
    const course = await seedCourse();
    const { assignTrainingAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const result = await assignTrainingAction({
      courseId: course.id,
      assignedToUserId: user.id,
      dueDate: "2026-12-31T00:00:00.000Z",
      requiredFlag: true,
    });
    expect(result.assignmentId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: result.assignmentId },
    });
    expect(row.practiceId).toBe(practice.id);
    expect(row.courseId).toBe(course.id);
    expect(row.assignedToUserId).toBe(user.id);
    expect(row.assignedToRole).toBeNull();
    expect(row.assignedToCategory).toBeNull();
    expect(row.dueDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(row.requiredFlag).toBe(true);
    expect(row.createdByUserId).toBe(user.id);
  });

  it("rejects when both assignedToUserId and assignedToRole are set", async () => {
    const { user } = await seed("ADMIN");
    const course = await seedCourse();
    const { assignTrainingAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      assignTrainingAction({
        courseId: course.id,
        assignedToUserId: user.id,
        assignedToRole: "STAFF",
        dueDate: null,
        requiredFlag: true,
      }),
    ).rejects.toThrow(/exactly one/i);
  });

  it("rejects when assignedToUserId belongs to a different practice (cross-tenant guard)", async () => {
    await seed("ADMIN");
    // Stranger in another practice
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `ta-other-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });
    const course = await seedCourse();
    const { assignTrainingAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      assignTrainingAction({
        courseId: course.id,
        assignedToUserId: otherUser.id,
        dueDate: null,
        requiredFlag: true,
      }),
    ).rejects.toThrow(/active member|not.*practice|unauthorized/i);
  });
});

describe("revokeTrainingAssignmentAction (Phase 4 PR 2)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    const { practice, user } = await seed("STAFF");
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const { revokeTrainingAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      revokeTrainingAssignmentAction({
        assignmentId,
        reason: "no longer relevant",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("revokes the assignment as ADMIN (stamps revokedAt + reason + revokedByUserId)", async () => {
    const { practice, user } = await seed("ADMIN");
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const { revokeTrainingAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await revokeTrainingAssignmentAction({
      assignmentId,
      reason: "Course retired",
    });
    const row = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedReason).toBe("Course retired");
    expect(row.revokedByUserId).toBe(user.id);
  });

  it("rejects revoking an assignment from a different practice (cross-tenant guard)", async () => {
    const { user: callerUser } = await seed("ADMIN");
    // The caller is set up. Create an assignment owned by a different practice.
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `ta-rv-other-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-rv-other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "OWNER" },
    });
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: otherPractice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: otherUser.id,
      },
    });
    const { revokeTrainingAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      revokeTrainingAssignmentAction({
        assignmentId,
        reason: "Forged",
      }),
    ).rejects.toThrow(/different practice|not in your practice|unauthorized/i);
    // Untouched
    const row = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(row.revokedAt).toBeNull();
    expect(callerUser.id).not.toBe(otherUser.id);
  });
});

describe("excludeFromAssignmentAction (Phase 4 PR 2)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    const { practice, user } = await seed("STAFF");
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    // Target = a different staff member in the same practice
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `ta-ex-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-ex-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { excludeFromAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      excludeFromAssignmentAction({
        assignmentId,
        userId: targetUser.id,
        reason: "On medical leave",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("excludes a user as ADMIN (creates AssignmentExclusion)", async () => {
    const { practice, user } = await seed("ADMIN");
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `ta-ex-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-ex-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { excludeFromAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await excludeFromAssignmentAction({
      assignmentId,
      userId: targetUser.id,
      reason: "On medical leave",
    });
    const row = await db.assignmentExclusion.findUniqueOrThrow({
      where: {
        assignmentId_userId: { assignmentId, userId: targetUser.id },
      },
    });
    expect(row.reason).toBe("On medical leave");
    expect(row.excludedByUserId).toBe(user.id);
  });

  it("rejects when target user belongs to a different practice (cross-tenant guard)", async () => {
    const { practice, user } = await seed("ADMIN");
    const course = await seedCourse();
    const assignmentId = randomUUID();
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: user.id,
      },
    });
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `ta-ex-other-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-ex-other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });
    const { excludeFromAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      excludeFromAssignmentAction({
        assignmentId,
        userId: otherUser.id,
        reason: "Forged target",
      }),
    ).rejects.toThrow(/active member|not.*practice|unauthorized/i);
  });

  it("rejects when assignment belongs to a different practice (cross-tenant guard)", async () => {
    const { practice } = await seed("ADMIN");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `ta-ex-fa-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-ex-fa-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Foreign Practice", primaryState: "TX" },
    });
    await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "OWNER" },
    });
    const course = await seedCourse();
    const assignmentId = randomUUID();
    // Assignment owned by the OTHER practice.
    await db.trainingAssignment.create({
      data: {
        id: assignmentId,
        practiceId: otherPractice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        requiredFlag: true,
        createdByUserId: otherUser.id,
      },
    });
    // Target user in caller's practice (so the user-side guard would pass).
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `ta-ex-tu-${Math.random().toString(36).slice(2, 10)}`,
        email: `ta-ex-tu-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { excludeFromAssignmentAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      excludeFromAssignmentAction({
        assignmentId,
        userId: targetUser.id,
        reason: "Forged assignment",
      }),
    ).rejects.toThrow(/different practice|not in your practice|unauthorized/i);
  });
});

describe("autoAssignRequiredAction (Phase 4 PR 2)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    await seed("STAFF");
    await seedCourse({ isRequired: true, roles: [] });
    const { autoAssignRequiredAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(autoAssignRequiredAction()).rejects.toThrow(
      /admin|owner|requires/i,
    );
  });

  it("emits TRAINING_ASSIGNED for required courses (one per role; empty roles[] → STAFF)", async () => {
    const { practice } = await seed("ADMIN");
    // Course A: required, roles=[] → one assignment with assignedToRole="STAFF".
    const courseA = await seedCourse({ isRequired: true, roles: [] });
    // Course B: required, roles=["OWNER","ADMIN"] → 2 assignments.
    const courseB = await seedCourse({
      isRequired: true,
      roles: ["OWNER", "ADMIN"],
    });
    // Course C: NOT required → ignored entirely.
    const courseC = await seedCourse({ isRequired: false, roles: [] });
    const { autoAssignRequiredAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const result = await autoAssignRequiredAction();
    // The platform's seed catalog contains additional isRequired=true
    // courses (HIPAA_BASICS, etc.). Don't assert the exact created count;
    // assert per-course outcomes to keep the test independent of
    // whichever required courses are in the seed.
    expect(result.created).toBeGreaterThanOrEqual(3);
    expect(result.skipped).toBe(0);

    // Course A: 1 row, role=STAFF
    const a = await db.trainingAssignment.findMany({
      where: { practiceId: practice.id, courseId: courseA.id },
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.assignedToRole).toBe("STAFF");
    expect(a[0]!.requiredFlag).toBe(true);

    // Course B: 2 rows
    const b = await db.trainingAssignment.findMany({
      where: { practiceId: practice.id, courseId: courseB.id },
    });
    expect(b).toHaveLength(2);
    const bRoles = new Set(b.map((r) => r.assignedToRole));
    expect(bRoles).toEqual(new Set(["OWNER", "ADMIN"]));

    // Course C: zero rows (not required)
    const c = await db.trainingAssignment.findMany({
      where: { practiceId: practice.id, courseId: courseC.id },
    });
    expect(c).toHaveLength(0);
  });

  it("is idempotent on re-run (no duplicate rows)", async () => {
    const { practice } = await seed("ADMIN");
    const courseA = await seedCourse({ isRequired: true, roles: [] });
    const { autoAssignRequiredAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const first = await autoAssignRequiredAction();
    const firstCreated = first.created;
    expect(firstCreated).toBeGreaterThanOrEqual(1);
    const second = await autoAssignRequiredAction();
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(firstCreated);
    const rows = await db.trainingAssignment.findMany({
      where: { practiceId: practice.id, courseId: courseA.id },
    });
    expect(rows).toHaveLength(1);
  });
});

describe("createCustomCourseAction (Phase 4 PR 2)", () => {
  const validPayload = {
    code: `MY_COURSE_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: "My Custom Course",
    type: "CUSTOM",
    durationMinutes: 45,
    passingScore: 70,
    lessonContent: "## Lesson body\n\nWith markdown.",
    quizQuestions: [
      {
        question: "What's 2+2?",
        options: ["3", "4", "5", "6"],
        correctIndex: 1,
        explanation: "Basic math.",
        order: 1,
      },
      {
        question: "What's 3*3?",
        options: ["6", "8", "9", "12"],
        correctIndex: 2,
        order: 2,
      },
    ],
  };

  it("rejects STAFF callers (requires ADMIN)", async () => {
    await seed("STAFF");
    const { createCustomCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      createCustomCourseAction({
        ...validPayload,
        code: `STAFF_REJ_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("creates a custom course as ADMIN with namespaced code + quiz questions", async () => {
    const { practice } = await seed("ADMIN");
    const userCode = `MYCC_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { createCustomCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const result = await createCustomCourseAction({
      ...validPayload,
      code: userCode,
    });
    expect(result.code).toBe(`${practice.id}_${userCode}`);
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: result.courseId },
      include: { quizQuestions: { orderBy: { order: "asc" } } },
    });
    expect(row.code).toBe(`${practice.id}_${userCode}`);
    expect(row.title).toBe(validPayload.title);
    expect(row.type).toBe(validPayload.type);
    expect(row.durationMinutes).toBe(validPayload.durationMinutes);
    expect(row.passingScore).toBe(validPayload.passingScore);
    expect(row.lessonContent).toBe(validPayload.lessonContent);
    expect(row.isRequired).toBe(false);
    expect(row.version).toBe(1);
    expect(row.sortOrder).toBe(999);
    expect(row.quizQuestions).toHaveLength(2);
    expect(row.quizQuestions[0]!.question).toBe("What's 2+2?");
    expect(row.quizQuestions[0]!.correctIndex).toBe(1);
    expect(row.quizQuestions[0]!.explanation).toBe("Basic math.");
    expect(row.quizQuestions[1]!.question).toBe("What's 3*3?");
    expect(row.quizQuestions[1]!.correctIndex).toBe(2);
    expect(row.quizQuestions[1]!.explanation).toBeNull();
    // cleanup — TrainingCourse isn't in afterEach; cascade-deletes
    // quizQuestions via the schema relation onDelete: Cascade.
    await db.trainingCourse.delete({ where: { id: result.courseId } });
  });

  it("rejects when a course with the same namespaced code already exists", async () => {
    await seed("ADMIN");
    const userCode = `DUP_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { createCustomCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const first = await createCustomCourseAction({
      ...validPayload,
      code: userCode,
    });
    await expect(
      createCustomCourseAction({
        ...validPayload,
        code: userCode,
      }),
    ).rejects.toThrow(/already exists|duplicate/i);
    // cleanup
    await db.trainingCourse.delete({ where: { id: first.courseId } });
  });
});
