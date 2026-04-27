// src/lib/events/projections/evidence.ts
//
// Projections for EVIDENCE_UPLOAD_REQUESTED, EVIDENCE_UPLOAD_CONFIRMED,
// and EVIDENCE_DELETED events. These are the only code paths that mutate
// the Evidence table (per ADR-0001 — no-direct-projection-mutation).

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type RequestedPayload = PayloadFor<"EVIDENCE_UPLOAD_REQUESTED", 1>;
type ConfirmedPayload = PayloadFor<"EVIDENCE_UPLOAD_CONFIRMED", 1>;
type DeletedPayload = PayloadFor<"EVIDENCE_DELETED", 1>;

/**
 * Creates the Evidence row with status=PENDING when the client
 * requests a signed upload URL. Idempotent on gcsKey — a retry of the
 * same upload won't create a duplicate row.
 */
export async function projectEvidenceUploadRequested(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RequestedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.evidence.upsert({
    where: { gcsKey: payload.gcsKey },
    create: {
      id: payload.evidenceId,
      practiceId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      uploadedById: payload.uploadedById,
      gcsKey: payload.gcsKey,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSizeBytes: payload.fileSizeBytes,
      status: "PENDING",
    },
    update: {
      // Idempotent — fields don't change for a given gcsKey on retry
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSizeBytes: payload.fileSizeBytes,
    },
  });
}

/**
 * Flips status to UPLOADED and sets confirmedAt after the client
 * signals the PUT to GCS succeeded.
 */
export async function projectEvidenceUploadConfirmed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ConfirmedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const row = await tx.evidence.findUnique({
    where: { id: payload.evidenceId },
    select: { practiceId: true, status: true },
  });
  if (!row || row.practiceId !== practiceId) {
    throw new Error(
      `EVIDENCE_UPLOAD_CONFIRMED refused: not found / cross-practice`,
    );
  }
  if (row.status === "UPLOADED") return; // already confirmed — idempotent
  await tx.evidence.update({
    where: { id: payload.evidenceId },
    data: { status: "UPLOADED", confirmedAt: new Date() },
  });
}

/**
 * Soft-deletes the Evidence row by flipping status to DELETED and
 * setting deletedAt. GCS lifecycle policy handles physical removal.
 */
export async function projectEvidenceDeleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DeletedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const row = await tx.evidence.findUnique({
    where: { id: payload.evidenceId },
    select: { practiceId: true, status: true },
  });
  if (!row || row.practiceId !== practiceId) {
    throw new Error(`EVIDENCE_DELETED refused: not found / cross-practice`);
  }
  if (row.status === "DELETED") return; // already deleted — idempotent
  await tx.evidence.update({
    where: { id: payload.evidenceId },
    data: { status: "DELETED", deletedAt: new Date() },
  });
}
