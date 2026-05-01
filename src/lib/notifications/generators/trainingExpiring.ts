// src/lib/notifications/generators/trainingExpiring.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import { daysUntil } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

/**
 * Fires at milestones 30 / 14 / 7 days before a passing TrainingCompletion's
 * expiresAt. Recipient is the user who completed the course (not admins —
 * the affected staffer is the actor). Matches the deterministic milestone
 * semantic from generateCredentialRenewalNotifications.
 *
 * Distinct from generateTrainingOverdueNotifications (which fires AFTER
 * a completion's expiry has lapsed by 90+ days). This one is the proactive
 * pre-expiry nudge.
 */
export async function generateTrainingExpiringNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but the target is the user who
  // earned the completion.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  // Pull ALL future-expiring passing completions per (userId, courseId) so
  // the latest-wins map can see a newer roll-forward row even when its
  // expiresAt lies outside the 30-day horizon. Filtering at SQL with `lte:
  // horizon` would drop the newer row and leave the older expiring row as
  // a false "latest", incorrectly nudging users who've already renewed.
  const completions = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
    },
  });
  if (completions.length === 0) return [];

  // For each (userId, courseId), use only the LATEST passing completion.
  // A user with two passing rows for the same course has rolled forward;
  // remind on the freshest expiry, not stale ones.
  const latestByUserCourse = new Map<string, (typeof completions)[number]>();
  for (const c of completions) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = latestByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      latestByUserCourse.set(key, c);
    }
  }

  const milestones = getEffectiveLeadTimes(
    reminderSettings,
    "trainingExpiring",
  );
  const proposals: NotificationProposal[] = [];
  for (const c of latestByUserCourse.values()) {
    const days = daysUntil(c.expiresAt);
    if (days === null) continue;
    if (days < 0) continue; // Already expired — TRAINING_OVERDUE handles past-expiry.

    const matched = milestones.filter((m) => days <= m);
    if (matched.length === 0) continue;

    const courseTitle = c.course?.title ?? "Required training";
    const expiryStr = formatPracticeDate(c.expiresAt, practiceTimezone);

    for (const m of matched) {
      const severity: NotificationSeverity =
        m <= 7 ? "WARNING" : "INFO";
      const title = `${courseTitle} — expires in ${days} day${days === 1 ? "" : "s"}`;
      const body = `Your ${courseTitle} certification expires ${expiryStr}. Retake before the deadline to avoid a compliance gap.`;
      proposals.push({
        userId: c.userId,
        practiceId,
        type: "TRAINING_EXPIRING" as NotificationType,
        severity,
        title,
        body,
        href: `/programs/training/${c.courseId}`,
        entityKey: `training-expiring:${c.id}:${m}`,
      });
    }
  }
  return proposals;
}
