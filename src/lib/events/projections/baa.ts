// src/lib/events/projections/baa.ts
//
// Projections for BAA (Business Associate Agreement) lifecycle events.
// Each projection runs inside the appendEventAndApply transaction;
// failure rolls back the EventLog write per ADR-0001. The state machine:
//
//   DRAFT → SENT → ACKNOWLEDGED → EXECUTED
//                              \→ REJECTED
//
// EXPIRED is computed from baaExpiresAt at read time (no projection).
// SUPERSEDED is post-launch.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type DraftUploadedPayload = PayloadFor<"BAA_DRAFT_UPLOADED", 1>;
type SentPayload = PayloadFor<"BAA_SENT_TO_VENDOR", 1>;
type AcknowledgedPayload = PayloadFor<"BAA_ACKNOWLEDGED_BY_VENDOR", 1>;
type ExecutedPayload = PayloadFor<"BAA_EXECUTED_BY_VENDOR", 1>;
type RejectedPayload = PayloadFor<"BAA_REJECTED_BY_VENDOR", 1>;

export async function projectBaaDraftUploaded(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DraftUploadedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.baaRequest.upsert({
    where: { id: payload.baaRequestId },
    create: {
      id: payload.baaRequestId,
      practiceId,
      vendorId: payload.vendorId,
      status: "DRAFT",
      draftEvidenceId: payload.draftEvidenceId ?? null,
      draftUploadedAt: new Date(),
    },
    update: {
      // Re-emit is idempotent: if the row exists, just update the
      // draft pointer (e.g., practice replaced the file before sending).
      draftEvidenceId: payload.draftEvidenceId ?? null,
      draftUploadedAt: new Date(),
    },
  });
}

export async function projectBaaSentToVendor(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: SentPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Revoke any prior unconsumed tokens for this BaaRequest before
  // creating the new one, so only one active token at a time.
  await tx.baaAcceptanceToken.updateMany({
    where: {
      baaRequestId: payload.baaRequestId,
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  await tx.baaAcceptanceToken.create({
    data: {
      id: payload.tokenId,
      practiceId,
      baaRequestId: payload.baaRequestId,
      token: payload.token,
      expiresAt: new Date(payload.tokenExpiresAt),
    },
  });
  await tx.baaRequest.update({
    where: { id: payload.baaRequestId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      recipientEmail: payload.recipientEmail,
      recipientMessage: payload.recipientMessage ?? null,
    },
  });
}

export async function projectBaaAcknowledgedByVendor(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: AcknowledgedPayload },
): Promise<void> {
  const { payload } = args;
  // Idempotent — only update on first acknowledgment.
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { status: true, acknowledgedAt: true },
  });
  if (!existing) return;
  if (existing.acknowledgedAt) return; // already acknowledged
  await tx.baaRequest.update({
    where: { id: payload.baaRequestId },
    data: {
      status: existing.status === "SENT" ? "ACKNOWLEDGED" : existing.status,
      acknowledgedAt: new Date(payload.acknowledgedAt),
    },
  });
}

export async function projectBaaExecutedByVendor(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ExecutedPayload },
): Promise<void> {
  const { payload } = args;
  const baaRequest = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { vendorId: true, status: true, executedAt: true },
  });
  if (!baaRequest) return;
  if (baaRequest.executedAt) return; // already executed (idempotent)

  // Update the BaaRequest row with execution fields.
  await tx.baaRequest.update({
    where: { id: payload.baaRequestId },
    data: {
      status: "EXECUTED",
      executedAt: new Date(payload.executedAt),
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      vendorSignatureName: payload.vendorSignatureName,
      vendorSignatureIp: payload.vendorSignatureIp ?? null,
      vendorSignatureUserAgent: payload.vendorSignatureUserAgent ?? null,
    },
  });

  // Mark the consumed token.
  await tx.baaAcceptanceToken.update({
    where: { id: payload.tokenId },
    data: { consumedAt: new Date() },
  });

  // Side effect: update Vendor.baaExecutedAt + baaExpiresAt to keep
  // existing `BaaStatusBadge` UI working without a full UI rewrite.
  await tx.vendor.update({
    where: { id: baaRequest.vendorId },
    data: {
      baaExecutedAt: new Date(payload.executedAt),
      baaExpiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    },
  });
}

export async function projectBaaRejectedByVendor(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RejectedPayload },
): Promise<void> {
  const { payload } = args;
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { rejectedAt: true },
  });
  if (!existing) return;
  if (existing.rejectedAt) return; // already rejected

  await tx.baaRequest.update({
    where: { id: payload.baaRequestId },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(payload.rejectedAt),
      rejectionReason: payload.reason ?? null,
    },
  });
  // Mark the consumed token.
  await tx.baaAcceptanceToken.update({
    where: { id: payload.tokenId },
    data: { consumedAt: new Date() },
  });
}
