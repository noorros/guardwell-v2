// src/lib/notifications/generators/deaBiennialInventory.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import { daysUntil, ownerAdminUserIds } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

// ---------------------------------------------------------------------------
// Phase 7 PR 4 — DEA + safety generators
// ---------------------------------------------------------------------------
//
// All four generators target OWNER + ADMIN only via ownerAdminUserIds.
// The DEA generator uses the milestone fan-out pattern matching
// generateCredentialRenewalNotifications. The other three use absence-
// based detection — fire when no qualifying record exists in the lookback
// window — with year-week or year-quarter dedup so stale practices get
// one nudge per period, not one per digest run.

/**
 * DEA biennial controlled-substance inventory due reminder.
 *
 * 21 CFR §1304.11 requires a controlled-substance inventory every 2 years.
 * Schedule: 24 months from latest DeaInventory.asOfDate. Fires at the
 * milestones from getEffectiveLeadTimes(reminderSettings, "deaInventory")
 * (default [60, 14, 1]) — same fire-all-crossed pattern as
 * generateCredentialRenewalNotifications. If no inventory has ever been
 * recorded, fires CRITICAL with no due date (entityKey is stable per-
 * practice so dedup catches re-fires).
 *
 * Gated to practices with the DEA framework enabled.
 */
export async function generateDeaBiennialInventoryDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via ownerAdminUserIds. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  // DEA framework gating — practices without DEA enabled shouldn't see
  // biennial-inventory notifications at all.
  const dea = await tx.practiceFramework.findFirst({
    where: { practiceId, enabled: true, framework: { code: "DEA" } },
    select: { id: true },
  });
  if (!dea) return [];

  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const latest = await tx.deaInventory.findFirst({
    where: { practiceId },
    orderBy: { asOfDate: "desc" },
    select: { id: true, asOfDate: true },
  });

  if (!latest) {
    // No biennial inventory has ever been recorded — fire CRITICAL once.
    // The entityKey is stable per-practice so dedup catches re-fires.
    return adminUserIds.map((userId) => ({
      userId,
      practiceId,
      type: "DEA_BIENNIAL_INVENTORY_DUE" as NotificationType,
      severity: "CRITICAL" as NotificationSeverity,
      title: "DEA biennial inventory has never been recorded",
      body: "21 CFR §1304.11 requires a biennial controlled-substance inventory. No DEA inventory exists in your records — log one to satisfy DEA compliance.",
      href: "/programs/dea/inventory",
      entityKey: `dea-biennial-never-recorded:${practiceId}`,
    }));
  }

  // 24 months from asOfDate.
  const dueDate = new Date(latest.asOfDate.getTime());
  dueDate.setUTCMonth(dueDate.getUTCMonth() + 24);
  const days = daysUntil(dueDate);
  if (days === null) return [];

  const milestones = getEffectiveLeadTimes(reminderSettings, "deaInventory");
  const matched = milestones.filter((m) => days <= m);

  const proposals: NotificationProposal[] = [];
  for (const m of matched) {
    const severity: NotificationSeverity =
      days <= 0 ? "CRITICAL" : m <= 14 ? "WARNING" : "INFO";
    const title =
      days <= 0
        ? `DEA biennial inventory is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
        : `DEA biennial inventory due in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Your last DEA biennial controlled-substance inventory was ${formatPracticeDate(latest.asOfDate, practiceTimezone)}. The next is due ${formatPracticeDate(dueDate, practiceTimezone)}.`;
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "DEA_BIENNIAL_INVENTORY_DUE",
        severity,
        title,
        body,
        href: "/programs/dea/inventory",
        entityKey: `dea-biennial:${latest.id}:${m}`,
      });
    }
  }
  // If overdue (days < 0) but somehow no milestones matched, fire a critical
  // "overdue" entry anyway so the practice is alerted. In practice 0 satisfies
  // any positive milestone so this fallback is a defense-in-depth path.
  if (days < 0 && proposals.length === 0) {
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "DEA_BIENNIAL_INVENTORY_DUE",
        severity: "CRITICAL",
        title: `DEA biennial inventory is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`,
        body: `Your last DEA biennial controlled-substance inventory was ${formatPracticeDate(latest.asOfDate, practiceTimezone)}. The next was due ${formatPracticeDate(dueDate, practiceTimezone)}.`,
        href: "/programs/dea/inventory",
        entityKey: `dea-biennial-overdue:${latest.id}`,
      });
    }
  }
  return proposals;
}
