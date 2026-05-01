// src/lib/notifications/generators/phishingDrillDue.ts

import type { Prisma } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";
import { getIsoWeek, ownerAdminUserIds } from "./helpers";

/**
 * Phishing drill due reminder.
 *
 * Fires when no PhishingDrill exists in the last 365 days. Single severity
 * (INFO). Year-week dedup so a stale practice gets one notification per
 * week, not one per digest run.
 *
 * HIPAA Security Rule §164.308(a)(5) requires periodic security awareness
 * training, and cyber insurance carriers treat regular phishing simulation
 * as a baseline workforce-awareness control.
 */
export async function generatePhishingDrillDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const recent = await tx.phishingDrill.findFirst({
    where: { practiceId, conductedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (recent) return [];

  // Year-week dedup so a stale practice gets ONE notification per week,
  // not daily.
  const now = new Date();
  const yearWeek = `${now.getUTCFullYear()}-W${getIsoWeek(now)}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "PHISHING_DRILL_DUE",
      severity: "INFO",
      title: "Annual phishing drill is due",
      body: "HIPAA Security Rule §164.308 requires periodic security awareness training. No phishing drill has been logged in the last 365 days. Run a drill (Internal or via vendor) and log the results.",
      href: "/programs/security",
      entityKey: `phishing-drill-due:${practiceId}:${yearWeek}`,
    });
  }
  return proposals;
}
