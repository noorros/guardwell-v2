// src/lib/notifications/generators/baaExpiring.ts

import type { Prisma, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { daysUntil, ownerAdminUserIds } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

/**
 * BAAs approaching expiry. Uses getEffectiveLeadTimes(reminderSettings,
 * "baa") for milestones (default [60, 30, 7]). Fires every crossed
 * milestone (matches generateCredentialRenewalNotifications semantic):
 * a vendor expiring in 5 days fires :7, :30, AND :60 — each a distinct
 * notification keyed by milestone, so dedup catches re-fires across
 * cron runs but every milestone gets a fresh nudge.
 *
 * Sources expiry from Vendor.baaExpiresAt (the canonical "BAA expires"
 * field on the vendor), not BaaRequest.expiresAt.
 */
export async function generateBaaExpiringNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const milestones = getEffectiveLeadTimes(reminderSettings, "baa");
  const horizonDays = milestones[0] ?? 60;
  const horizon = new Date(Date.now() + horizonDays * DAY_MS);
  const vendors = await tx.vendor.findMany({
    where: {
      practiceId,
      retiredAt: null,
      processesPhi: true,
      baaExpiresAt: { lte: horizon },
    },
    select: { id: true, name: true, baaExpiresAt: true },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const v of vendors) {
    if (!v.baaExpiresAt) continue;
    const days = daysUntil(v.baaExpiresAt);
    if (days === null) continue;
    // Match generateCredentialRenewalNotifications: fire every milestone
    // we're inside of (days <= m), one notification per (vendor, milestone)
    // with a distinct entityKey. The (userId, type, entityKey) unique
    // constraint dedups across digest runs.
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    for (const m of matchedMilestones) {
      const severity: NotificationSeverity =
        days <= 0 ? "CRITICAL" : m <= 7 ? "WARNING" : "INFO";
      const title =
        days <= 0
          ? `BAA with ${v.name} has expired`
          : `BAA with ${v.name} expires in ${days} day${days === 1 ? "" : "s"}`;
      const body = `The Business Associate Agreement with ${v.name} expires ${formatPracticeDate(v.baaExpiresAt, practiceTimezone)}. Renew before expiry to keep HIPAA_BAAS compliant.`;
      for (const userId of adminUserIds) {
        proposals.push({
          userId,
          practiceId,
          type: "VENDOR_BAA_EXPIRING",
          severity,
          title,
          body,
          href: "/programs/vendors",
          entityKey: `baa-expiring:${v.id}:${m}`,
        });
      }
    }
  }
  return proposals;
}
