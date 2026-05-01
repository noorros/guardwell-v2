// src/lib/notifications/generators/policyReviewDue.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { daysUntil, ownerAdminUserIds } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

const POLICY_REVIEW_OBLIGATION_DAYS = 365;

/**
 * Annual policy-review reminder. Fires at 90/60/30 days before
 * `lastReviewedAt + 365`. Skipped when already past due (POLICY_STALE
 * handles overdue separately, deferred). Recipients are owners + admins.
 */
export async function generatePolicyReviewDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds (digest recipient pool) is intentionally ignored — these
  // generators compute their own owner/admin recipient list. Kept for
  // signature consistency with the rest of the generators.
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const policies = await tx.practicePolicy.findMany({
    where: {
      practiceId,
      retiredAt: null,
      lastReviewedAt: { not: null },
    },
    select: {
      id: true,
      policyCode: true,
      lastReviewedAt: true,
    },
  });

  const milestones = getEffectiveLeadTimes(reminderSettings, "policyReview");

  const proposals: NotificationProposal[] = [];
  for (const p of policies) {
    if (!p.lastReviewedAt) continue;
    const dueDate = new Date(
      p.lastReviewedAt.getTime() + POLICY_REVIEW_OBLIGATION_DAYS * DAY_MS,
    );
    const days = daysUntil(dueDate);
    if (days === null) continue;
    if (days < 0) continue; // Already overdue — POLICY_STALE territory.

    // Same milestone-cross logic as the credential renewal generator: fire
    // exactly the day a milestone threshold is crossed.
    const matched = milestones.find(
      (m) => days <= m && days > m - 1,
    );
    if (matched === undefined) continue;

    const reviewedDate = formatPracticeDate(p.lastReviewedAt, practiceTimezone);
    const dueStr = formatPracticeDate(dueDate, practiceTimezone);
    const title = `Annual review due in ${days} day${days === 1 ? "" : "s"}: ${p.policyCode}`;
    const body = `${p.policyCode} was last reviewed ${reviewedDate}. Annual review is required by ${dueStr}.`;
    const entityKey = `policy:${p.id}:milestone:${matched}`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "POLICY_REVIEW_DUE" as NotificationType,
        severity: "INFO" as NotificationSeverity,
        title,
        body,
        href: `/policies/${p.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}
