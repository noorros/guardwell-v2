// src/lib/storage/evidence.ts
//
// High-level evidence helpers used by the API routes + server actions.
// Keeps file validation, signed-URL issuance, and event-emission in one
// place so per-surface upload UIs are thin wrappers.

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectEvidenceUploadRequested,
  projectEvidenceUploadConfirmed,
  projectEvidenceDeleted,
} from "@/lib/events/projections/evidence";
import {
  buildEvidenceKey,
  deleteFile,
  getSignedDownloadUrl,
  getSignedUploadUrl,
} from "./gcs";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export interface RequestUploadArgs {
  practiceId: string;
  practiceUserId: string; // PracticeUser.id (not User.id)
  actorUserId: string; // User.id — for event log actorUserId
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface RequestUploadResult {
  evidenceId: string;
  gcsKey: string;
  uploadUrl: string | null;
  expiresInSec: number;
  reason?: string;
}

/**
 * Step 1 of 3: validates the file metadata, builds the GCS key, issues a
 * 5-minute signed PUT URL, emits EVIDENCE_UPLOAD_REQUESTED (creates the
 * Evidence row with status=PENDING), and returns the signed URL to the client.
 *
 * In dev (GCS_EVIDENCE_BUCKET unset) the signed URL is null — the client
 * should skip the PUT and call requestUpload with uploadUrl:null, then jump
 * directly to confirmUpload so the row still gets created for UI testing.
 */
export async function requestUpload(
  args: RequestUploadArgs,
): Promise<RequestUploadResult> {
  if (!ALLOWED_MIME.has(args.mimeType)) {
    throw new Error(`Unsupported file type: ${args.mimeType}`);
  }
  if (args.fileSizeBytes > MAX_BYTES) {
    throw new Error(
      `File too large: ${args.fileSizeBytes} bytes (max ${MAX_BYTES})`,
    );
  }

  const evidenceId = randomUUID();
  const gcsKey = buildEvidenceKey({
    practiceId: args.practiceId,
    entityType: args.entityType,
    entityId: args.entityId,
    fileName: args.fileName,
  });

  const signed = await getSignedUploadUrl(gcsKey, args.mimeType);

  const payload = {
    evidenceId,
    entityType: args.entityType,
    entityId: args.entityId,
    fileName: args.fileName,
    gcsKey,
    mimeType: args.mimeType,
    fileSizeBytes: args.fileSizeBytes,
    uploadedById: args.practiceUserId,
  };

  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.actorUserId,
      type: "EVIDENCE_UPLOAD_REQUESTED",
      payload,
    },
    async (tx) =>
      projectEvidenceUploadRequested(tx, {
        practiceId: args.practiceId,
        payload,
      }),
  );

  return {
    evidenceId,
    gcsKey,
    uploadUrl: signed.url,
    expiresInSec: 300,
    reason: signed.reason,
  };
}

/**
 * Step 3 of 3: client calls this AFTER the PUT to GCS succeeds (or
 * immediately in dev no-op mode). Flips status to UPLOADED.
 */
export async function confirmUpload(args: {
  practiceId: string;
  actorUserId: string;
  evidenceId: string;
}): Promise<void> {
  const payload = { evidenceId: args.evidenceId };
  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.actorUserId,
      type: "EVIDENCE_UPLOAD_CONFIRMED",
      payload,
    },
    async (tx) =>
      projectEvidenceUploadConfirmed(tx, {
        practiceId: args.practiceId,
        payload,
      }),
  );
}

/**
 * Issue a 5-minute signed download URL. Validates that the Evidence row
 * belongs to the requesting practice (cross-tenant guard) and is not deleted.
 */
export async function getDownloadUrl(args: {
  practiceId: string;
  evidenceId: string;
}): Promise<{ url: string | null; fileName: string; reason?: string }> {
  const ev = await db.evidence.findUnique({
    where: { id: args.evidenceId },
    select: {
      practiceId: true,
      gcsKey: true,
      fileName: true,
      status: true,
    },
  });
  if (!ev || ev.practiceId !== args.practiceId) {
    throw new Error("Evidence not found");
  }
  if (ev.status === "DELETED") {
    throw new Error("Evidence has been deleted");
  }

  const signed = await getSignedDownloadUrl(ev.gcsKey);
  return { url: signed.url, fileName: ev.fileName, reason: signed.reason };
}

/**
 * Soft-delete: flips status to DELETED + best-effort deletes the GCS object.
 * GCS lifecycle policy provides a safety net if the object delete fails.
 */
export async function softDelete(args: {
  practiceId: string;
  actorUserId: string;
  evidenceId: string;
  reason?: string;
}): Promise<void> {
  const ev = await db.evidence.findUnique({
    where: { id: args.evidenceId },
    select: { practiceId: true, gcsKey: true, status: true },
  });
  if (!ev || ev.practiceId !== args.practiceId) {
    throw new Error("Evidence not found");
  }
  if (ev.status === "DELETED") return; // already deleted — idempotent

  const payload = {
    evidenceId: args.evidenceId,
    reason: args.reason,
  };

  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.actorUserId,
      type: "EVIDENCE_DELETED",
      payload,
    },
    async (tx) =>
      projectEvidenceDeleted(tx, {
        practiceId: args.practiceId,
        payload,
      }),
  );

  // Best-effort GCS delete; lifecycle rule cleans up if this fails.
  await deleteFile(ev.gcsKey).catch(() => {});
}
