// src/lib/notifications/generators/backupVerificationOverdue.ts

import type { Prisma } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";
import { getIsoWeek, ownerAdminUserIds } from "./helpers";

/**
 * Backup verification overdue reminder.
 *
 * Fires when no SUCCESSFUL BackupVerification exists in the last 90 days.
 * The HHS Ransomware Fact Sheet treats untested backups as effectively
 * no backups. Failed restore tests don't reset the clock — only success.
 * Year-week dedup so a stale practice gets one nudge per week.
 */
export async function generateBackupVerificationOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 90 * DAY_MS);
  const recent = await tx.backupVerification.findFirst({
    where: { practiceId, success: true, verifiedAt: { gte: cutoff } },
    select: { id: true, verifiedAt: true },
  });
  if (recent) return [];

  // Year-week dedup.
  const now = new Date();
  const yearWeek = `${now.getUTCFullYear()}-W${getIsoWeek(now)}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "BACKUP_VERIFICATION_OVERDUE",
      severity: "WARNING",
      title: "Backup restore test is overdue",
      body: "HIPAA Security Rule §164.308(a)(7)(ii)(D) requires periodic testing of backup restores. No successful restore test has been logged in the last 90 days. Run a test restore and log the result.",
      href: "/programs/security",
      entityKey: `backup-overdue:${practiceId}:${yearWeek}`,
    });
  }
  return proposals;
}
