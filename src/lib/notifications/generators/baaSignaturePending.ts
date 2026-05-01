// src/lib/notifications/generators/baaSignaturePending.ts

import type { Prisma, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal } from "./types";
import { ownerAdminUserIds } from "./helpers";

/**
 * Phase 7 PR 3 — BAA generator split.
 *
 * The original generateVendorBaaNotifications was replaced with three
 * lifecycle-stage generators:
 *   - generateBaaSignaturePendingNotifications: BAA sent, awaiting vendor sig
 *   - generateBaaExpiringNotifications:        BAA approaching expiry (lead-time aware)
 *   - generateBaaExecutedNotifications:        BAA freshly executed (info)
 *
 * Recipients shifted from "all userIds" (old behavior) to OWNER + ADMIN
 * only — STAFF/VIEWER won't see BAA notifications, which is correct
 * since BAAs are admin work.
 */

/**
 * Fires when a BAA has been sent to a vendor but not yet executed
 * (status === SENT or ACKNOWLEDGED) and the request is still active
 * (no rejectedAt).
 *
 * This notification fires ONCE per BaaRequest (entityKey is keyed only on
 * request id). The user gets one nudge when the digest first sees the
 * pending BAA; subsequent digests dedup. If the BAA stays pending
 * indefinitely, the user does NOT get repeated reminders — the dashboard
 * signal (via the vendor list) is the persistent visibility.
 *
 * Severity is constant WARNING. An earlier draft escalated INFO → WARNING
 * after 7 days waiting, but the entityKey lacked a tier component, so
 * dedup would catch the INFO row and the WARNING escalation never reached
 * the user. Single tier avoids that footgun.
 */
export async function generateBaaSignaturePendingNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const requests = await tx.baaRequest.findMany({
    where: {
      practiceId,
      status: { in: ["SENT", "ACKNOWLEDGED"] },
      rejectedAt: null,
    },
    select: {
      id: true,
      vendorId: true,
      vendor: { select: { name: true } },
    },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const r of requests) {
    const title = `BAA awaiting vendor signature: ${r.vendor.name}`;
    const body = `${r.vendor.name} hasn't yet signed the BAA. They should receive a token link via email.`;
    const severity: NotificationSeverity = "WARNING";
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "BAA_SIGNATURE_PENDING",
        severity,
        title,
        body,
        href: "/programs/vendors",
        entityKey: `baa-signature-pending:${r.id}`,
      });
    }
  }
  return proposals;
}
