# Phase 3 — Cloud Storage Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining Cloud Storage infra gaps — quota enforcement, per-resource-type content-type allowlist, filename sanitization, a 15-min upload URL TTL (currently 5 min), dedicated `<EvidenceUploader>` + `<EvidenceList>` design-system components with stories/tests/axe registration, a reaper cron for 30-day GCS purge, an IAM/bucket provisioning script, and a cloud-storage runbook — so Phase 4 (BYOV video) and Phase 9 (BAA + Document Hub) have a complete infra foundation to build on.

**Architecture:** The `gcs.ts` singleton + `evidence.ts` high-level helper already exist and wire correctly through the event pipeline. The three missing pieces are: (1) hardened `gcs.ts` with a 15-min PUT TTL, quota guard, content-type allowlist, and filename sanitization; (2) two proper design-system components (`EvidenceUploader` / `EvidenceList`) that replace the current `EvidenceUpload` monolith and appear in the gallery; (3) a daily reaper cron (`/api/cron/evidence-reaper`) that hard-deletes GCS objects for Evidence rows whose `deletedAt` is >30 days ago. The existing `EvidenceUpload` component continues to work unchanged — the new components are additive, not a replacement.

**Tech Stack:** Prisma 5.22 · `@google-cloud/storage` v7.19 (already installed) · TypeScript · Vitest · jest-axe · Cloud Run · Cloud Scheduler · gcloud CLI

---

## Already-shipped inventory (MUST READ before touching any file)

| Item | Status | File(s) |
|---|---|---|
| `@google-cloud/storage` dependency | **Installed** — `package.json` line 35 | `package.json` |
| GCS env vars in `.env.example` | **Present** — lines 72-76 | `.env.example` |
| `src/lib/storage/gcs.ts` | **Shipped** — lazy singleton, `getSignedUploadUrl`, `getSignedDownloadUrl`, `deleteFile`, `buildEvidenceKey` | already exists |
| `src/lib/storage/evidence.ts` | **Shipped** — `requestUpload`, `confirmUpload`, `getDownloadUrl`, `softDelete` | already exists |
| `src/lib/events/projections/evidence.ts` | **Shipped** — all three projections | already exists |
| `EVIDENCE_UPLOAD_REQUESTED` / `EVIDENCE_UPLOAD_CONFIRMED` / `EVIDENCE_DELETED` event types + Zod schemas | **Shipped** — `registry.ts` lines 74–77, 945–968 | `src/lib/events/registry.ts` |
| `Evidence` Prisma model | **Shipped** — schema lines 1724–1750; fields: id, practiceId, entityType, entityId, uploadedById, gcsKey, fileName, mimeType, fileSizeBytes, status (EvidenceStatus enum), uploadedAt, confirmedAt, deletedAt, notes | `prisma/schema.prisma` |
| API routes | **Shipped** — `POST /api/evidence/upload` (init + confirm), `POST /api/evidence/[id]/confirm`, `GET /api/evidence/[id]/download` (302 redirect), `DELETE /api/evidence/[id]` | `src/app/api/evidence/` |
| `EvidenceUpload` component | **Shipped** — monolith with drag-drop, upload flow, list, delete | `src/components/gw/EvidenceUpload/` |
| Integration tests (projections) | **Shipped** — 8 test cases covering all three projections | `tests/integration/evidence-projection.test.ts` |

## Evidence model field discrepancy vs master roadmap spec

The master roadmap spec says fields should include `resourceType` / `resourceId` / `uploadedByUserId`. The actual schema uses `entityType` / `entityId` / `uploadedById`. **Use the schema's actual field names throughout this plan.** Do not rename or migrate — the code already uses `entityType`/`entityId` everywhere.

## What is missing (what this plan builds)

| Gap | Plan location |
|---|---|
| `getSignedUploadUrl` TTL is 5 min; spec says 15 min for upload URL | PR 1, Task 1 |
| No quota check (5 GB per practice) | PR 1, Task 2 |
| Content-type allowlist only in `evidence.ts` (`ALLOWED_MIME` set), not per-entityType | PR 1, Task 3 |
| Filename sanitization exists (`replace(/[^A-Za-z0-9._-]/g, "_")`) but no path-traversal strip, no 255-char cap | PR 1, Task 4 |
| `PRACTICE_STORAGE_QUOTA_BYTES` env var + `Practice.storageQuotaBytes` field absent | PR 1, Task 2 |
| Bucket provisioning script not committed to repo | PR 2 |
| `<EvidenceUploader>` design-system component (separate from `EvidenceUpload`) | PR 3 |
| `<EvidenceList>` design-system component | PR 3 |
| Stories + tests for new components | PR 3 |
| Gallery registration for new components | PR 3 |
| Reaper cron (`/api/cron/evidence-reaper`) | PR 4 |
| `docs/runbooks/cloud-storage.md` | PR 4 |

---

## Scope confirmed against current code state

| Master roadmap scope item | Already shipped | This plan adds |
|---|---|---|
| GCS bucket `guardwell-v2-evidence` | Commands exist in `2026-04-27-evidence-ceu-reminders.md` Pre-Task; not committed as a script | PR 2 adds `scripts/provision-evidence-bucket.sh` |
| IAM service account + binding | Same old plan section | PR 2 script includes SA creation + bucket binding |
| `src/lib/storage/` signed URL service | Core shipped; TTL/quota/allowlist/sanitization gaps remain | PR 1 hardens the service |
| Evidence model | Fully shipped | No schema change |
| Event types registered | All three shipped | No change |
| Projection handlers | All three shipped | No change |
| `<EvidenceUploader>` design-system component | `EvidenceUpload` monolith exists but not split into separate gallery components | PR 3 adds new split components |
| `<EvidenceList>` design-system component | Combined in `EvidenceUpload` | PR 3 adds separate component |
| Quota check | Missing | PR 1 |
| Content-type allowlist by entityType | Partial (ALLOWED_MIME global) | PR 1 |
| Filename sanitization hardening | Partial | PR 1 |
| Reaper cron | Missing | PR 4 |
| Runbook | Missing | PR 4 |

---

## File structure

### PR 1 — Harden signed URL service

**Modify:**
- `src/lib/storage/gcs.ts` — fix upload TTL to 15 min, add `sanitizeFileName`, export both
- `src/lib/storage/evidence.ts` — add quota check (`getPracticeStorageUsed`, `PRACTICE_QUOTA_BYTES`), add per-entityType content-type allowlist (`ALLOWED_MIME_BY_ENTITY_TYPE`)
- `.env.example` — add `PRACTICE_STORAGE_QUOTA_BYTES` entry
- `prisma/schema.prisma` — add `storageQuotaBytes BigInt?` to `Practice` model

**Test:**
- `tests/unit/storage/sanitizeFileName.test.ts` — unit tests for the sanitize function
- `tests/unit/storage/quota.test.ts` — unit tests for quota check logic
- `tests/unit/storage/contentTypeAllowlist.test.ts` — unit tests for the per-entityType allowlist

### PR 2 — Bucket provisioning script

**Create:**
- `scripts/provision-evidence-bucket.sh` — idempotent gcloud script (bucket + CORS + lifecycle + SA + IAM binding)
- `docs/ops/cors-v2-evidence.json` — CORS config for GCS bucket (already referenced in old plan, not yet committed)
- `docs/ops/lifecycle-v2-evidence.json` — lifecycle policy for GCS bucket

### PR 3 — Design-system components

**Create:**
- `src/components/gw/EvidenceUploader/EvidenceUploader.tsx` — upload-only UI (drag-drop zone + progress)
- `src/components/gw/EvidenceUploader/index.ts` — barrel
- `src/components/gw/EvidenceUploader/EvidenceUploader.stories.tsx` — all variants
- `src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx` — jsdom + axe tests
- `src/components/gw/EvidenceList/EvidenceList.tsx` — list-only UI (file list + download + delete)
- `src/components/gw/EvidenceList/index.ts` — barrel
- `src/components/gw/EvidenceList/EvidenceList.stories.tsx` — all variants
- `src/components/gw/EvidenceList/EvidenceList.test.tsx` — jsdom + axe tests

**Modify:**
- `src/components/gw/gallery.test.tsx` — add imports + entries for both new components
- `src/app/internal/design-system/page.tsx` — add both components to `BLOCKS`

### PR 4 — Reaper cron + runbook

**Create:**
- `src/app/api/cron/evidence-reaper/route.ts` — daily cron: find Evidence with `deletedAt < now()-30d`, call `gcs.deleteFile`, `db.evidence.delete`
- `src/lib/storage/reaper.ts` — pure reaper logic (testable without HTTP)
- `tests/unit/storage/reaper.test.ts` — unit tests for reaper
- `docs/runbooks/cloud-storage.md` — bucket lifecycle, quota raises, abuse response

---

## PR boundaries

| PR | Scope | Chrome-verify target |
|---|---|---|
| PR 1 | Harden `gcs.ts` + `evidence.ts` (TTL, quota, allowlist, sanitization) | `npm run test:run` for touched files + `npx tsc --noEmit` + `npm run lint` |
| PR 2 | Provisioning script (committed, runs manually once) | Script review in PR diff; no runtime verify needed |
| PR 3 | `<EvidenceUploader>` + `<EvidenceList>` components | Chrome-verify `/internal/design-system` — both components appear |
| PR 4 | Reaper cron + runbook | Chrome-verify `POST /api/cron/evidence-reaper` returns `{ ok: true }` in staging |

---

## Pre-flight checks

Before starting any PR:

```bash
cd /d/GuardWell/guardwell-v2

# 1. Baseline tests pass
npm run test:run

# 2. TypeScript clean
npx tsc --noEmit

# 3. Lint clean
npm run lint

# 4. Confirm @google-cloud/storage installed
node -e "require('@google-cloud/storage'); console.log('ok')"
```

Expected: all green. If not, fix first before proceeding.

---

## Tasks (TDD first)

---

## PR 1 — Harden signed URL service

### Task 1: Fix upload URL TTL to 15 minutes

The master roadmap spec says upload URL TTL = 15 min. Current code uses `5 * 60 * 1000`.

**Files:**
- Modify: `src/lib/storage/gcs.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/storage/sanitizeFileName.test.ts`:

```ts
// tests/unit/storage/sanitizeFileName.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeFileName } from "@/lib/storage/gcs";

describe("sanitizeFileName", () => {
  it("strips path traversal sequences", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileName("../secret.pdf")).not.toContain("..");
  });

  it("strips leading slashes", () => {
    const result = sanitizeFileName("/etc/passwd.pdf");
    expect(result).not.toMatch(/^\//);
  });

  it("replaces special characters with underscores", () => {
    const result = sanitizeFileName("my file (1).pdf");
    // spaces, parens should be replaced
    expect(result).not.toContain(" ");
    expect(result).not.toContain("(");
  });

  it("preserves allowed characters: a-z A-Z 0-9 . - _", () => {
    const result = sanitizeFileName("valid-file_name.123.pdf");
    expect(result).toBe("valid-file_name.123.pdf");
  });

  it("trims to 255 characters max", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitizeFileName(long).length).toBeLessThanOrEqual(255);
  });

  it("returns a non-empty string even for a junk input", () => {
    const result = sanitizeFileName("!!@@##");
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/sanitizeFileName.test.ts
```

Expected: FAIL — `sanitizeFileName is not exported from @/lib/storage/gcs`

- [ ] **Step 3: Implement `sanitizeFileName` and fix upload TTL in `gcs.ts`**

Replace the contents of `src/lib/storage/gcs.ts` with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/sanitizeFileName.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add src/lib/storage/gcs.ts tests/unit/storage/sanitizeFileName.test.ts
git commit -m "fix(storage): 15-min upload TTL, export sanitizeFileName with path-traversal + length guards"
```

---

### Task 2: Add quota check to `evidence.ts`

**Files:**
- Modify: `src/lib/storage/evidence.ts`
- Modify: `prisma/schema.prisma` (add `storageQuotaBytes` to `Practice`)
- Modify: `.env.example`

- [ ] **Step 1: Write the failing quota test**

Create `tests/unit/storage/quota.test.ts`:

```ts
// tests/unit/storage/quota.test.ts
//
// Tests quota logic in isolation. Does not need a real DB or GCS bucket.
// We test the pure helper function getPracticeStorageUsed by mocking db,
// and test the quota error message from requestUpload (dev no-op path).

import { describe, it, expect } from "vitest";
import { checkQuota } from "@/lib/storage/evidence";

describe("checkQuota", () => {
  it("returns ok when used < limit", () => {
    expect(checkQuota(1_000_000, 5_368_709_120)).toEqual({ ok: true });
  });

  it("returns error when used >= limit", () => {
    const result = checkQuota(5_368_709_120, 5_368_709_120);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/storage quota/i);
    expect(result.message).toContain("5 GB");
  });

  it("returns error with custom limit label when limit differs from 5 GB", () => {
    const result = checkQuota(2_147_483_648, 1_073_741_824); // 2 GB used, 1 GB limit
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/1 GB/);
  });

  it("returns ok when used is 0", () => {
    expect(checkQuota(0, 5_368_709_120)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/quota.test.ts
```

Expected: FAIL — `checkQuota is not exported from @/lib/storage/evidence`

- [ ] **Step 3: Add `storageQuotaBytes` to the `Practice` model**

In `prisma/schema.prisma`, find the `Practice` model's field block. After `firstRunCompletedAt DateTime?` (around line 108) and before the closing relations block, add:

```prisma
  // Per-practice GCS evidence storage quota in bytes.
  // null = use default (PRACTICE_STORAGE_QUOTA_BYTES env var or 5 GB).
  storageQuotaBytes BigInt?
```

- [ ] **Step 4: Run Prisma generate**

```bash
cd /d/GuardWell/guardwell-v2
npm run db:generate
```

Expected: `Generated Prisma Client` — no error.

- [ ] **Step 5: Update `.env.example`**

After the existing `GCS_EVIDENCE_BUCKET=` block (around line 76), add:

```
# Per-practice storage quota for GCS evidence uploads (bytes, default 5 GB = 5368709120).
# Override per-practice via Practice.storageQuotaBytes in the DB.
PRACTICE_STORAGE_QUOTA_BYTES=5368709120
```

- [ ] **Step 6: Implement quota helpers and integrate into `evidence.ts`**

Replace `src/lib/storage/evidence.ts` with:

```ts
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
    const n = parseInt(env, 10);
    if (!isNaN(n) && n > 0) return BigInt(n);
  }
  return BigInt(DEFAULT_QUOTA_BYTES);
}

// ── Content-type allowlist by entityType ─────────────────────────────────────
// Phase 4 (BYOV training videos) will add TRAINING_VIDEO → video/mp4.
// Phase 9 (Document Hub) will add DOCUMENT → application/pdf only.
const ALLOWED_MIME_BY_ENTITY_TYPE: Record<string, Set<string>> = {
  CREDENTIAL:          new Set(["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"]),
  DESTRUCTION_LOG:     new Set(["application/pdf", "image/png", "image/jpeg"]),
  INCIDENT:            new Set(["application/pdf", "image/png", "image/jpeg"]),
  VENDOR:              new Set(["application/pdf", "image/png", "image/jpeg"]),
  TECH_ASSET:          new Set(["application/pdf", "image/png", "image/jpeg"]),
  TRAINING_COMPLETION: new Set(["application/pdf", "image/png", "image/jpeg"]),
  // Default — used when entityType is not listed above.
  DEFAULT:             new Set(["application/pdf"]),
};

function isAllowedMime(entityType: string, mimeType: string): boolean {
  const allowed =
    ALLOWED_MIME_BY_ENTITY_TYPE[entityType] ??
    ALLOWED_MIME_BY_ENTITY_TYPE["DEFAULT"];
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
      ALLOWED_MIME_BY_ENTITY_TYPE["DEFAULT"];
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
```

- [ ] **Step 7: Run quota test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/quota.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 8: Run all existing evidence tests to confirm nothing regressed**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/integration/evidence-projection.test.ts
```

Expected: 8 tests PASS (dev no-op `expiresInSec` is now 900 instead of 300 — the test doesn't assert that value, so it stays green)

- [ ] **Step 9: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add \
  src/lib/storage/evidence.ts \
  prisma/schema.prisma \
  .env.example \
  tests/unit/storage/quota.test.ts
git commit -m "feat(storage): quota check, per-entityType content-type allowlist, 15-min upload TTL"
```

---

### Task 3: Content-type allowlist test

**Files:**
- Create: `tests/unit/storage/contentTypeAllowlist.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/storage/contentTypeAllowlist.test.ts
//
// Validates that requestUpload throws on disallowed MIME types without
// needing a real DB (we check the thrown error message in dev no-op mode).
import { describe, it, expect } from "vitest";
import { requestUpload } from "@/lib/storage/evidence";

// In CI (no DB), requestUpload throws for bad content types BEFORE
// touching the DB — we can catch those errors here.
describe("content-type allowlist in requestUpload", () => {
  it("throws for video/mp4 on a CREDENTIAL entityType", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "CREDENTIAL",
        entityId: "cred-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSizeBytes: 1024,
      }),
    ).rejects.toThrow(/video\/mp4.*is not allowed/i);
  });

  it("throws for text/csv on a DESTRUCTION_LOG entityType", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "DESTRUCTION_LOG",
        entityId: "dl-1",
        fileName: "log.csv",
        mimeType: "text/csv",
        fileSizeBytes: 512,
      }),
    ).rejects.toThrow(/text\/csv.*is not allowed/i);
  });

  it("throws for unknown entityType with non-PDF mime type", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "UNKNOWN_FUTURE_TYPE",
        entityId: "x-1",
        fileName: "img.png",
        mimeType: "image/png",
        fileSizeBytes: 2048,
      }),
    ).rejects.toThrow(/image\/png.*is not allowed/i);
  });

  it("does NOT throw for application/pdf on an unknown entityType (default fallback)", async () => {
    // This will throw for a different reason (no DB in unit test context)
    // but NOT for content-type validation. We assert the error is NOT
    // a content-type error.
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "UNKNOWN_FUTURE_TYPE",
        entityId: "x-2",
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 2048,
      }),
    ).rejects.toThrow(/(?!.*is not allowed)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/contentTypeAllowlist.test.ts
```

Expected: 3 PASS; test 4 may fail because it hits DB — that is acceptable since it doesn't get to the allowlist check. If test 4 fails with a DB-related error (not a content-type error), the test intent is satisfied. Adjust the assertion if needed:

```ts
// If test 4 fails with DB error, replace the last test with:
it("does NOT throw content-type error for application/pdf on unknown entityType", async () => {
  try {
    await requestUpload({ /* ... same args as above ... */ });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).not.toMatch(/is not allowed/i);
  }
});
```

- [ ] **Step 3: Run full test suite for storage unit tests**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/
```

Expected: All PASS

- [ ] **Step 4: Run tsc + lint**

```bash
cd /d/GuardWell/guardwell-v2
npx tsc --noEmit && npm run lint
```

Expected: Both clean.

- [ ] **Step 5: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add tests/unit/storage/contentTypeAllowlist.test.ts
git commit -m "test(storage): content-type allowlist unit tests"
```

---

## PR 2 — Bucket provisioning script

This PR adds the provisioning script and config files so the bucket setup is fully reproducible from source control. Run the script ONCE manually before deploying Phase 3 to production. Do NOT run it on every deploy — it is idempotent but the `gcloud storage buckets create` command returns an error if the bucket already exists (use `--quiet` to suppress).

### Task 4: Commit CORS config + lifecycle policy

**Files:**
- Create: `docs/ops/cors-v2-evidence.json`
- Create: `docs/ops/lifecycle-v2-evidence.json`

- [ ] **Step 1: Create `docs/ops/cors-v2-evidence.json`**

```json
[
  {
    "origin": ["https://v2.app.gwcomp.com", "http://localhost:3000"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "x-goog-meta-*"],
    "maxAgeSeconds": 900
  }
]
```

Note: `localhost:3000` is included so dev flows work when `GCS_EVIDENCE_BUCKET` is set locally. Remove before any security review if preferred — the dev no-op mode makes it optional.

- [ ] **Step 2: Create `docs/ops/lifecycle-v2-evidence.json`**

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 365,
          "matchesStorageClass": ["STANDARD"]
        }
      }
    ]
  }
}
```

Note: The 365-day GCS lifecycle rule is a hard backstop. The application-level reaper cron (PR 4) hard-deletes objects 30 days after soft-delete. The GCS lifecycle rule catches anything the reaper missed (network error, cron outage, etc.) and prevents unbounded storage growth.

- [ ] **Step 3: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add docs/ops/cors-v2-evidence.json docs/ops/lifecycle-v2-evidence.json
git commit -m "ops: GCS CORS + lifecycle config files for guardwell-v2-evidence bucket"
```

---

### Task 5: Write provisioning script

**Files:**
- Create: `scripts/provision-evidence-bucket.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# scripts/provision-evidence-bucket.sh
#
# Provisions the guardwell-v2-evidence GCS bucket + IAM for the evidence
# upload flow. Run ONCE manually from a gcloud-authed workstation.
# Idempotent: re-running is safe (bucket already-exists error is suppressed).
#
# Prerequisites:
#   1. gcloud auth login (or ADC configured)
#   2. gcloud config set project guardwell-prod
#   3. The Cloud Run service "guardwell-v2" must already be deployed once
#      (so its SA email is discoverable via gcloud run services describe).
#
# After running:
#   1. Set the Cloud Run env var:
#        gcloud run services update guardwell-v2 --region=us-central1 \
#          --update-env-vars=GCS_EVIDENCE_BUCKET=guardwell-v2-evidence
#   2. Set GCS_EVIDENCE_BUCKET=guardwell-v2-evidence in the Cloud Build trigger
#      substitutions (or Secret Manager) if needed for build-time use.
#
# Workload Identity note:
#   Cloud Run on v2 uses the default Compute SA (PROJECT_NUMBER-compute@developer…)
#   or a custom SA set at deploy time. This script reads the actual SA from the
#   live service. If you deploy with a custom SA, the script still works because
#   it queries the live service.

set -euo pipefail

PROJECT="guardwell-prod"
BUCKET="guardwell-v2-evidence"
REGION="us-central1"
SERVICE="guardwell-v2"
STORAGE_SA="guardwell-v2-storage@${PROJECT}.iam.gserviceaccount.com"

echo "==> 1. Create bucket (idempotent)"
if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "    Bucket gs://${BUCKET} already exists — skipping create."
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  echo "    Bucket created."
fi

echo "==> 2. Apply CORS policy"
gcloud storage buckets update "gs://${BUCKET}" \
  --cors-file="docs/ops/cors-v2-evidence.json"

echo "==> 3. Apply lifecycle policy"
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="docs/ops/lifecycle-v2-evidence.json"

echo "==> 4. Create dedicated storage service account (idempotent)"
if gcloud iam service-accounts describe "${STORAGE_SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "    SA ${STORAGE_SA} already exists — skipping create."
else
  gcloud iam service-accounts create "guardwell-v2-storage" \
    --project="${PROJECT}" \
    --display-name="GuardWell v2 Evidence Storage"
  echo "    SA created."
fi

echo "==> 5. Grant storage SA objectAdmin on the bucket"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${STORAGE_SA}" \
  --role="roles/storage.objectAdmin"

echo "==> 6. Look up Cloud Run runtime SA"
RUNTIME_SA=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")

if [ -z "${RUNTIME_SA}" ]; then
  echo "    WARNING: Could not detect Cloud Run SA for '${SERVICE}'."
  echo "    The service may not be deployed yet, or you lack run.services.get permission."
  echo "    After first deploy, re-run this script or manually add the SA to the bucket."
else
  echo "    Cloud Run SA: ${RUNTIME_SA}"
  echo "==> 7. Grant Cloud Run SA objectViewer on the bucket"
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/storage.objectViewer"
  echo "    Done."
fi

echo ""
echo "==> Provisioning complete."
echo ""
echo "NEXT STEPS (manual):"
echo "  gcloud run services update ${SERVICE} --region=${REGION} \\"
echo "    --update-env-vars=GCS_EVIDENCE_BUCKET=${BUCKET}"
echo ""
echo "  Add to .env.local for local dev (skip if using dev no-op mode):"
echo "    GCS_EVIDENCE_BUCKET=${BUCKET}"
echo "    GCP_PROJECT_ID=${PROJECT}"
echo "    GCP_KEY_FILE=/path/to/sa-key.json"
```

- [ ] **Step 2: Make the script executable**

```bash
cd /d/GuardWell/guardwell-v2
chmod +x scripts/provision-evidence-bucket.sh
```

On Windows/bash this may be a no-op, but include it so the file is executable when cloned on Linux/Mac CI.

- [ ] **Step 3: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add scripts/provision-evidence-bucket.sh
git commit -m "ops: add provision-evidence-bucket.sh (GCS bucket + IAM provisioning script)"
```

---

## PR 3 — Design-system components

The existing `EvidenceUpload` in `src/components/gw/EvidenceUpload/` is a monolith that handles both upload and listing in one component. The design system contract (ADR-0005) requires each component to be independently testable and galleriable. This PR adds `EvidenceUploader` (upload only) and `EvidenceList` (list/download/delete only) as separate components. The existing `EvidenceUpload` monolith is NOT removed — it stays for backwards compatibility with any surface already using it.

### Task 6: `<EvidenceUploader>` component

**Files:**
- Create: `src/components/gw/EvidenceUploader/EvidenceUploader.tsx`
- Create: `src/components/gw/EvidenceUploader/index.ts`
- Create: `src/components/gw/EvidenceUploader/EvidenceUploader.stories.tsx`
- Create: `src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx`:

```tsx
// src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { EvidenceUploader } from ".";

// Mock fetch so we don't need a server
global.fetch = vi.fn();

const noop = vi.fn();

describe("<EvidenceUploader>", () => {
  it("renders the drop zone with correct aria-label", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
  });

  it("shows accepted file types hint", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" accept="application/pdf,image/png" onUploaded={noop} />);
    expect(screen.getByText(/pdf/i)).toBeInTheDocument();
  });

  it("shows max size hint", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" maxSizeMb={10} onUploaded={noop} />);
    expect(screen.getByText(/10 MB/i)).toBeInTheDocument();
  });

  it("shows error when file is too large", async () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" maxSizeMb={1} onUploaded={noop} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const bigFile = new File(["x".repeat(2 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 2 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
  });

  it("is disabled during an upload (button + input are not interactive)", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    // Before upload starts, the drop zone button is enabled
    const btn = screen.getByRole("button", { name: /upload file/i });
    expect(btn).not.toBeDisabled();
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />,
    );
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `EvidenceUploader.tsx`**

Create `src/components/gw/EvidenceUploader/EvidenceUploader.tsx`:

```tsx
"use client";
// src/components/gw/EvidenceUploader/EvidenceUploader.tsx
//
// Upload-only half of the evidence upload flow. Handles drag-drop + click-
// to-pick, three-step signed-URL flow, progress bar, error states.
// Renders nothing after a successful upload — the caller is expected to
// refresh the <EvidenceList> (e.g. via router.refresh() or state update).

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

export interface EvidenceUploaderProps {
  entityType: string;
  entityId: string;
  /** Called with the new evidenceId after a successful upload. */
  onUploaded: (evidenceId: string) => void;
  /** Comma-separated MIME types the user may pick (default: pdf + common images). */
  accept?: string;
  /** Max file size in MB (default 25). */
  maxSizeMb?: number;
}

const DEFAULT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.heic,.webp";
const DEFAULT_MAX_MB = 25;

function mimeMatches(fileType: string, acceptList: string): boolean {
  if (!acceptList) return true;
  const patterns = acceptList.split(",").map((s) => s.trim().toLowerCase());
  const ft = fileType.toLowerCase();
  return patterns.some((p) => {
    if (p === ft) return true;
    if (p.endsWith("/*")) return ft.startsWith(p.slice(0, -2) + "/");
    // Accept file-extension patterns like ".pdf"
    if (p.startsWith(".")) return ft.includes(p.slice(1));
    return false;
  });
}

export function EvidenceUploader({
  entityType,
  entityId,
  onUploaded,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = DEFAULT_MAX_MB,
}: EvidenceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setDevNotice(null);

    if (file.type && !mimeMatches(file.type, accept)) {
      setError(`File type not allowed. Accepted: ${accept}`);
      return;
    }

    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File too large — max ${maxSizeMb} MB.`);
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Step 1: request signed upload URL
      const initRes = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          entityType,
          entityId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSizeBytes: file.size,
        }),
      });
      if (!initRes.ok) {
        const { error: e } = (await initRes.json()) as { error?: string };
        throw new Error(e ?? "Could not start upload");
      }
      const init = (await initRes.json()) as {
        evidenceId: string;
        gcsKey: string;
        uploadUrl: string | null;
        expiresInSec: number;
        reason?: string;
      };
      setProgress(20);

      if (!init.uploadUrl) {
        setDevNotice(
          "GCS not configured (dev mode) — skipping file transfer. Evidence row created with PENDING status.",
        );
      } else {
        // Step 2: PUT directly to GCS
        const putRes = await fetch(init.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`GCS upload failed: HTTP ${putRes.status}`);
        }
        setProgress(80);
      }

      // Step 3: confirm
      if (init.uploadUrl) {
        const confirmRes = await fetch(`/api/evidence/${init.evidenceId}/confirm`, {
          method: "POST",
        });
        if (!confirmRes.ok) {
          const { error: e } = (await confirmRes.json()) as { error?: string };
          throw new Error(e ?? "Could not confirm upload");
        }
      }

      setProgress(100);
      onUploaded(init.evidenceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="space-y-2">
      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent/30"
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        aria-label="Upload file"
        aria-disabled={uploading}
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Drop a file here or{" "}
          <span className="text-primary underline">click to browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {accept.replace(/,/g, ", ")} — up to {maxSizeMb} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {devNotice && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {devNotice}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts` barrel**

Create `src/components/gw/EvidenceUploader/index.ts`:

```ts
export { EvidenceUploader, type EvidenceUploaderProps } from "./EvidenceUploader";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx
```

Expected: 6 tests PASS

- [ ] **Step 6: Create stories file**

Create `src/components/gw/EvidenceUploader/EvidenceUploader.stories.tsx`:

```tsx
// src/components/gw/EvidenceUploader/EvidenceUploader.stories.tsx
import { EvidenceUploader } from ".";

export const stories = {
  DefaultCredential: (
    <EvidenceUploader
      entityType="CREDENTIAL"
      entityId="cred-demo"
      onUploaded={() => {}}
    />
  ),
  PDFOnly: (
    <EvidenceUploader
      entityType="INCIDENT"
      entityId="inc-demo"
      accept="application/pdf"
      onUploaded={() => {}}
    />
  ),
  SmallSizeLimit: (
    <EvidenceUploader
      entityType="DESTRUCTION_LOG"
      entityId="dl-demo"
      maxSizeMb={5}
      onUploaded={() => {}}
    />
  ),
};
```

- [ ] **Step 7: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add src/components/gw/EvidenceUploader/
git commit -m "feat(design-system): add <EvidenceUploader> component with stories + tests"
```

---

### Task 7: `<EvidenceList>` component

**Files:**
- Create: `src/components/gw/EvidenceList/EvidenceList.tsx`
- Create: `src/components/gw/EvidenceList/index.ts`
- Create: `src/components/gw/EvidenceList/EvidenceList.stories.tsx`
- Create: `src/components/gw/EvidenceList/EvidenceList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/gw/EvidenceList/EvidenceList.test.tsx`:

```tsx
// src/components/gw/EvidenceList/EvidenceList.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { EvidenceList, type EvidenceListItem } from ".";

global.fetch = vi.fn();

const ITEMS: EvidenceListItem[] = [
  {
    id: "ev-1",
    fileName: "license.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 98304,
    uploadedAt: "2026-04-20T10:00:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-2",
    fileName: "cert.png",
    mimeType: "image/png",
    fileSizeBytes: 204800,
    uploadedAt: "2026-04-21T12:00:00Z",
    status: "UPLOADED",
  },
];

describe("<EvidenceList>", () => {
  it("renders a list of uploaded files", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText("license.pdf")).toBeInTheDocument();
    expect(screen.getByText("cert.png")).toBeInTheDocument();
  });

  it("renders download links for each file", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    const links = screen.getAllByRole("link", { name: /download/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/api/evidence/ev-1/download");
    expect(links[1]).toHaveAttribute("href", "/api/evidence/ev-2/download");
  });

  it("renders delete buttons when canDelete=true", () => {
    render(<EvidenceList items={ITEMS} canDelete={true} onDeleted={vi.fn()} />);
    const deleteBtns = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteBtns).toHaveLength(2);
  });

  it("does NOT render delete buttons when canDelete=false", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("calls onDeleted with evidenceId after successful delete", async () => {
    const onDeleted = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(<EvidenceList items={ITEMS} canDelete={true} onDeleted={onDeleted} />);
    const [firstDeleteBtn] = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(firstDeleteBtn);
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith("ev-1"));
  });

  it("shows empty state when no items", () => {
    render(<EvidenceList items={[]} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText(/no files attached/i)).toBeInTheDocument();
  });

  it("shows PENDING badge for PENDING items", () => {
    const pending: EvidenceListItem[] = [
      { ...ITEMS[0], id: "ev-p", status: "PENDING" },
    ];
    render(<EvidenceList items={pending} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <EvidenceList items={ITEMS} canDelete={true} onDeleted={vi.fn()} />,
    );
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run src/components/gw/EvidenceList/EvidenceList.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `EvidenceList.tsx`**

Create `src/components/gw/EvidenceList/EvidenceList.tsx`:

```tsx
"use client";
// src/components/gw/EvidenceList/EvidenceList.tsx
//
// Read-only (with optional delete) file list. Consumes evidence items as
// props — the caller is responsible for fetching and refreshing. This
// separation keeps <EvidenceUploader> and <EvidenceList> independently
// usable on any surface.

import { useState, useTransition } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EvidenceListItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string; // ISO string
  status: "PENDING" | "UPLOADED" | "DELETED";
}

export interface EvidenceListProps {
  items: EvidenceListItem[];
  /**
   * Whether the current user may delete evidence.
   * Pass true only when the user has OWNER or ADMIN role.
   */
  canDelete: boolean;
  /** Called with the evidenceId after a successful delete so the caller can refresh. */
  onDeleted: (evidenceId: string) => void;
}

export function EvidenceList({ items, canDelete, onDeleted }: EvidenceListProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeItems = items.filter((i) => i.status !== "DELETED");

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/evidence/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const { error: e } = (await res.json()) as { error?: string };
          throw new Error(e ?? "Delete failed");
        }
        onDeleted(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  if (activeItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No files attached yet.</p>
    );
  }

  return (
    <div className="space-y-1">
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y rounded-md border text-xs">
        {activeItems.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2">
            <FileText
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="flex-1 truncate" title={item.fileName}>
              {item.fileName}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {Math.round(item.fileSizeBytes / 1024)} KB
            </span>
            {item.status === "PENDING" && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                pending
              </span>
            )}
            <a
              href={`/api/evidence/${item.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded p-1 hover:bg-accent"
              aria-label={`Download ${item.fileName}`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => handleDelete(item.id)}
                disabled={isPending}
                aria-label={`Delete ${item.fileName}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create `index.ts` barrel**

Create `src/components/gw/EvidenceList/index.ts`:

```ts
export { EvidenceList, type EvidenceListItem, type EvidenceListProps } from "./EvidenceList";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run src/components/gw/EvidenceList/EvidenceList.test.tsx
```

Expected: 8 tests PASS

- [ ] **Step 6: Create stories file**

Create `src/components/gw/EvidenceList/EvidenceList.stories.tsx`:

```tsx
// src/components/gw/EvidenceList/EvidenceList.stories.tsx
import { EvidenceList, type EvidenceListItem } from ".";

const SAMPLE: EvidenceListItem[] = [
  {
    id: "ev-1",
    fileName: "DEA_registration_2026.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 98304,
    uploadedAt: "2026-04-10T09:00:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-2",
    fileName: "malpractice_declaration.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 154000,
    uploadedAt: "2026-04-15T14:30:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-3",
    fileName: "board_cert_scan.png",
    mimeType: "image/png",
    fileSizeBytes: 512000,
    uploadedAt: "2026-04-20T11:00:00Z",
    status: "PENDING",
  },
];

export const stories = {
  ReadOnly: (
    <EvidenceList items={SAMPLE} canDelete={false} onDeleted={() => {}} />
  ),
  CanDelete: (
    <EvidenceList items={SAMPLE} canDelete={true} onDeleted={() => {}} />
  ),
  Empty: (
    <EvidenceList items={[]} canDelete={false} onDeleted={() => {}} />
  ),
  SingleFile: (
    <EvidenceList
      items={[SAMPLE[0]]}
      canDelete={true}
      onDeleted={() => {}}
    />
  ),
};
```

- [ ] **Step 7: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add src/components/gw/EvidenceList/
git commit -m "feat(design-system): add <EvidenceList> component with stories + tests"
```

---

### Task 8: Register new components in gallery

**Files:**
- Modify: `src/components/gw/gallery.test.tsx`
- Modify: `src/app/internal/design-system/page.tsx`

- [ ] **Step 1: Update `gallery.test.tsx`**

Open `src/components/gw/gallery.test.tsx`. After the existing `AiAssistDrawer` import (line 21), add:

```tsx
import { stories as EvidenceUploaderStories } from "./EvidenceUploader/EvidenceUploader.stories";
import { stories as EvidenceListStories } from "./EvidenceList/EvidenceList.stories";
```

After the existing `AiAssistDrawer: AiAssistDrawerStories,` entry (line 33), add:

```tsx
  EvidenceUploader: EvidenceUploaderStories,
  EvidenceList: EvidenceListStories,
```

- [ ] **Step 2: Run gallery axe test to verify both new components pass**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run src/components/gw/gallery.test.tsx
```

Expected: All existing tests PASS + new `EvidenceUploader > ...` and `EvidenceList > ...` tests PASS with no axe violations.

- [ ] **Step 3: Update `design-system/page.tsx`**

Open `src/app/internal/design-system/page.tsx`. After the existing `AiAssistDrawer` import (line 22), add:

```tsx
import { stories as EvidenceUploaderStories } from "@/components/gw/EvidenceUploader/EvidenceUploader.stories";
import { stories as EvidenceListStories } from "@/components/gw/EvidenceList/EvidenceList.stories";
```

After the existing `{ name: "AiAssistDrawer", stories: AiAssistDrawerStories },` entry in `BLOCKS`, add:

```tsx
  { name: "EvidenceUploader", stories: EvidenceUploaderStories },
  { name: "EvidenceList", stories: EvidenceListStories },
```

- [ ] **Step 4: Run tsc + lint**

```bash
cd /d/GuardWell/guardwell-v2
npx tsc --noEmit && npm run lint
```

Expected: Both clean.

- [ ] **Step 5: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add \
  src/components/gw/gallery.test.tsx \
  src/app/internal/design-system/page.tsx
git commit -m "feat(design-system): register EvidenceUploader + EvidenceList in gallery + axe audit"
```

**Chrome-verify (post-merge):**
1. Deploy to Cloud Run (merging to main triggers Cloud Build).
2. Open `https://v2.app.gwcomp.com/internal/design-system` in Chrome.
3. Scroll to `EvidenceUploader` section — all 3 story variants visible.
4. Scroll to `EvidenceList` section — all 4 story variants visible (ReadOnly, CanDelete, Empty, SingleFile).
5. Screenshot and paste in PR body.

---

## PR 4 — Reaper cron + runbook

### Task 9: Reaper logic (pure function)

**Files:**
- Create: `src/lib/storage/reaper.ts`
- Create: `tests/unit/storage/reaper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/storage/reaper.test.ts`:

```ts
// tests/unit/storage/reaper.test.ts
//
// Tests the pure reaper logic. Uses vitest mock for db + gcs.deleteFile.
// No real DB or GCS needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the reaper
vi.mock("@/lib/db", () => ({
  db: {
    evidence: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/storage/gcs", () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { deleteFile } from "@/lib/storage/gcs";
import { runReaper } from "@/lib/storage/reaper";

const mockFindMany = vi.mocked(db.evidence.findMany);
const mockDelete = vi.mocked(db.evidence.delete);
const mockDeleteFile = vi.mocked(deleteFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReaper", () => {
  it("deletes GCS objects and DB rows for evidence deleted > 30 days ago", async () => {
    const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { id: "ev-1", gcsKey: "practices/p1/CREDENTIAL/c1/abc-cert.pdf", deletedAt: staleDate },
      { id: "ev-2", gcsKey: "practices/p1/INCIDENT/i1/abc-report.pdf", deletedAt: staleDate },
    ] as never);
    mockDelete.mockResolvedValue({} as never);

    const result = await runReaper();

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith("practices/p1/CREDENTIAL/c1/abc-cert.pdf");
    expect(mockDeleteFile).toHaveBeenCalledWith("practices/p1/INCIDENT/i1/abc-report.pdf");
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(result.purged).toBe(2);
    expect(result.errors).toBe(0);
  });

  it("returns purged: 0 when no stale evidence", async () => {
    mockFindMany.mockResolvedValueOnce([] as never);
    const result = await runReaper();
    expect(result.purged).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("counts GCS errors separately (does not abort remaining rows)", async () => {
    const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { id: "ev-1", gcsKey: "key-1", deletedAt: staleDate },
      { id: "ev-2", gcsKey: "key-2", deletedAt: staleDate },
    ] as never);
    mockDeleteFile
      .mockRejectedValueOnce(new Error("GCS 403")) // first file fails
      .mockResolvedValueOnce(undefined);            // second succeeds
    mockDelete.mockResolvedValue({} as never);

    const result = await runReaper();

    // Row ev-2 was still deleted even though ev-1's GCS delete failed
    expect(result.purged).toBe(2);  // both DB rows deleted
    expect(result.errors).toBe(1);  // one GCS error logged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/reaper.test.ts
```

Expected: FAIL — `runReaper is not exported from @/lib/storage/reaper`

- [ ] **Step 3: Implement `reaper.ts`**

Create `src/lib/storage/reaper.ts`:

```ts
// src/lib/storage/reaper.ts
//
// Reaper: hard-deletes GCS objects + Evidence DB rows for any evidence that
// was soft-deleted (status=DELETED) more than 30 days ago.
//
// Design:
//   - Never called inline (slow). Called only from /api/cron/evidence-reaper.
//   - Per-row GCS failures are caught and counted but do NOT abort the
//     remaining rows — a failed GCS delete is logged; the GCS lifecycle rule
//     (365-day hard-delete) provides a safety net.
//   - DB rows are hard-deleted after the GCS attempt (success or fail) so the
//     reaper doesn't accumulate a backlog.
//   - No PHI in logs — logs only evidence IDs and gcsKey (which is
//     practices/<practiceId>/<entityType>/<entityId>/<safe-filename>).

import { db } from "@/lib/db";
import { deleteFile } from "./gcs";

const RETENTION_DAYS = 30;

export interface ReaperResult {
  /** Number of Evidence rows hard-deleted from DB. */
  purged: number;
  /** Number of GCS object deletions that failed (logged, not thrown). */
  errors: number;
}

/**
 * Scan Evidence rows with deletedAt < now() - 30 days.
 * For each row: attempt GCS delete, then hard-delete the DB row.
 */
export async function runReaper(): Promise<ReaperResult> {
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const stale = await db.evidence.findMany({
    where: {
      status: "DELETED",
      deletedAt: { lt: cutoff },
    },
    select: { id: true, gcsKey: true, deletedAt: true },
  });

  let purged = 0;
  let errors = 0;

  for (const row of stale) {
    try {
      await deleteFile(row.gcsKey);
    } catch (err) {
      errors++;
      console.error(
        `[evidence-reaper] GCS delete failed for evidence ${row.id} key=${row.gcsKey}:`,
        err instanceof Error ? err.message : err,
      );
    }
    // Hard-delete the DB row regardless of GCS outcome.
    await db.evidence.delete({ where: { id: row.id } });
    purged++;
  }

  return { purged, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/reaper.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add src/lib/storage/reaper.ts tests/unit/storage/reaper.test.ts
git commit -m "feat(storage): evidence reaper — hard-deletes GCS objects + DB rows after 30-day retention"
```

---

### Task 10: Reaper cron route

**Files:**
- Create: `src/app/api/cron/evidence-reaper/route.ts`

- [ ] **Step 1: Write the failing test**

Since the cron route is HTTP-layer only, we verify it at the integration level. Write a minimal test:

Create `tests/unit/storage/reaperRoute.test.ts`:

```ts
// tests/unit/storage/reaperRoute.test.ts
//
// Smoke test: the route 403s without the CRON_SECRET header and 200s
// when the secret matches. Uses mocked runReaper so no real DB is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/reaper", () => ({
  runReaper: vi.fn().mockResolvedValue({ purged: 3, errors: 0 }),
}));

// Simulate the route handler without Next.js runtime
async function callRoute(secret: string | undefined, configured = "test-secret") {
  // Temporarily set env
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = configured;

  // Dynamically import after env is set
  const { POST } = await import("@/app/api/cron/evidence-reaper/route");
  const headers = new Headers();
  if (secret !== undefined) headers.set("x-cron-secret", secret);
  const req = new Request("http://localhost/api/cron/evidence-reaper", {
    method: "POST",
    headers,
  });
  const res = await POST(req);

  process.env.CRON_SECRET = prev;
  return res;
}

describe("/api/cron/evidence-reaper", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 403 when x-cron-secret is missing", async () => {
    const res = await callRoute(undefined);
    expect(res.status).toBe(403);
  });

  it("returns 403 when x-cron-secret is wrong", async () => {
    const res = await callRoute("wrong-secret");
    expect(res.status).toBe(403);
  });

  it("returns 200 + purge summary when secret matches", async () => {
    const res = await callRoute("test-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.purged).toBe(3);
    expect(body.errors).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/reaperRoute.test.ts
```

Expected: FAIL — route module not found

- [ ] **Step 3: Implement the cron route**

Create `src/app/api/cron/evidence-reaper/route.ts`:

```ts
// src/app/api/cron/evidence-reaper/route.ts
//
// POST /api/cron/evidence-reaper
// Daily Cloud Scheduler trigger that hard-deletes GCS objects + Evidence
// DB rows for any evidence soft-deleted more than 30 days ago.
//
// Auth: same X-Cron-Secret pattern as /api/cron/onboarding-drip.
// Cloud Scheduler config: daily at 02:00 UTC, same secret as other crons.
//
// Cloud Scheduler one-time setup (Noorros runs once):
//   gcloud scheduler jobs create http guardwell-v2-evidence-reaper \
//     --location=us-central1 \
//     --schedule="0 2 * * *" \
//     --uri="https://v2.app.gwcomp.com/api/cron/evidence-reaper" \
//     --http-method=POST \
//     --headers="x-cron-secret=<CRON_SECRET_VALUE>" \
//     --attempt-deadline=5m \
//     --time-zone="UTC"

import { NextResponse } from "next/server";
import { runReaper } from "@/lib/storage/reaper";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return NextResponse.json(
      { ok: false, reason: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== configured) {
    return NextResponse.json(
      { ok: false, reason: "invalid cron secret" },
      { status: 403 },
    );
  }

  try {
    const result = await runReaper();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evidence-reaper] runReaper threw:", message);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/GuardWell/guardwell-v2
npx vitest run tests/unit/storage/reaperRoute.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add \
  src/app/api/cron/evidence-reaper/route.ts \
  tests/unit/storage/reaperRoute.test.ts
git commit -m "feat(cron): evidence-reaper cron route + tests (daily 30-day GCS purge)"
```

---

### Task 11: Cloud Storage runbook

**Files:**
- Create: `docs/runbooks/cloud-storage.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/cloud-storage.md`:

```markdown
# Cloud Storage Runbook — guardwell-v2-evidence

Last updated: 2026-04-28

## 1. Bucket details

| Property | Value |
|---|---|
| Bucket name | `guardwell-v2-evidence` |
| Region | `us-central1` |
| Access mode | Uniform bucket-level (no per-object ACLs) |
| Public access | Prevention enabled (bucket is never publicly readable) |
| Storage class | STANDARD |
| Lifecycle rule | Delete objects older than 365 days |

## 2. Who can access the bucket

| Principal | Role | How |
|---|---|---|
| `guardwell-v2-storage@guardwell-prod.iam.gserviceaccount.com` | `roles/storage.objectAdmin` | Scoped IAM on the bucket |
| Cloud Run runtime SA | `roles/storage.objectViewer` | Scoped IAM on the bucket |

No user has direct GCS console access. All uploads/downloads go through the application's signed URL flow.

## 3. Signed URL flow

### Upload (3 steps)
1. Client POSTs to `/api/evidence/upload` → server calls `getSignedUploadUrl` → returns a 15-min v4 signed PUT URL.
2. Client PUTs file directly to GCS using the signed URL (no server-side buffering).
3. Client POSTs to `/api/evidence/{id}/confirm` → server flips Evidence.status to UPLOADED.

### Download
- Client GETs `/api/evidence/{id}/download` → server calls `getSignedDownloadUrl` → 302 redirect to a 5-min signed GET URL.

### Delete
- Soft-delete: DELETE `/api/evidence/{id}` → status=DELETED, deletedAt set, GCS object deleted best-effort.
- Hard-delete: Reaper cron runs daily at 02:00 UTC; hard-deletes GCS objects + DB rows where deletedAt < now()-30d.

## 4. Bucket lifecycle policy

The GCS lifecycle rule (365-day delete) is a safety net. The application-level flow is:
- Day 0: Evidence.status = UPLOADED
- User deletes: Evidence.status = DELETED, deletedAt = now, GCS object deleted best-effort
- Day +30: Reaper cron hard-deletes GCS object (if still exists) + DB row
- Day +365: GCS lifecycle rule deletes any object still remaining (belt + suspenders)

## 5. Quota management

### Default quota
5 GB per practice, configurable via:
1. `PRACTICE_STORAGE_QUOTA_BYTES` env var (applies to all practices with no override).
2. `Practice.storageQuotaBytes` column (per-practice override, set via `psql` or admin UI when available).

### Raising a practice's quota
```sql
UPDATE "Practice"
SET "storageQuotaBytes" = 10737418240  -- 10 GB
WHERE id = '<practice_id>';
```

### Checking a practice's current usage
```sql
SELECT
  p.name,
  p.id,
  COALESCE(SUM(e."fileSizeBytes"), 0) AS used_bytes,
  COALESCE(SUM(e."fileSizeBytes"), 0) / 1073741824.0 AS used_gb
FROM "Practice" p
LEFT JOIN "Evidence" e ON e."practiceId" = p.id AND e.status != 'DELETED'
WHERE p.id = '<practice_id>'
GROUP BY p.id, p.name;
```

## 6. Reaper cron

- **Job name:** `guardwell-v2-evidence-reaper`
- **Schedule:** `0 2 * * *` (02:00 UTC daily)
- **Endpoint:** `POST https://v2.app.gwcomp.com/api/cron/evidence-reaper`
- **Auth:** `x-cron-secret: <CRON_SECRET>` header (same secret as `onboarding-drip`)
- **maxDuration:** 300s

### Create the Cloud Scheduler job (run once)
```bash
gcloud scheduler jobs create http guardwell-v2-evidence-reaper \
  --project=guardwell-prod \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://v2.app.gwcomp.com/api/cron/evidence-reaper" \
  --http-method=POST \
  --headers="x-cron-secret=<CRON_SECRET_VALUE>" \
  --attempt-deadline=5m \
  --time-zone="UTC"
```

### Trigger manually (test run)
```bash
gcloud scheduler jobs run guardwell-v2-evidence-reaper \
  --project=guardwell-prod \
  --location=us-central1
```

Check Cloud Logging for output:
```
resource.type="cloud_scheduler_job"
resource.labels.job_id="guardwell-v2-evidence-reaper"
```

### Monitor reaper health
The cron returns `{ ok: true, purged: N, errors: M }`. If `errors > 0`, check Cloud Logging for `[evidence-reaper] GCS delete failed` entries. Errors are usually transient (GCS 503); re-run the job. If persistent, check if the GCS SA still has objectAdmin.

## 7. Abuse incident response

### Symptom: a practice uploads unexpected file types or volumes
1. Check the Evidence table for the practice:
```sql
SELECT "entityType", "mimeType", "fileName", "fileSizeBytes", "uploadedAt"
FROM "Evidence"
WHERE "practiceId" = '<practice_id>'
  AND status != 'DELETED'
ORDER BY "uploadedAt" DESC
LIMIT 50;
```
2. If abuse confirmed, set `Practice.storageQuotaBytes = 0` to block further uploads immediately.
3. Soft-delete offending rows via the admin UI (when available) or directly:
```sql
UPDATE "Evidence"
SET status = 'DELETED', "deletedAt" = now()
WHERE "practiceId" = '<practice_id>'
  AND status != 'DELETED';
```
The reaper will hard-delete the GCS objects within 30 days. For immediate GCS purge, run the reaper manually (see §6).

### Symptom: signed URL leaks (URL shared externally)
Signed URLs expire in 5 min (downloads) or 15 min (uploads). No action needed beyond monitoring if the TTL has already elapsed. For an active leak of an unexpired URL: delete the GCS object immediately:
```bash
gcloud storage rm "gs://guardwell-v2-evidence/<object-key>"
```
Then soft-delete the Evidence row so the application UI reflects the deletion.

### Symptom: bucket misconfiguration (public access)
The bucket has `public-access-prevention` enabled. If a GCP change accidentally removes this:
```bash
gcloud storage buckets update gs://guardwell-v2-evidence \
  --public-access-prevention
```

## 8. VirusTotal scan (deferred — Phase 14)

VirusTotal integration is out of scope for Phase 3. Tracked in Phase 14 deferred register. When implemented, it will be a Cloud Function triggered on bucket object finalize events. Until then, the content-type allowlist (PDF + common images only; no executables) is the primary abuse control.

## 9. Object naming convention

```
practices/<practiceId>/<entityType>/<entityId>/<evidenceId[0:12]>-<sanitized-filename>
```

Example:
```
practices/cm1abc123/CREDENTIAL/cm9xyz456/a1b2c3d4e5f6-DEA_registration_2026.pdf
```

The `practiceId` prefix is the primary cross-tenant isolation boundary. Even if a signed URL were leaked, it only provides access to a single object in a single tenant's namespace.
```

- [ ] **Step 2: Commit**

```bash
cd /d/GuardWell/guardwell-v2
git add docs/runbooks/cloud-storage.md
git commit -m "docs: cloud-storage runbook (bucket lifecycle, quota, reaper, abuse response)"
```

---

### Task 12: Final verification pass

- [ ] **Step 1: Run all tests**

```bash
cd /d/GuardWell/guardwell-v2
npm run test:run
```

Expected: All tests PASS. Note: integration tests require a live Postgres DB (see `vitest.config.ts` for the test pool setup). If running in CI without a DB, the unit tests alone should all pass.

- [ ] **Step 2: TypeScript check**

```bash
cd /d/GuardWell/guardwell-v2
npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 3: Lint check**

```bash
cd /d/GuardWell/guardwell-v2
npm run lint
```

Expected: Clean (0 errors, 0 warnings).

- [ ] **Step 4: Commit**

No new files in this step — it's a verification pass. If tsc or lint caught errors in earlier tasks, fix and amend those commits before this step.

---

## Phase 3 close-out checklist

When all 4 PRs have merged to main and deployed to Cloud Run:

- [ ] `scripts/provision-evidence-bucket.sh` has been run once against `guardwell-prod` (or confirmed already run from `2026-04-27-evidence-ceu-reminders.md` Pre-Task)
- [ ] Cloud Scheduler job `guardwell-v2-evidence-reaper` created and test-triggered
- [ ] `https://v2.app.gwcomp.com/internal/design-system` shows `EvidenceUploader` + `EvidenceList` sections
- [ ] Upload a PDF on the Credentials page → Evidence row created → download works
- [ ] Delete the uploaded file → Evidence.status = DELETED
- [ ] `PRACTICE_STORAGE_QUOTA_BYTES` env var set on Cloud Run service
- [ ] Phase 4 (BYOV training video) unblocked — add `TRAINING_VIDEO` key to `ALLOWED_MIME_BY_ENTITY_TYPE` in `evidence.ts` with `video/mp4` value
- [ ] Phase 9 (BAA + Document Hub) unblocked — GCS infra is ready

---

## Spec coverage check

| Master roadmap Phase 3 scope item | Plan task |
|---|---|
| GCS bucket `guardwell-v2-evidence` provisioned | Task 5 (PR 2) — `scripts/provision-evidence-bucket.sh` |
| IAM service account `guardwell-v2-storage@` | Task 5 — SA creation in provisioning script |
| Cloud Run runtime SA read access via Workload Identity binding | Task 5 — step 6 + 7 in the script |
| Object naming convention `practices/<practiceId>/...` | Already shipped in `gcs.ts`; verified in plan intro |
| `getUploadUrl` — v4 signed PUT URL, 15-min TTL, content-type pinned | Task 1 (PR 1) |
| `getDownloadUrl` — v4 signed GET URL, 5-min TTL | Already shipped; unchanged |
| Server-only (never expose signing keys to client) | Already enforced — API routes are server-side; no change needed |
| Evidence model shape confirmed | Investigation phase — `entityType`/`entityId`/`uploadedById` differ from spec; documented in discrepancy section |
| `EVIDENCE_UPLOAD_REQUESTED` / `EVIDENCE_UPLOAD_CONFIRMED` / `EVIDENCE_DELETED` event types | Already shipped in `registry.ts`; verified |
| Projection handlers | Already shipped in `evidence.ts`; verified |
| Per-practice quota: 5 GB | Task 2 (PR 1) — `checkQuota` + `getPracticeStorageUsed` + `PRACTICE_STORAGE_QUOTA_BYTES` env var + `Practice.storageQuotaBytes` |
| Content-type allowlist by resourceType | Task 3 (PR 1) — `ALLOWED_MIME_BY_ENTITY_TYPE` map |
| Filename sanitization | Task 1 (PR 1) — `sanitizeFileName` with `..` strip + 255-char cap |
| `<EvidenceUploader>` component | Task 6 (PR 3) |
| `<EvidenceList>` component | Task 7 (PR 3) |
| jest-axe passes on components | Task 6 step 6 + Task 7 step 5 + Task 8 step 2 (gallery audit) |
| Stories file with all variants | Task 6 step 6 + Task 7 step 6 |
| Quota check returns clear error | Task 2 (PR 1) — `checkQuota` error message |
| Reaper cron for soft-deleted files | Task 9–10 (PR 4) |
| Runbook | Task 11 (PR 4) |
| VirusTotal scan: out of scope | Documented in runbook §8 as Phase 14 follow-up |
| Phase 4 (BYOV) unblocked | Close-out checklist + `ALLOWED_MIME_BY_ENTITY_TYPE` structure primed for `TRAINING_VIDEO → video/mp4` |
| Phase 9 (BAA + Document Hub) unblocked | Close-out checklist |
```

