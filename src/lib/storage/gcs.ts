// src/lib/storage/gcs.ts
//
// Thin wrapper around @google-cloud/storage. Lazy singleton + dev no-op
// fallback when GCS_EVIDENCE_BUCKET is unset (matches v1's pattern from
// D:/GuardWell/guardwell/src/lib/storage.ts).

import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.GCS_EVIDENCE_BUCKET;

let _storage: Storage | null = null;

function getClient(): Storage | null {
  if (_storage) return _storage;
  if (!BUCKET) return null;
  _storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? {} // Cloud Run uses the SA automatically via ADC
      : process.env.GCP_KEY_FILE
        ? { keyFilename: process.env.GCP_KEY_FILE }
        : {}),
  });
  return _storage;
}

export interface SignedUrlResult {
  url: string | null;
  reason?: string;
}

/**
 * Sanitize a user-supplied filename before embedding it in a GCS key.
 * - Strips path traversal (`..` sequences and leading slashes).
 * - Replaces any character outside [A-Za-z0-9._-] with `_`.
 * - Trims to 255 characters.
 * - Falls back to "file" if the result is empty.
 */
export function sanitizeFileName(raw: string): string {
  // Remove path separators and traversal sequences
  let name = raw
    .replace(/\.\./g, "")     // strip ".." wherever it appears
    .replace(/[/\\]/g, "_");  // replace slashes with underscore

  // Replace anything not in the allowlist
  name = name.replace(/[^A-Za-z0-9._-]/g, "_");

  // Trim to 255 chars
  name = name.slice(0, 255);

  // Guarantee non-empty
  return name.length > 0 ? name : "file";
}

/**
 * Issue a 15-minute signed PUT URL the client uses to upload directly
 * to GCS. Returns { url: null, reason } in dev when the bucket isn't
 * configured so dev flows can no-op gracefully.
 *
 * TTL = 15 min per master roadmap Phase 3 spec (upload takes longer
 * than a download; 5-min TTL caused timeouts on large PDFs in v1).
 */
export async function getSignedUploadUrl(
  storageKey: string,
  contentType: string,
): Promise<SignedUrlResult> {
  const client = getClient();
  if (!client || !BUCKET) {
    return { url: null, reason: "GCS_EVIDENCE_BUCKET unset (dev no-op)" };
  }
  const [url] = await client
    .bucket(BUCKET)
    .file(storageKey)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
    });
  return { url };
}

/**
 * Issue a 5-minute signed GET URL for downloads. Returns { url: null, reason }
 * in dev when the bucket isn't configured.
 */
export async function getSignedDownloadUrl(
  storageKey: string,
): Promise<SignedUrlResult> {
  const client = getClient();
  if (!client || !BUCKET) {
    return { url: null, reason: "GCS_EVIDENCE_BUCKET unset (dev no-op)" };
  }
  const [url] = await client
    .bucket(BUCKET)
    .file(storageKey)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
  return { url };
}

/** Delete a GCS object (best-effort, ignores 404). No-op in dev. */
export async function deleteFile(storageKey: string): Promise<void> {
  const client = getClient();
  if (!client || !BUCKET) return;
  await client
    .bucket(BUCKET)
    .file(storageKey)
    .delete({ ignoreNotFound: true });
}

/** Build the canonical GCS key path for an Evidence row.
 *
 * Object naming: practices/<practiceId>/<entityType>/<entityId>/<evidenceId[0:12]>-<sanitizedFileName>
 * The practiceId prefix is the primary cross-tenant isolation boundary.
 */
export function buildEvidenceKey(args: {
  practiceId: string;
  entityType: string;
  entityId: string;
  fileName: string;
  evidenceId: string;
}): string {
  const safe = sanitizeFileName(args.fileName);
  return `practices/${args.practiceId}/${args.entityType}/${args.entityId}/${args.evidenceId.slice(0, 12)}-${safe}`;
}
