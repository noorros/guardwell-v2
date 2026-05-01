// src/lib/notifications/generators/credentialRenewal.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import { daysUntil } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

/**
 * Per-credential renewal reminders — fires CREDENTIAL_RENEWAL_DUE for
 * each milestone day (default 90/60/30/7) before expiry. Reads the
 * per-credential CredentialReminderConfig (or uses defaults if no row
 * exists). Skips credentials that are retired or have no expiry date.
 *
 * Each milestone fires exactly once per credential because the entityKey
 * embeds the milestone day; the (userId, type, entityKey) unique
 * constraint dedups across digest runs.
 */
export async function generateCredentialRenewalNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { not: null },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      holderId: true,
      reminderConfig: {
        select: { enabled: true, milestoneDays: true },
      },
    },
  });

  const proposals: NotificationProposal[] = [];
  // Per-credential reminderConfig still wins when set; per-practice
  // reminderSettings is the fallback above the global default.
  const practiceMilestones = getEffectiveLeadTimes(
    reminderSettings,
    "credentials",
  );

  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    // Default to enabled when no config exists; explicit disable opts out.
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : practiceMilestones;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue; // Already expired — CREDENTIAL_EXPIRING handles past-expiry.

    // Audit #21 Credentials IM-7: fire every milestone we're inside of
    // (days <= m), not just the one whose boundary we crossed in the last
    // 24h. Idempotent by design — the (userId, type, entityKey) unique
    // constraint dedups across digest runs, where entityKey embeds the
    // milestone day. A delayed/retried cron at any time of day still
    // produces exactly one notification per (credential, milestone).
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    for (const matchedMilestone of matchedMilestones) {
      const severity: NotificationSeverity =
        matchedMilestone <= 7
          ? "CRITICAL"
          : matchedMilestone <= 30
            ? "WARNING"
            : "INFO";
      const entityKey = `credential:${cred.id}:milestone:${matchedMilestone}`;
      const title = `${cred.title} — renewal in ${days} day${days === 1 ? "" : "s"}`;
      const body = `This credential expires ${formatPracticeDate(cred.expiryDate, practiceTimezone)}. Plan the renewal now to avoid a compliance gap.`;

      for (const uid of userIds) {
        proposals.push({
          userId: uid,
          practiceId,
          type: "CREDENTIAL_RENEWAL_DUE" as NotificationType,
          severity,
          title,
          body,
          href: `/programs/credentials/${cred.id}`,
          entityKey,
        });
      }
    }
  }
  return proposals;
}
