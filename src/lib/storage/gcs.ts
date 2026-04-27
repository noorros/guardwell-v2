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
 * Issue a 5-minute signed PUT URL the client uses to upload directly
 * to GCS. Returns { url: null, reason } in dev when the bucket isn't
 * configured so dev flows can no-op gracefully.
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
      expires: Date.now() + 5 * 60 * 1000,
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
      expires: Date.now() + 5 * 60 * 1000,
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

/** Build the canonical GCS key path for an Evidence row. */
export function buildEvidenceKey(args: {
  practiceId: string;
  entityType: string;
  entityId: string;
  fileName: string;
}): string {
  const sanitized = args.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const cuidPrefix = Math.random().toString(36).slice(2, 12);
  return `practices/${args.practiceId}/${args.entityType}/${args.entityId}/${cuidPrefix}-${sanitized}`;
}
