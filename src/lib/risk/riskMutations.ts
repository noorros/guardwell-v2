// src/lib/risk/riskMutations.ts
//
// Phase 5 PR 5 — IDOR-safe DB write helpers for the risk register.
// Server actions in src/app/(dashboard)/programs/risk/ delegate here.
// Lives in src/lib/risk/ (ALLOWED_PATH) per the
// gw/no-direct-projection-mutation rule.
//
// Mirrors src/lib/regulatory/alertMutations.ts for shape: every write
// helper does findUnique → assert practiceId match → mutate. Cross-tenant
// calls throw before any write reaches the DB.

import { db } from "@/lib/db";
import type { RiskSeverity, RiskItemStatus } from "./types";

async function assertRiskItemOwnedByPractice(
  riskItemId: string,
  practiceId: string,
): Promise<void> {
  const r = await db.riskItem.findUnique({
    where: { id: riskItemId },
    select: { practiceId: true },
  });
  if (!r) throw new Error("Risk item not found");
  if (r.practiceId !== practiceId) {
    throw new Error("Cross-tenant access denied");
  }
}

export async function updateRiskItem(
  riskItemId: string,
  practiceId: string,
  patch: { notes?: string | null; status?: RiskItemStatus },
  userId: string,
): Promise<void> {
  await assertRiskItemOwnedByPractice(riskItemId, practiceId);
  await db.riskItem.update({
    where: { id: riskItemId },
    data: {
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.status
        ? {
            status: patch.status,
            resolvedAt: patch.status === "OPEN" ? null : new Date(),
            resolvedByUserId: patch.status === "OPEN" ? null : userId,
          }
        : {}),
    },
  });
}

export async function createManualRiskItem(
  practiceId: string,
  input: {
    category: string;
    severity: RiskSeverity;
    title: string;
    description: string;
    notes?: string;
  },
): Promise<{ id: string }> {
  // PR 1's @@unique constraint on RiskItem doesn't prevent duplicate
  // MANUAL rows because Postgres treats NULL as distinct. Synthesize a
  // unique sourceCode so the unique constraint enforces de-dup AND each
  // manual row stays distinct even when two creators submit the same
  // title/category in quick succession.
  const sourceCode = `MANUAL_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const row = await db.riskItem.create({
    data: {
      practiceId,
      source: "MANUAL",
      sourceCode,
      sourceRefId: null,
      category: input.category,
      severity: input.severity,
      title: input.title,
      description: input.description,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });
  return row;
}
