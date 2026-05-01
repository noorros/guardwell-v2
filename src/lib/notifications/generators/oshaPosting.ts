// src/lib/notifications/generators/oshaPosting.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal } from "./types";
import { ownerAdminUserIds } from "./helpers";

const OSHA_POSTING_WINDOW_START = { month: 0, day: 15 }; // Jan 15 (0-based)
const OSHA_POSTING_WINDOW_END = { month: 1, day: 1 }; // Feb 1 (0-based)

/**
 * OSHA 300A annual posting reminder. Pure calendar logic — emits one
 * proposal per OSHA-enabled practice when today is between Jan 15 and
 * Feb 1 (inclusive on both ends). Outside that window: no-op. EntityKey
 * is keyed on the year of the upcoming Feb 1 deadline so the reminder
 * recurs annually without dedup colliding.
 */
export async function generateOshaPostingReminderNotifications(
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
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "OSHA" },
    },
  });
  if (!enabled) return [];

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  // Inclusive window: Jan 15 through Feb 1.
  const inWindow =
    (month === OSHA_POSTING_WINDOW_START.month &&
      day >= OSHA_POSTING_WINDOW_START.day) ||
    (month === OSHA_POSTING_WINDOW_END.month &&
      day <= OSHA_POSTING_WINDOW_END.day);
  if (!inWindow) return [];

  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  // EntityKey year = year of the upcoming Feb 1 deadline. If today is
  // late January, that's the current year. If today is Feb 1 itself,
  // also the current year.
  const deadlineYear = year;
  const entityKey = `osha-posting:${deadlineYear}`;

  return adminIds.map((uid) => ({
    userId: uid,
    practiceId,
    type: "OSHA_POSTING_REMINDER" as NotificationType,
    severity: "INFO" as NotificationSeverity,
    title: "OSHA 300A posting due Feb 1",
    body: "Post the OSHA 300A summary in a visible location from Feb 1 through Apr 30. Generate it from the Reports page.",
    href: "/audit/reports",
    entityKey,
  }));
}
