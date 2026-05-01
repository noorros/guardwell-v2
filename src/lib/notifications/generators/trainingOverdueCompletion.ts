// src/lib/notifications/generators/trainingOverdueCompletion.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";

const TRAINING_OVERDUE_GRACE_DAYS = 90;

/**
 * Staff missed training renewal — 90 days past expiry. Fires a
 * notification to the staff member themselves (not admins). Suppressed
 * when a newer passing completion exists for the same (userId, courseId).
 */
export async function generateTrainingOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets the
  // staff member who took the training instead. Kept for signature parity.
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const cutoff = new Date(Date.now() - TRAINING_OVERDUE_GRACE_DAYS * DAY_MS);
  const overdueCompletions = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { lt: cutoff },
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
    },
  });
  if (overdueCompletions.length === 0) return [];

  // Dedup by (userId, courseId) — keep only the newest overdue completion
  // per pair, then suppress if a newer passing completion exists.
  const newestByUserCourse = new Map<string, (typeof overdueCompletions)[number]>();
  for (const c of overdueCompletions) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = newestByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      newestByUserCourse.set(key, c);
    }
  }

  // Hoisted single fetch of ALL passing completions for this practice,
  // grouped by (userId, courseId). Avoids an N+1 round-trip per overdue
  // record when checking for a superseding retake.
  const allPasses = await tx.trainingCompletion.findMany({
    where: { practiceId, passed: true },
    select: {
      id: true,
      userId: true,
      courseId: true,
      completedAt: true,
      expiresAt: true,
    },
  });
  const passesByUserCourse = new Map<string, typeof allPasses>();
  for (const p of allPasses) {
    const key = `${p.userId}:${p.courseId}`;
    const list = passesByUserCourse.get(key);
    if (list) {
      list.push(p);
    } else {
      passesByUserCourse.set(key, [p]);
    }
  }

  const proposals: NotificationProposal[] = [];
  for (const c of newestByUserCourse.values()) {
    // A retake that genuinely renewed the training supersedes the overdue
    // notification. We require BOTH:
    //   - completedAt > c.expiresAt - 365d (the retake is recent enough)
    //   - expiresAt > c.expiresAt (the retake actually pushed validity forward)
    // This avoids treating a retake-with-shorter-validity as a renewal when
    // the new expiry is still in the past.
    const candidates = passesByUserCourse.get(`${c.userId}:${c.courseId}`) ?? [];
    const completedAtCutoff = new Date(c.expiresAt.getTime() - 365 * DAY_MS);
    const newerPass = candidates.find(
      (p) =>
        p.id !== c.id &&
        p.completedAt > completedAtCutoff &&
        p.expiresAt > c.expiresAt,
    );
    if (newerPass) continue;

    const expiredOn = formatPracticeDate(c.expiresAt, practiceTimezone);
    const courseTitle = c.course?.title ?? "Required training";
    proposals.push({
      userId: c.userId,
      practiceId,
      type: "TRAINING_OVERDUE" as NotificationType,
      severity: "INFO" as NotificationSeverity,
      title: `Training overdue: ${courseTitle}`,
      body: `Your ${courseTitle} training expired on ${expiredOn} and has been overdue for ${TRAINING_OVERDUE_GRACE_DAYS} days. Retake to stay compliant.`,
      href: `/training/${c.courseId}`,
      entityKey: `training-completion:${c.id}`,
    });
  }
  return proposals;
}
