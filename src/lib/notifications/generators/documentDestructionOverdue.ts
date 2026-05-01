// src/lib/notifications/generators/documentDestructionOverdue.ts

import type { Prisma } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";
import { ownerAdminUserIds } from "./helpers";

/**
 * Document destruction overdue reminder.
 *
 * Fires when no DestructionLog has been recorded in the last 12 months.
 * Phase 10 will eventually surface state-retention rules to drive this
 * more precisely; for now, the absence of any destruction logs is the
 * signal — practices should be running routine destruction (medical
 * records, billing, HR).
 *
 * Quarterly dedup (year-quarter) so practices that haven't run destruction
 * in years still get ONE quarterly nudge, not weekly.
 *
 * Known false-positive: a brand-new practice with no records to destroy
 * yet will still trigger this after 12 months. V1-acceptable.
 */
export async function generateDocumentDestructionOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const recent = await tx.destructionLog.findFirst({
    where: { practiceId, destroyedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (recent) return [];

  // Quarterly dedup (year-quarter).
  const now = new Date();
  const yearQuarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "DOCUMENT_DESTRUCTION_OVERDUE",
      severity: "INFO",
      title: "Document destruction has not been logged recently",
      body: "Routine document destruction (medical records, billing, HR) is required by state retention rules. No destruction log has been recorded in the last 12 months. Log any destruction events you've completed, or schedule a destruction run.",
      href: "/programs/document-retention",
      entityKey: `doc-destruction-overdue:${practiceId}:${yearQuarter}`,
    });
  }
  return proposals;
}
