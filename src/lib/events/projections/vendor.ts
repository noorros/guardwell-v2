// src/lib/events/projections/vendor.ts
//
// Projects Vendor events into the Vendor table and rederives HIPAA_BAA
// via the "BAA_EXECUTED" evidence type. All three events feed the same
// rederive call since any of them (new PHI vendor, new BAA, retiring a
// vendor) can flip whether the 100% rule holds.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

const EVIDENCE_CODE = "BAA_EXECUTED";

type UpsertedPayload = PayloadFor<"VENDOR_UPSERTED", 1>;
type BaaPayload = PayloadFor<"VENDOR_BAA_EXECUTED", 1>;
type RemovedPayload = PayloadFor<"VENDOR_REMOVED", 1>;

export async function projectVendorUpserted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UpsertedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Normalize empty-string email to null so the nullable index stays clean.
  const email = payload.email ? payload.email : null;
  await tx.vendor.upsert({
    where: { id: payload.vendorId },
    update: {
      name: payload.name,
      type: payload.type ?? null,
      service: payload.service ?? null,
      contact: payload.contact ?? null,
      email,
      notes: payload.notes ?? null,
      processesPhi: payload.processesPhi,
      retiredAt: null,
    },
    create: {
      id: payload.vendorId,
      practiceId,
      name: payload.name,
      type: payload.type ?? null,
      service: payload.service ?? null,
      contact: payload.contact ?? null,
      email,
      notes: payload.notes ?? null,
      processesPhi: payload.processesPhi,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, EVIDENCE_CODE);
}

export async function projectVendorBaaExecuted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: BaaPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.vendor.update({
    where: { id: payload.vendorId },
    data: {
      baaExecutedAt: new Date(payload.executedAt),
      baaExpiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      baaDirection: payload.baaDirection ?? null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, EVIDENCE_CODE);
}

export async function projectVendorRemoved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RemovedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.vendor.update({
    where: { id: payload.vendorId },
    data: { retiredAt: new Date() },
  });
  await rederiveRequirementStatus(tx, practiceId, EVIDENCE_CODE);
}
