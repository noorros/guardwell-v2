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
import { assertProjectionPracticeOwned } from "./guards";

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

  // Audit C-1: refuse a forged BAA_DRAFT_UPLOADED carrying another
  // practice's baaRequestId — without this guard, vendor / draft
  // pointer / status on Practice B's BaaRequest could be overwritten.
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "baaRequest",
    id: payload.baaRequestId,
  });

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

  // Audit C-1: refuse a forged BAA_SENT_TO_VENDOR carrying another
  // practice's baaRequestId — without this guard, status / sentAt /
  // recipientEmail on Practice B's BaaRequest could be overwritten,
  // any active acceptance token on B's request could be revoked, AND a
  // new acceptance token would be created under our practice but tied
  // to B's request (FK invariant break).
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { practiceId: true },
  });
  if (!existing) {
    throw new Error(
      `BAA_SENT_TO_VENDOR refused: baaRequest ${payload.baaRequestId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "baaRequest",
    id: payload.baaRequestId,
  });

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
  const { practiceId, payload } = args;
  // Idempotent — only update on first acknowledgment.
  // Audit C-1: also gate on practice ownership so a forged
  // BAA_ACKNOWLEDGED_BY_VENDOR carrying another practice's baaRequestId
  // can't bump status / acknowledgedAt on Practice B's request.
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { practiceId: true, status: true, acknowledgedAt: true },
  });
  if (!existing) return;
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "baaRequest",
    id: payload.baaRequestId,
  });
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
  const { practiceId, payload } = args;
  // Audit C-1: gate on practice ownership so a forged
  // BAA_EXECUTED_BY_VENDOR carrying another practice's baaRequestId
  // can't flip status / executedAt / signature data on Practice B's
  // request — and cannot consume B's acceptance token or update B's
  // Vendor row's baaExecutedAt.
  const baaRequest = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: {
      practiceId: true,
      vendorId: true,
      status: true,
      executedAt: true,
    },
  });
  if (!baaRequest) return;
  assertProjectionPracticeOwned(baaRequest, practiceId, {
    table: "baaRequest",
    id: payload.baaRequestId,
  });
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
  const { practiceId, payload } = args;
  // Audit C-1: gate on practice ownership so a forged
  // BAA_REJECTED_BY_VENDOR carrying another practice's baaRequestId
  // can't flip status / rejectedAt / rejectionReason on Practice B's
  // request and cannot consume B's acceptance token.
  const existing = await tx.baaRequest.findUnique({
    where: { id: payload.baaRequestId },
    select: { practiceId: true, rejectedAt: true },
  });
  if (!existing) return;
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "baaRequest",
    id: payload.baaRequestId,
  });
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
