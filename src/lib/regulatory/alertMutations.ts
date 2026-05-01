// src/lib/regulatory/alertMutations.ts
//
// Phase 8 PR 6 — DB write helpers for the regulatory UI server actions.
// Lives under src/lib/regulatory/ so the ESLint
// gw/no-direct-projection-mutation rule (which blocks PROJECTION_TABLES
// writes outside ALLOWED_PATHS) is satisfied. Server actions handle
// auth + validation + revalidatePath; these helpers handle the DB.
//
// All alert-scoped mutations are IDOR-safe: every operation requires the
// caller's practiceId to match the target row's practiceId. Cross-tenant
// calls throw before any write reaches the DB.

import { db } from "@/lib/db";

async function assertAlertOwnedByPractice(
  alertId: string,
  practiceId: string,
): Promise<void> {
  const alert = await db.regulatoryAlert.findUnique({
    where: { id: alertId },
    select: { practiceId: true },
  });
  if (!alert) throw new Error("Alert not found");
  if (alert.practiceId !== practiceId) {
    throw new Error("Cross-tenant access denied");
  }
}

export async function acknowledgeAlert(
  alertId: string,
  practiceId: string,
  userId: string,
): Promise<void> {
  await assertAlertOwnedByPractice(alertId, practiceId);
  await db.regulatoryAlert.update({
    where: { id: alertId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId,
    },
  });
}

export async function dismissAlert(
  alertId: string,
  practiceId: string,
  userId: string,
): Promise<void> {
  await assertAlertOwnedByPractice(alertId, practiceId);
  await db.regulatoryAlert.update({
    where: { id: alertId },
    data: {
      dismissedAt: new Date(),
      dismissedByUserId: userId,
    },
  });
}

export async function addAlertActionToAlert(
  alertId: string,
  practiceId: string,
  description: string,
  options: { ownerUserId?: string | null; dueDate?: Date | null } = {},
): Promise<{ id: string; capId: string; reusedExistingCap: boolean }> {
  await assertAlertOwnedByPractice(alertId, practiceId);

  // Idempotency guard: re-clicking "Add to my CAP" on the same alert
  // should not create duplicate CAPs. If an open (non-COMPLETED) CAP
  // already exists for this (practice, alert), reuse it AND skip the
  // AlertAction insert. This makes the user-facing action effectively
  // idempotent without a unique constraint that would block legitimate
  // "open a new CAP after the previous one closed" workflows. The
  // (action, cap) write pair below runs only when no open CAP exists.
  const existingCap = await db.correctiveAction.findFirst({
    where: {
      practiceId,
      sourceAlertId: alertId,
      status: { not: "COMPLETED" },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existingCap) {
    // Find a paired AlertAction (any will do — they're audit-trail
    // siblings of the same user intent). If none exists for some legacy
    // reason, return the cap id with a synthetic-ish action id of the
    // most recent matching alert action; the calling action ignores the
    // distinction.
    const existingAction = await db.alertAction.findFirst({
      where: { alertId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    return {
      id: existingAction?.id ?? existingCap.id,
      capId: existingCap.id,
      reusedExistingCap: true,
    };
  }

  // Atomic dual-create: AlertAction + CorrectiveAction in a single
  // transaction so a partial failure can't leave an orphan AlertAction
  // without its paired CAP. Both writes are permitted from
  // src/lib/regulatory/ because that path is in ALLOWED_PATHS;
  // correctiveAction is in PROJECTION_TABLES (gated by
  // gw/no-direct-projection-mutation) and the rule allows writes from
  // either src/lib/regulatory/ or src/lib/risk/.
  return db.$transaction(async (tx) => {
    const row = await tx.alertAction.create({
      data: {
        alertId,
        description,
        ownerUserId: options.ownerUserId ?? null,
        dueDate: options.dueDate ?? null,
      },
      select: { id: true },
    });
    const cap = await tx.correctiveAction.create({
      data: {
        practiceId,
        riskItemId: null,
        sourceAlertId: alertId,
        description,
        ownerUserId: options.ownerUserId ?? null,
        dueDate: options.dueDate ?? null,
        status: "PENDING",
      },
      select: { id: true },
    });
    return { id: row.id, capId: cap.id, reusedExistingCap: false };
  });
}

export async function toggleSourceActive(
  sourceId: string,
  isActive: boolean,
): Promise<void> {
  // RegulatorySource is global (no practiceId) — only platform admins
  // should reach this. Caller MUST gate at the server-action level.
  await db.regulatorySource.update({
    where: { id: sourceId },
    data: { isActive },
  });
}
