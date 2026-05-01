// src/lib/notifications/generators/trainingOverdueAssignment.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import {
  loadAssignmentRecipientContext,
  resolveAssignmentRecipients,
} from "./_assignmentRecipients";

/**
 * Fires for assignments past their dueDate where the user has no
 * passing-non-expired completion. EntityKey embeds a `weekIndex` =
 * floor((now - dueDate) / 7d) so we re-emit weekly: weekIndex 0 covers
 * day 1–7 post-due, weekIndex 1 covers 8–14, etc. Anchoring to dueDate
 * (not the calendar week) keeps the cadence stable across year-end and
 * regardless of which day of the week the cron runs.
 *
 * Distinct from generateTrainingOverdueNotifications above — that one is
 * keyed on TrainingCompletion id (a previously-passed cert that has
 * since expired). This one is keyed on a TrainingAssignment that the user
 * never completed in the first place. The entityKey prefixes
 * (training-completion: vs training-overdue-assignment:) keep the dedup
 * windows independent.
 */
export async function generateTrainingOverdueAssignmentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const now = new Date();
  const nowMs = now.getTime();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    if (!a.dueDate) continue;
    if (a.dueDate.getTime() >= nowMs) continue; // Not yet due — DueSoon territory.

    const msSinceDue = nowMs - a.dueDate.getTime();
    const weekIndex = Math.floor(msSinceDue / (7 * DAY_MS));
    // weekIndex 0 fires on dueDate + 1 day (exact dueDate already filtered
    // above). Subsequent weekIndex values continue weekly.

    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = formatPracticeDate(a.dueDate, practiceTimezone);
    // Clamp to 1: within the first 24h past dueDate, Math.floor produces 0,
    // which reads awkwardly ("overdue 0 days"). The assignment is overdue
    // the moment dueDate passes, so 1 is the floor of user-facing meaning.
    const daysOverdue = Math.max(1, Math.floor(msSinceDue / DAY_MS));
    const severity: NotificationSeverity =
      weekIndex >= 4 ? "CRITICAL" : "WARNING";
    const title = `${a.course.title} — overdue ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`;
    const body = `${a.course.title} was due ${dueStr} and hasn't been completed. Take it now to stay compliant.`;

    for (const uid of recipients) {
      const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
      if (pass && pass.expiresAt > now) continue;

      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_OVERDUE" as NotificationType,
        severity,
        title,
        body,
        href: `/programs/training/${a.courseId}`,
        entityKey: `training-overdue-assignment:${a.id}:${uid}:${weekIndex}`,
      });
    }
  }
  return proposals;
}
