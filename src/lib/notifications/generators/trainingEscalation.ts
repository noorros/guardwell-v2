// src/lib/notifications/generators/trainingEscalation.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";
import { ownerAdminUserIds } from "./helpers";

// ---------------------------------------------------------------------------
// Phase B — notification-scan escalation generators (chunk 8 launch readiness)
// ---------------------------------------------------------------------------
//
// New "scan-then-cross-check" pattern:
//
// Every other generator in this file scans a domain table (Credential,
// PracticePolicy, Incident, …) for "needs an alert" rows. The two
// escalation generators below scan the `Notification` table itself for
// rows that meet the "old + still unread" criteria, then cross-check the
// underlying domain record to confirm the original concern is still
// actionable (e.g. the credential hasn't been renewed, the training
// hasn't been retaken). When both conditions hold, they emit a manager-
// targeted escalation.
//
// EntityKey convention: keyed on the SOURCE DOMAIN RECORD
// (`training-escalation:{completionId}`, `credential-escalation:{credentialId}`),
// NOT on the source notification's id. This keeps dedup sane — one
// escalation per overdue thing, not one per overdue notification — and
// survives the case where multiple TRAINING_OVERDUE rows exist for the
// same completion across digest runs.

const ESCALATION_THRESHOLD_DAYS = 14;

/**
 * Staff hasn't completed overdue training after 14 days → escalate to
 * managers. Source: TRAINING_OVERDUE notifications older than 14 days
 * that the staff member hasn't read. Cross-check: the underlying
 * TrainingCompletion still has no newer passing completion (same
 * supersede logic as generateTrainingOverdueNotifications). EntityKey is
 * `training-escalation:{completionId}` — keyed on the completion, not
 * the source notification, so a single overdue completion produces one
 * escalation regardless of how many source TRAINING_OVERDUE rows exist.
 */
export async function generateTrainingEscalationNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency. See generateAllergyNotifications comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_DAYS * DAY_MS);

  // Source query: stale unread TRAINING_OVERDUE notifications.
  const stale = await tx.notification.findMany({
    where: {
      practiceId,
      type: "TRAINING_OVERDUE",
      createdAt: { lt: cutoff },
      readAt: null,
    },
    select: { id: true, entityKey: true },
  });
  if (stale.length === 0) return [];

  // EntityKey from generateTrainingOverdueNotifications is
  // `training-completion:{completionId}` — extract the completion id.
  // Dedup on completionId here so a single overdue completion produces
  // exactly one escalation even if multiple TRAINING_OVERDUE rows
  // happen to share it across users.
  const completionIds = new Set<string>();
  for (const n of stale) {
    if (!n.entityKey) continue;
    const prefix = "training-completion:";
    if (!n.entityKey.startsWith(prefix)) continue;
    completionIds.add(n.entityKey.slice(prefix.length));
  }
  if (completionIds.size === 0) return [];

  const completions = await tx.trainingCompletion.findMany({
    where: {
      id: { in: Array.from(completionIds) },
      practiceId,
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
      practice: { select: { id: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  // Hoisted single fetch of ALL passing completions for this practice,
  // grouped by (userId, courseId). Avoids an N+1 round-trip per stale
  // notification when checking for a superseding retake.
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
  for (const c of completions) {
    // Cross-check: still no newer passing completion (otherwise the
    // original TRAINING_OVERDUE is moot and so is its escalation). Same
    // supersede semantics as generateTrainingOverdueNotifications — a
    // retake counts only if both completedAt is recent AND expiresAt
    // pushed validity forward.
    const candidates = passesByUserCourse.get(`${c.userId}:${c.courseId}`) ?? [];
    const completedAtCutoff = new Date(c.expiresAt.getTime() - 365 * DAY_MS);
    const newerPass = candidates.find(
      (p) =>
        p.id !== c.id &&
        p.completedAt > completedAtCutoff &&
        p.expiresAt > c.expiresAt,
    );
    if (newerPass) continue;

    // Staff display name comes from the `user` include (avoids per-row findUnique).
    const staffName =
      `${c.user?.firstName ?? ""} ${c.user?.lastName ?? ""}`.trim() ||
      c.user?.email ||
      "A staff member";
    const courseTitle = c.course?.title ?? "Required training";
    const entityKey = `training-escalation:${c.id}`;
    const title = `Staff training overdue: ${staffName} — ${courseTitle}`;
    const body = `${staffName} has had overdue training for ${ESCALATION_THRESHOLD_DAYS}+ days with no completion. Follow up directly.`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_ESCALATION" as NotificationType,
        severity: "WARNING" as NotificationSeverity,
        title,
        body,
        href: `/training/staff/${c.userId}`,
        entityKey,
      });
    }
  }
  return proposals;
}
