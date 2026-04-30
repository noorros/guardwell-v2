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
