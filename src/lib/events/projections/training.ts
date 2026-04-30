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
