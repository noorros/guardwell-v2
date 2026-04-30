// src/app/(dashboard)/programs/training/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser, requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectTrainingCompleted } from "@/lib/events/projections/trainingCompleted";
import {
  projectTrainingAssigned,
  projectTrainingAssignmentRevoked,
  projectStaffExcludedFromAssignment,
  projectTrainingCourseCreated,
} from "@/lib/events/projections/training";
import { db } from "@/lib/db";

const Input = z.object({
  courseId: z.string().min(1),
  answers: z.array(z.number().int().min(0)),
});

export interface QuizResult {
  score: number;      // 0–100
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passingScore: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function submitQuizAction(
  input: z.infer<typeof Input>,
): Promise<QuizResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  const course = await db.trainingCourse.findUnique({
    where: { id: parsed.courseId },
    include: { quizQuestions: { orderBy: { order: "asc" } } },
  });
  if (!course) throw new Error("Course not found");
  if (parsed.answers.length !== course.quizQuestions.length) {
    throw new Error(
      `Expected ${course.quizQuestions.length} answers, got ${parsed.answers.length}`,
    );
  }

  const correctCount = course.quizQuestions.reduce((acc, q, i) => {
    return acc + (parsed.answers[i] === q.correctIndex ? 1 : 0);
  }, 0);
  const totalCount = course.quizQuestions.length;
  const score = Math.round((correctCount / totalCount) * 100);
  const passed = score >= course.passingScore;

  const trainingCompletionId = randomUUID();
  const expiresAt = new Date(Date.now() + 365 * DAY_MS);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRAINING_COMPLETED",
      payload: {
        trainingCompletionId,
        userId: user.id,
        courseId: course.id,
        courseCode: course.code,
        courseVersion: course.version,
        score,
        passed,
        expiresAt: expiresAt.toISOString(),
      },
    },
    async (tx) =>
      projectTrainingCompleted(tx, {
        practiceId: pu.practiceId,
        payload: {
          trainingCompletionId,
          userId: user.id,
          courseId: course.id,
          courseCode: course.code,
          courseVersion: course.version,
          score,
          passed,
          expiresAt: expiresAt.toISOString(),
        },
      }),
  );

  revalidatePath("/programs/training");
  revalidatePath(`/programs/training/${course.id}`);
  revalidatePath("/modules/hipaa");

  return {
    score,
    passed,
    correctCount,
    totalCount,
    passingScore: course.passingScore,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 PR 2 — assignment + course-CRUD actions
// ────────────────────────────────────────────────────────────────────────────

const AssignInput = z
  .object({
    courseId: z.string().min(1),
    assignedToUserId: z.string().min(1).nullable().optional(),
    assignedToRole: z
      .enum(["OWNER", "ADMIN", "STAFF", "VIEWER"])
      .nullable()
      .optional(),
    assignedToCategory: z
      .enum(["CLINICAL", "ADMINISTRATIVE", "MANAGEMENT", "OTHER"])
      .nullable()
      .optional(),
    dueDate: z.string().datetime().nullable().optional(),
    requiredFlag: z.boolean(),
  })
  .refine(
    (p) => {
      const set = [
        p.assignedToUserId,
        p.assignedToRole,
        p.assignedToCategory,
      ].filter((v) => v !== null && v !== undefined);
      return set.length === 1;
    },
    {
      message:
        "Exactly one of assignedToUserId / assignedToRole / assignedToCategory must be set",
    },
  );

/**
 * ADMIN-gated. Issues a training-assignment directive — exactly one of
 * assignedToUserId / assignedToRole / assignedToCategory must be set.
 * Cross-tenant guard: if a single-user assignment is requested, the
 * target userId must be an active PracticeUser of the caller's practice.
 */
export async function assignTrainingAction(input: z.infer<typeof AssignInput>) {
  const pu = await requireRole("ADMIN");
  const parsed = AssignInput.parse(input);

  const course = await db.trainingCourse.findUnique({
    where: { id: parsed.courseId },
  });
  if (!course) throw new Error("Course not found");

  if (parsed.assignedToUserId) {
    const member = await db.practiceUser.findFirst({
      where: {
        userId: parsed.assignedToUserId,
        practiceId: pu.practiceId,
        removedAt: null,
      },
    });
    if (!member) {
      throw new Error(
        "Unauthorized: target user is not an active member of your practice",
      );
    }
  }

  const assignmentId = randomUUID();
  const payload = {
    assignmentId,
    courseId: parsed.courseId,
    assignedToUserId: parsed.assignedToUserId ?? null,
    assignedToRole: parsed.assignedToRole ?? null,
    assignedToCategory: parsed.assignedToCategory ?? null,
    dueDate: parsed.dueDate ?? null,
    requiredFlag: parsed.requiredFlag,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "TRAINING_ASSIGNED",
      payload,
    },
    async (tx) =>
      projectTrainingAssigned(tx, {
        practiceId: pu.practiceId,
        actorUserId: pu.dbUser.id,
        payload,
      }),
  );

  revalidatePath("/programs/training");
  revalidatePath("/programs/training/assignments");
  return { assignmentId };
}

const RevokeInput = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().max(500).nullable(),
});

/**
 * ADMIN-gated. Soft-revokes a training assignment. Cross-tenant guard:
 * the assignment must belong to the caller's practice. The PR 1
 * projection ALSO has its own guard (assertProjectionPracticeOwned) —
 * defense in depth means both checks stay.
 */
export async function revokeTrainingAssignmentAction(
  input: z.infer<typeof RevokeInput>,
) {
  const pu = await requireRole("ADMIN");
  const parsed = RevokeInput.parse(input);

  const assignment = await db.trainingAssignment.findUnique({
    where: { id: parsed.assignmentId },
    select: { practiceId: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.practiceId !== pu.practiceId) {
    throw new Error(
      "Unauthorized: assignment is not in your practice",
    );
  }

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "TRAINING_ASSIGNMENT_REVOKED",
      payload: {
        assignmentId: parsed.assignmentId,
        reason: parsed.reason,
      },
    },
    async (tx) =>
      projectTrainingAssignmentRevoked(tx, {
        practiceId: pu.practiceId,
        actorUserId: pu.dbUser.id,
        payload: {
          assignmentId: parsed.assignmentId,
          reason: parsed.reason,
        },
      }),
  );

  revalidatePath("/programs/training");
  revalidatePath("/programs/training/assignments");
  return { assignmentId: parsed.assignmentId };
}

const ExcludeInput = z.object({
  assignmentId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

/**
 * ADMIN-gated. Excludes a specific user from a role/category-wide
 * assignment. Cross-tenant guards on BOTH:
 *   1. assignmentId — must belong to the caller's practice.
 *   2. userId — must be an active PracticeUser of the caller's practice.
 * Both checks happen at the action layer; the projection ALSO checks
 * the assignment's practiceId (defense in depth).
 */
export async function excludeFromAssignmentAction(
  input: z.infer<typeof ExcludeInput>,
) {
  const pu = await requireRole("ADMIN");
  const parsed = ExcludeInput.parse(input);

  const assignment = await db.trainingAssignment.findUnique({
    where: { id: parsed.assignmentId },
    select: { practiceId: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.practiceId !== pu.practiceId) {
    throw new Error("Unauthorized: assignment is not in your practice");
  }

  const member = await db.practiceUser.findFirst({
    where: {
      userId: parsed.userId,
      practiceId: pu.practiceId,
      removedAt: null,
    },
  });
  if (!member) {
    throw new Error(
      "Unauthorized: target user is not an active member of your practice",
    );
  }

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "STAFF_EXCLUDED_FROM_ASSIGNMENT",
      payload: {
        assignmentId: parsed.assignmentId,
        userId: parsed.userId,
        reason: parsed.reason,
      },
    },
    async (tx) =>
      projectStaffExcludedFromAssignment(tx, {
        practiceId: pu.practiceId,
        actorUserId: pu.dbUser.id,
        payload: {
          assignmentId: parsed.assignmentId,
          userId: parsed.userId,
          reason: parsed.reason,
        },
      }),
  );

  revalidatePath("/programs/training");
  revalidatePath("/programs/training/assignments");
  return { assignmentId: parsed.assignmentId, userId: parsed.userId };
}
