// src/lib/risk/capMutations.ts
//
// Phase 5 PR 6 — IDOR-safe DB write helpers for the corrective action
// plan (CAP) workflow. Server actions in
// src/app/(dashboard)/programs/risk/cap/[id]/ + the items detail page +
// the regulatory "Add to my CAP" path delegate here.
// Lives in src/lib/risk/ (ALLOWED_PATH) per the
// gw/no-direct-projection-mutation rule.
//
// Mirrors src/lib/risk/riskMutations.ts for shape: every write helper
// does findUnique → assert practiceId match → mutate. Cross-tenant calls
// throw before any write reaches the DB.

import { db } from "@/lib/db";
import type { CapStatus } from "./types";

async function assertCapOwnedByPractice(
  capId: string,
  practiceId: string,
): Promise<void> {
  const c = await db.correctiveAction.findUnique({
    where: { id: capId },
    select: { practiceId: true },
  });
  if (!c) throw new Error("CAP not found");
  if (c.practiceId !== practiceId) {
    throw new Error("Cross-tenant access denied");
  }
}

export async function createCap(
  practiceId: string,
  input: {
    riskItemId?: string | null;
    sourceAlertId?: string | null;
    description: string;
    ownerUserId?: string | null;
    dueDate?: Date | null;
  },
): Promise<{ id: string }> {
  // If riskItemId is provided, verify it belongs to the same practice
  // BEFORE we create the CAP — otherwise an attacker could create a CAP
  // pointing at another tenant's risk row.
  if (input.riskItemId) {
    const r = await db.riskItem.findUnique({
      where: { id: input.riskItemId },
      select: { practiceId: true },
    });
    if (!r) throw new Error("Risk item not found");
    if (r.practiceId !== practiceId) {
      throw new Error("Cross-tenant access denied");
    }
  }
  const row = await db.correctiveAction.create({
    data: {
      practiceId,
      riskItemId: input.riskItemId ?? null,
      sourceAlertId: input.sourceAlertId ?? null,
      description: input.description,
      ownerUserId: input.ownerUserId ?? null,
      dueDate: input.dueDate ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });
  return row;
}

export async function updateCapStatus(
  capId: string,
  practiceId: string,
  newStatus: CapStatus,
  userId: string,
): Promise<void> {
  await assertCapOwnedByPractice(capId, practiceId);
  await db.correctiveAction.update({
    where: { id: capId },
    data: {
      status: newStatus,
      ...(newStatus === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
      ...(newStatus === "COMPLETED"
        ? { completedAt: new Date(), completedByUserId: userId }
        : {}),
    },
  });
}

export async function updateCapDetails(
  capId: string,
  practiceId: string,
  patch: {
    description?: string;
    ownerUserId?: string | null;
    dueDate?: Date | null;
    notes?: string | null;
  },
): Promise<void> {
  await assertCapOwnedByPractice(capId, practiceId);
  await db.correctiveAction.update({
    where: { id: capId },
    data: {
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.ownerUserId !== undefined
        ? { ownerUserId: patch.ownerUserId }
        : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    },
  });
}

export async function attachEvidenceToCap(
  capId: string,
  practiceId: string,
  evidenceId: string,
  userId: string,
): Promise<void> {
  await assertCapOwnedByPractice(capId, practiceId);
  // Cross-tenant guard #2: the Evidence row must also belong to the
  // caller's practice. Otherwise a CAP could "borrow" another tenant's
  // evidence by capId-spoofing.
  const e = await db.evidence.findUnique({
    where: { id: evidenceId },
    select: { practiceId: true },
  });
  if (!e) throw new Error("Evidence not found");
  if (e.practiceId !== practiceId) {
    throw new Error("Cross-tenant access denied");
  }
  await db.correctiveActionEvidence.create({
    data: {
      capId,
      evidenceId,
      attachedByUserId: userId,
    },
  });
}
