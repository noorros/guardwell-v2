// src/lib/events/projections/training.ts
//
// Projects the 6 training events introduced in Phase 4 PR 1 into the
// TrainingAssignment / AssignmentExclusion / TrainingCourse tables.
// Pure data plane — no auth checks (those happen at the action layer
// before this projection runs).
//
// All projections are idempotent: re-applying the same event (event-bus
// retry, manual replay, projection backfill) is a no-op via .upsert
// or no-op-on-already-set patterns. Mirrors the conciergeThread.ts
// projection style for consistency across the events module.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Tx = Prisma.TransactionClient;

interface Args<T> {
  practiceId: string;
  actorUserId: string;
  payload: T;
}

/**
 * Materialize a TrainingAssignment row from a TRAINING_ASSIGNED event.
 * Idempotent — re-applies safely on replay (upsert with empty update).
 */
export async function projectTrainingAssigned(
  tx: Tx,
  args: Args<PayloadFor<"TRAINING_ASSIGNED", 1>>,
): Promise<void> {
  const { practiceId, actorUserId, payload } = args;
  await tx.trainingAssignment.upsert({
    where: { id: payload.assignmentId },
    update: {},
    create: {
      id: payload.assignmentId,
      practiceId,
      courseId: payload.courseId,
      assignedToUserId: payload.assignedToUserId,
      assignedToRole: payload.assignedToRole,
      assignedToCategory: payload.assignedToCategory,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      requiredFlag: payload.requiredFlag,
      createdByUserId: actorUserId,
    },
  });
}

/**
 * Soft-revoke an assignment by stamping revokedAt + reason +
 * revokedByUserId. The original row is preserved so the audit trail
 * can answer "what was the assignment for this user before revocation."
 */
export async function projectTrainingAssignmentRevoked(
  tx: Tx,
  args: Args<PayloadFor<"TRAINING_ASSIGNMENT_REVOKED", 1>>,
): Promise<void> {
  const { actorUserId, payload } = args;
  await tx.trainingAssignment.update({
    where: { id: payload.assignmentId },
    data: {
      revokedAt: new Date(),
      revokedReason: payload.reason,
      revokedByUserId: actorUserId,
    },
  });
}

/**
 * Per-user opt-out from a role/category-wide assignment. Idempotent on
 * replay via the (assignmentId, userId) compound unique — the second
 * call updates `reason` to the latest event's value, which is the
 * intended behavior if an admin revises their justification.
 */
export async function projectStaffExcludedFromAssignment(
  tx: Tx,
  args: Args<PayloadFor<"STAFF_EXCLUDED_FROM_ASSIGNMENT", 1>>,
): Promise<void> {
  const { actorUserId, payload } = args;
  await tx.assignmentExclusion.upsert({
    where: {
      assignmentId_userId: {
        assignmentId: payload.assignmentId,
        userId: payload.userId,
      },
    },
    update: { reason: payload.reason },
    create: {
      assignmentId: payload.assignmentId,
      userId: payload.userId,
      reason: payload.reason,
      excludedByUserId: actorUserId,
    },
  });
}

/**
 * Materialize a custom-authored TrainingCourse row. The projection
 * authors customer-supplied defaults: lessonContent="", isRequired=false,
 * version=1, sortOrder=999. Subsequent edits flow through
 * projectTrainingCourseUpdated which bumps version monotonically.
 *
 * Idempotent — re-applies safely on replay (upsert with empty update).
 *
 * Note: TrainingCourse is intentionally NOT in the lint rule's
 * PROJECTION_TABLES set — it's reference data also written by
 * scripts/seed-training.ts. Adding it would break the seed.
 */
export async function projectTrainingCourseCreated(
  tx: Tx,
  args: Args<PayloadFor<"TRAINING_COURSE_CREATED", 1>>,
): Promise<void> {
  const { payload } = args;
  await tx.trainingCourse.upsert({
    where: { id: payload.courseId },
    update: {},
    create: {
      id: payload.courseId,
      code: payload.code,
      title: payload.title,
      type: payload.type,
      lessonContent: "",
      durationMinutes: payload.durationMinutes,
      passingScore: payload.passingScore,
      isRequired: false,
      version: 1,
      sortOrder: 999,
    },
  });
}

/**
 * Bump the TrainingCourse version after a content/title/duration edit.
 * The actual mutated columns are not projected here because the action
 * layer mutates the working draft separately — this projection is the
 * audit-trail anchor that says "version N landed at time T."
 */
export async function projectTrainingCourseUpdated(
  tx: Tx,
  args: Args<PayloadFor<"TRAINING_COURSE_UPDATED", 1>>,
): Promise<void> {
  const { payload } = args;
  await tx.trainingCourse.update({
    where: { id: payload.courseId },
    data: { version: payload.version },
  });
}

/**
 * Soft-retire a TrainingCourse. The model has no retiredAt column today;
 * sortOrder=9999 is the soft-retire signal until a follow-up schema
 * migration adds the column. Read-paths filter by (sortOrder < 9999)
 * to hide retired courses from default lists.
 */
export async function projectTrainingCourseRetired(
  tx: Tx,
  args: Args<PayloadFor<"TRAINING_COURSE_RETIRED", 1>>,
): Promise<void> {
  const { payload } = args;
  await tx.trainingCourse.update({
    where: { id: payload.courseId },
    data: { sortOrder: 9999 },
  });
}
