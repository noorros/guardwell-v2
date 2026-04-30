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
  // Duplicates registry refine to fail-fast before DB lookup at registry.ts:1586.
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

const ROLE_VALUES = ["OWNER", "ADMIN", "STAFF", "VIEWER"] as const;
type RoleValue = (typeof ROLE_VALUES)[number];

/**
 * ADMIN-gated. Sweeps every isRequired=true TrainingCourse and emits a
 * TRAINING_ASSIGNED event for each (course, role) tuple that does NOT
 * already have an active (non-revoked) assignment in the caller's
 * practice.
 *
 * Empty `course.roles[]` is treated as "applies to STAFF" — emits ONE
 * assignment with assignedToRole="STAFF". Practices that want it pinned
 * to all four roles should populate `course.roles` explicitly via the
 * course catalog.
 *
 * Returns { created, skipped } for the UI's "swept N, X new, Y already
 * present" toast.
 */
export async function autoAssignRequiredAction() {
  const pu = await requireRole("ADMIN");

  const courses = await db.trainingCourse.findMany({
    where: { isRequired: true },
    select: { id: true, roles: true },
  });

  let created = 0;
  let skipped = 0;

  for (const course of courses) {
    const targetRoles: RoleValue[] =
      course.roles.length === 0
        ? ["STAFF"]
        : (course.roles.filter((r): r is RoleValue =>
            (ROLE_VALUES as readonly string[]).includes(r),
          ) as RoleValue[]);

    for (const role of targetRoles) {
      const existing = await db.trainingAssignment.findFirst({
        where: {
          practiceId: pu.practiceId,
          courseId: course.id,
          assignedToRole: role,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const assignmentId = randomUUID();
      const payload = {
        assignmentId,
        courseId: course.id,
        assignedToUserId: null,
        assignedToRole: role,
        assignedToCategory: null,
        dueDate: null,
        requiredFlag: true,
      };

      // idempotencyKey closes a TOCTOU window: if two admin invocations
      // run concurrently, both can see "no existing row" above and both
      // would otherwise emit. With this key, appendEventAndApply
      // (src/lib/events/append.ts:43-48) short-circuits the second emit
      // and returns the first event without writing again. The "find
      // existing → skip" check above stays for the skipped-count return.
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: pu.dbUser.id,
          type: "TRAINING_ASSIGNED",
          payload,
          idempotencyKey: `auto-assign:${pu.practiceId}:${course.id}:${role}`,
        },
        async (tx) =>
          projectTrainingAssigned(tx, {
            practiceId: pu.practiceId,
            actorUserId: pu.dbUser.id,
            payload,
          }),
      );
      created += 1;
    }
  }

  revalidatePath("/programs/training");
  revalidatePath("/programs/training/assignments");
  return { created, skipped };
}

const QuizQuestionInput = z.object({
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).min(2).max(10),
  correctIndex: z.number().int().min(0),
  explanation: z.string().max(2000).nullable().optional(),
  order: z.number().int().min(1),
});

const CreateCustomCourseInput = z.object({
  // User-provided code, namespaced as `${practiceId}_${code}` to avoid
  // colliding with system codes (HIPAA_BASICS etc.). Capped at 30 to
  // leave room for the cuid practice prefix (~25) under the registry's
  // 60-char ceiling.
  code: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9_]+$/, "code must be uppercase letters, digits, underscore"),
  title: z.string().min(1).max(200),
  type: z.string().min(1).max(40),
  durationMinutes: z.number().int().min(0).max(600).nullable(),
  passingScore: z.number().int().min(0).max(100),
  lessonContent: z.string().max(50_000),
  quizQuestions: z.array(QuizQuestionInput).max(50),
});

/**
 * ADMIN-gated. Creates a practice-namespaced custom training course.
 * The user-provided code is stored as `${practiceId}_${code}` so two
 * practices can independently author "MY_COURSE" without collision and
 * neither can clobber a system code (HIPAA_BASICS etc.).
 *
 * Emits TRAINING_COURSE_CREATED carrying lessonContent verbatim (Phase 4
 * PR 2 prep extended the registry payload). The projection callback
 * writes the TrainingCourse row AND the QuizQuestion rows in the SAME
 * transaction — atomic-or-nothing. QuizQuestion isn't a projection
 * table per the lint allowlist (eslint-rules/no-direct-projection-mutation.js)
 * so direct tx.quizQuestion.createMany inside the callback is allowed.
 *
 * Returns { courseId, code: namespacedCode }.
 */
export async function createCustomCourseAction(
  input: z.infer<typeof CreateCustomCourseInput>,
) {
  const pu = await requireRole("ADMIN");
  const parsed = CreateCustomCourseInput.parse(input);

  const namespacedCode = `${pu.practiceId}_${parsed.code}`;

  const existing = await db.trainingCourse.findUnique({
    where: { code: namespacedCode },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      `A custom course with code "${parsed.code}" already exists in your practice`,
    );
  }

  // Validate correctIndex < options.length per question + uniqueness of
  // `order`. The registry's per-question Zod can't see the options array
  // length cross-field, so we do that here.
  const orders = new Set<number>();
  for (const q of parsed.quizQuestions) {
    if (q.correctIndex >= q.options.length) {
      throw new Error(
        `Question "${q.question}": correctIndex ${q.correctIndex} is out of range for ${q.options.length} options`,
      );
    }
    if (orders.has(q.order)) {
      throw new Error(
        `Duplicate question order ${q.order} — every question must have a unique order`,
      );
    }
    orders.add(q.order);
  }

  const courseId = randomUUID();
  const payload = {
    courseId,
    code: namespacedCode,
    title: parsed.title,
    type: parsed.type,
    durationMinutes: parsed.durationMinutes,
    passingScore: parsed.passingScore,
    lessonContent: parsed.lessonContent,
    isCustom: true,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "TRAINING_COURSE_CREATED",
      payload,
    },
    async (tx) => {
      await projectTrainingCourseCreated(tx, {
        practiceId: pu.practiceId,
        actorUserId: pu.dbUser.id,
        payload,
      });
      // QuizQuestion rows: NOT a projection table — direct write inside
      // the projection callback is allowed and lands in the SAME
      // transaction as the course row. If the createMany throws, the
      // surrounding $transaction rolls back the course insert too —
      // closes a partial-failure window where a quiz insert error left
      // the course row stranded without questions.
      if (parsed.quizQuestions.length > 0) {
        await tx.quizQuestion.createMany({
          data: parsed.quizQuestions.map((q) => ({
            courseId,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation ?? null,
            order: q.order,
          })),
        });
      }
    },
  );

  revalidatePath("/programs/training");
  return { courseId, code: namespacedCode };
}
