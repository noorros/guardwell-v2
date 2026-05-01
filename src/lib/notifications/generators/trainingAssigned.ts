// src/lib/notifications/generators/trainingAssigned.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import {
  loadAssignmentRecipientContext,
  resolveAssignmentRecipients,
} from "./_assignmentRecipients";

// ---------------------------------------------------------------------------
// Phase 4 PR 8 — assignment-driven training notifications
// ---------------------------------------------------------------------------
//
// Four generators wired to the TrainingAssignment / TrainingCompletion
// schema added in Phase 4. They COEXIST with generateTrainingOverdueNotifications
// and generateTrainingEscalationNotifications above; entityKey prefixes are
// strictly disambiguated so dedup never collides between the completion-based
// existing generator and the assignment-based new ones.
//
//   - training-assigned:{assignmentId}:{userId}            — once per (assignment, user)
//   - training-due-soon:{assignmentId}:{userId}:{m}        — milestones 14/7/3/1 days pre-due
//   - training-overdue-assignment:{assignmentId}:{userId}:{week}
//                                                         — week-since-due index, 0+
//   - training-expiring:{completionId}:{m}                 — milestones 30/14/7 days pre-expiry
//
// Recipient resolution (assignedToUserId / assignedToRole / assignedToCategory)
// mirrors src/lib/training/resolveAssignments.ts. assignedToCategory is
// honored against PracticeUser.category once that column lands; today no
// PracticeUser carries a category, so a category-only assignment resolves
// to zero recipients (same as resolveGrid's behavior).

/**
 * Fires once per (assignment, eligible-user) — entityKey embeds both ids
 * so a re-assignment (different assignment row) starts a fresh dedup
 * window, but a digest re-run for the same assignment is a no-op.
 *
 * Skips users who already have a passing-non-expired completion for the
 * course (no point welcoming them to a course they already finished).
 */
export async function generateTrainingAssignedNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but recipients here are computed
  // per-assignment from the assignedToUserId/Role/Category resolver.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const now = new Date();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = a.dueDate
      ? `Due ${formatPracticeDate(a.dueDate, practiceTimezone)}.`
      : "No due date set.";
    const title = `New training assigned: ${a.course.title}`;
    const body = `You've been assigned ${a.course.title}. ${dueStr}`;

    for (const uid of recipients) {
      // Suppress for users who already hold an unexpired passing completion.
      const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
      if (pass && pass.expiresAt > now) continue;

      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_ASSIGNED" as NotificationType,
        severity: "INFO" as NotificationSeverity,
        title,
        body,
        href: `/programs/training/${a.courseId}`,
        entityKey: `training-assigned:${a.id}:${uid}`,
      });
    }
  }
  return proposals;
}
