// src/lib/notifications/generators/trainingDueSoon.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import { daysUntil } from "./helpers";
import {
  loadAssignmentRecipientContext,
  resolveAssignmentRecipients,
} from "./_assignmentRecipients";
import { getEffectiveLeadTimes } from "../leadTimes";

/**
 * Fires at milestones 14 / 7 / 3 / 1 days before an assignment's dueDate.
 * Matches generateCredentialRenewalNotifications' deterministic semantic
 * (audit #21 IM-7): `days <= m` — every milestone the assignment is
 * inside of fires once, dedupes on entityKey embedding the milestone day.
 *
 * Skips:
 *   - assignments with no dueDate (nothing to remind against)
 *   - already-overdue assignments (generateTrainingOverdueAssignmentNotifications handles past-due)
 *   - users with a passing-non-expired completion for the course
 */
export async function generateTrainingDueSoonNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const milestones = getEffectiveLeadTimes(reminderSettings, "training");
  const now = new Date();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    if (!a.dueDate) continue;
    const days = daysUntil(a.dueDate);
    if (days === null) continue;
    if (days <= 0) continue; // Past due — overdue generator territory.

    const matched = milestones.filter((m) => days <= m);
    if (matched.length === 0) continue;

    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = formatPracticeDate(a.dueDate, practiceTimezone);

    for (const m of matched) {
      const severity: NotificationSeverity =
        m <= 3 ? "WARNING" : "INFO";
      const title = `${a.course.title} — due in ${days} day${days === 1 ? "" : "s"}`;
      const body = `${a.course.title} is due ${dueStr}. Complete it before the deadline.`;

      for (const uid of recipients) {
        const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
        if (pass && pass.expiresAt > now) continue;

        proposals.push({
          userId: uid,
          practiceId,
          type: "TRAINING_DUE_SOON" as NotificationType,
          severity,
          title,
          body,
          href: `/programs/training/${a.courseId}`,
          entityKey: `training-due-soon:${a.id}:${uid}:${m}`,
        });
      }
    }
  }
  return proposals;
}
