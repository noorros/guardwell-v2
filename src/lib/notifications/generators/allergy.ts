// src/lib/notifications/generators/allergy.ts

import type { Prisma, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";
import { daysUntil } from "./helpers";

// ---------------------------------------------------------------------------
// Allergy / USP §21 generators
// ---------------------------------------------------------------------------

const DRILL_DUE_WINDOW_DAYS = 30;
const FRIDGE_OVERDUE_DAYS = 30;
const KIT_EXPIRY_WINDOW_DAYS = 60;

/**
 * Three notifications for the allergy program:
 *   - Anaphylaxis drill due (next drill within N days OR overdue)
 *   - Refrigerator temp log overdue (>30 days since last check)
 *   - Emergency kit expiring (epi within 60 days)
 *
 * No-ops gracefully when the ALLERGY framework is not enabled for the
 * practice.
 */
export async function generateAllergyNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  // No date renders in this generator's body/title strings — practiceTimezone
  // is kept for signature consistency so generateAllNotifications can pass it
  // uniformly. Future date renders in allergy bodies should use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!enabled) return [];

  const proposals: NotificationProposal[] = [];

  // ── Drill due ────────────────────────────────────────────────────────────
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // drills (audit #15) don't keep firing reminders.
  const lastDrill = await tx.allergyDrill.findFirst({
    where: { practiceId, retiredAt: null },
    orderBy: { conductedAt: "desc" },
    select: { id: true, nextDrillDue: true },
  });
  if (lastDrill?.nextDrillDue) {
    const daysLeft = daysUntil(lastDrill.nextDrillDue);
    if (daysLeft !== null && daysLeft <= DRILL_DUE_WINDOW_DAYS) {
      const severity: NotificationSeverity = daysLeft < 0 ? "CRITICAL" : "WARNING";
      const title =
        daysLeft < 0
          ? "Anaphylaxis drill overdue"
          : `Anaphylaxis drill due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      for (const userId of userIds) {
        proposals.push({
          userId,
          practiceId,
          type: "ALLERGY_DRILL_DUE",
          severity,
          title,
          body: "Schedule the next anaphylaxis drill at /programs/allergy.",
          href: "/programs/allergy",
          entityKey: `allergy-drill-${lastDrill.id}`,
        });
      }
    }
  } else if (!lastDrill) {
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "ALLERGY_DRILL_DUE",
        severity: "WARNING",
        title: "Anaphylaxis drill not yet on file",
        body: "Run your first anaphylaxis drill to satisfy USP §21 §21.6.",
        href: "/programs/allergy",
        entityKey: "allergy-drill-initial",
      });
    }
  }

  // ── Refrigerator overdue ─────────────────────────────────────────────────
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // fridge logs (audit #15) don't suppress / reset the overdue timer.
  const lastFridge = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "REFRIGERATOR_TEMP", retiredAt: null },
    orderBy: { checkedAt: "desc" },
    select: { id: true, checkedAt: true },
  });
  if (
    !lastFridge ||
    Date.now() - lastFridge.checkedAt.getTime() > FRIDGE_OVERDUE_DAYS * DAY_MS
  ) {
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "ALLERGY_FRIDGE_OVERDUE",
        severity: "CRITICAL",
        title: "Refrigerator temperature log overdue",
        body: "Log a temperature reading at /programs/allergy.",
        href: "/programs/allergy",
        entityKey: lastFridge ? `fridge-${lastFridge.id}` : "fridge-initial",
      });
    }
  }

  // ── Kit expiring ─────────────────────────────────────────────────────────
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // kit checks (audit #15) don't keep firing the epi-expiry warning.
  const lastKit = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "EMERGENCY_KIT", retiredAt: null },
    orderBy: { checkedAt: "desc" },
    select: { id: true, epiExpiryDate: true },
  });
  if (lastKit?.epiExpiryDate) {
    const daysLeft = daysUntil(lastKit.epiExpiryDate);
    if (daysLeft !== null && daysLeft <= KIT_EXPIRY_WINDOW_DAYS) {
      const severity: NotificationSeverity = daysLeft < 0 ? "CRITICAL" : "WARNING";
      const title =
        daysLeft < 0
          ? "Epinephrine in the emergency kit has expired"
          : `Epinephrine expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      for (const userId of userIds) {
        proposals.push({
          userId,
          practiceId,
          type: "ALLERGY_KIT_EXPIRING",
          severity,
          title,
          body: "Replace the auto-injector at /programs/allergy.",
          href: "/programs/allergy",
          entityKey: `allergy-kit-${lastKit.id}`,
        });
      }
    }
  }

  return proposals;
}
