// src/lib/storage/evidence.ts
//
// High-level evidence helpers used by the API routes + server actions.
// Keeps file validation, signed-URL issuance, quota check, and
// event-emission in one place so per-surface upload UIs are thin wrappers.

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

// ── Default quota ────────────────────────────────────────────────────────────
// 5 GB expressed in bytes. Overridable via env var at deploy time; further
// overridable per-practice via Practice.storageQuotaBytes.
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function getDefaultQuota(): bigint {
  const env = process.env.PRACTICE_STORAGE_QUOTA_BYTES;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
      return BigInt(n);
    }
  }
  return BigInt(DEFAULT_QUOTA_BYTES);
}

// ── Content-type allowlist by entityType ─────────────────────────────────────
// Phase 4 (BYOV training videos) will add TRAINING_VIDEO → video/mp4.
// Phase 9 (Document Hub) will add DOCUMENT → application/pdf only.
const ALLOWED_MIME_BY_ENTITY_TYPE: Record<string, Set<string>> = {
  CREDENTIAL:          new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  DESTRUCTION_LOG:     new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  INCIDENT:            new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  VENDOR:              new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  TECH_ASSET:          new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  TRAINING_COMPLETION: new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  // Default — used when entityType is not listed above. Conservative.
  DEFAULT:             new Set(["application/pdf"]),
};

export function isAllowedMime(entityType: string, mimeType: string): boolean {
  const allowed =
    ALLOWED_MIME_BY_ENTITY_TYPE[entityType] ??
    ALLOWED_MIME_BY_ENTITY_TYPE["DEFAULT"]!;
  return allowed.has(mimeType);
}

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

// ── Quota check (pure, exported for tests) ───────────────────────────────────
export type QuotaCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Pure quota check. `usedBytes` = bytes already stored; `limitBytes` = cap.
 * Exported so it can be unit-tested without a DB.
 */
export function checkQuota(usedBytes: bigint | number, limitBytes: bigint | number): QuotaCheckResult {
  const used = BigInt(usedBytes);
  const limit = BigInt(limitBytes);
  if (used < limit) return { ok: true };

  const limitGb = Math.round(Number(limit) / (1024 * 1024 * 1024));
  return {
    ok: false,
    message: `Storage quota exceeded — this practice has used its ${limitGb} GB evidence storage quota. Delete older files to free space, or contact support to raise the limit.`,
  };
}

/** Sum fileSizeBytes for all non-deleted Evidence rows in a practice. */
async function getPracticeStorageUsed(practiceId: string): Promise<bigint> {
  const result = await db.evidence.aggregate({
    where: { practiceId, status: { not: "DELETED" } },
    _sum: { fileSizeBytes: true },
  });
  return BigInt(result._sum.fileSizeBytes ?? 0);
}

// ── Upload ────────────────────────────────────────────────────────────────────

export interface RequestUploadArgs {
  practiceId: string;
  practiceUserId: string; // PracticeUser.id (not User.id)
  actorUserId: string;    // User.id — for event log actorUserId
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
 * Step 1 of 3: validates the file metadata, checks quota, builds the GCS key,
 * issues a 15-minute signed PUT URL, emits EVIDENCE_UPLOAD_REQUESTED (creates
 * the Evidence row with status=PENDING), and returns the signed URL to the client.
 *
 * In dev (GCS_EVIDENCE_BUCKET unset) the signed URL is null — the client
 * should skip the PUT and call confirmUpload so the row still gets created
 * for UI testing.
 */
export async function requestUpload(
  args: RequestUploadArgs,
): Promise<RequestUploadResult> {
  // Validate content-type against per-entityType allowlist
  if (!isAllowedMime(args.entityType, args.mimeType)) {
    const allowed =
      ALLOWED_MIME_BY_ENTITY_TYPE[args.entityType] ??
      ALLOWED_MIME_BY_ENTITY_TYPE["DEFAULT"]!;
    throw new Error(
      `File type "${args.mimeType}" is not allowed for ${args.entityType}. Accepted: ${[...allowed].join(", ")}`,
    );
  }

  if (args.fileSizeBytes > MAX_BYTES) {
    throw new Error(
      `File too large: ${args.fileSizeBytes} bytes (max ${MAX_BYTES / 1024 / 1024} MB)`,
    );
  }

  // Quota check — look up per-practice limit (Practice.storageQuotaBytes || env default)
  const practice = await db.practice.findUnique({
    where: { id: args.practiceId },
    select: { storageQuotaBytes: true },
  });
  const limit: bigint =
    practice?.storageQuotaBytes != null
      ? BigInt(practice.storageQuotaBytes)
      : getDefaultQuota();
  const used = await getPracticeStorageUsed(args.practiceId);
  const quotaResult = checkQuota(used + BigInt(args.fileSizeBytes), limit);
  if (!quotaResult.ok) {
    throw new Error(quotaResult.message);
  }

  const evidenceId = randomUUID();
  const gcsKey = buildEvidenceKey({
    practiceId: args.practiceId,
    entityType: args.entityType,
    entityId: args.entityId,
    fileName: args.fileName,
    evidenceId,
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
    expiresInSec: 900, // 15 minutes
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
  if (ev.status === "PENDING") {
    throw new Error("Upload not yet completed");
  }
  if (ev.status === "DELETED") {
    throw new Error("Evidence has been deleted");
  }

  const signed = await getSignedDownloadUrl(ev.gcsKey);
  return { url: signed.url, fileName: ev.fileName, reason: signed.reason };
}

/**
 * Soft-delete: flips status to DELETED + best-effort deletes the GCS object.
 * GCS lifecycle policy (30-day hard-delete) provides a safety net if the
 * object delete fails. The reaper cron also sweeps after 30 days.
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

  // Best-effort GCS delete; lifecycle rule + reaper cron clean up if this fails.
  await deleteFile(ev.gcsKey).catch(() => {});
}
