# Evidence Uploads + CEU Tracking + Renewal Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three integrated subsystems addressing real launch gaps in credential management:
1. **Evidence/Attachment uploads** — practices upload scanned licenses, board certs, malpractice declarations to GCS. Polymorphic — same model serves Credentials at launch, then Vendors / Incidents / Tech assets / Document destruction post-launch.
2. **CEU tracking** — log continuing-education activities against credentials with progress bars toward the next renewal.
3. **Renewal reminders** — per-credential opt-in toggle + customizable reminder schedule (default 90/60/30/7 days), notifies the holder + the compliance officer.

Plus one micro-task: seed the missing Medical Assistant credential type (Noorros's customer specifically asked for it).

**Architecture:** Polymorphic `Evidence` model keyed by `(entityType, entityId)` — stores GCS path, mime type, size. Direct-to-bucket client uploads via 5-min signed PUT URLs (no server-side buffering). Every download fires an `EVIDENCE_DOWNLOAD_URL_ISSUED` event for HIPAA audit trail. CEU tracking is a separate `CeuActivity` model that can attach Evidence (the certificate). Reminders extend the existing notification system with per-credential `CredentialReminderConfig` rows + milestone-tracking.

**Tech Stack:** `@google-cloud/storage` v7 (port v1's pattern from `D:/GuardWell/guardwell/src/lib/storage.ts`), Prisma 5.22, existing event-sourcing pipeline, existing notification cron, vitest. New GCP bucket `guardwell-v2-evidence` with uniform-access + public-access-prevention + lifecycle policy.

---

## File Structure

**Create:**
- `src/lib/storage/gcs.ts` — port of v1 `storage.ts`. `uploadFile`, `getSignedUploadUrl`, `getSignedDownloadUrl`, `deleteFile`, `buildEvidenceKey`. Single bucket configured via `GCS_EVIDENCE_BUCKET` env.
- `src/lib/storage/evidence.ts` — high-level helpers: `issueUploadUrl`, `confirmUpload` (writes Evidence row + EVENT), `issueDownloadUrl` (writes audit event), `softDeleteEvidence`.
- `src/components/gw/EvidenceUpload/EvidenceUpload.tsx` — client component: drag-drop or click-to-pick → POST to server action for signed PUT URL → direct-to-bucket upload via `fetch` → confirm back. Shows uploaded file list with download/delete.
- `src/components/gw/EvidenceUpload/index.ts` — barrel.
- `src/lib/events/projections/evidence.ts` — `projectEvidenceUploaded`, `projectEvidenceDeleted`. (`EVIDENCE_DOWNLOAD_URL_ISSUED` is audit-only, no projection.)
- `src/lib/notifications/generators/credentialRenewal.ts` — daily generator that scans `Credential` rows, checks `CredentialReminderConfig`, fires for each milestone day in the schedule (90/60/30/7 days before expiry).
- `src/app/api/evidence/upload/route.ts` — POST: returns a signed PUT URL. Auth-gated.
- `src/app/api/evidence/[id]/download/route.ts` — GET: returns a signed download URL (302 redirect). Auth-gated. Writes EVIDENCE_DOWNLOAD_URL_ISSUED event.
- `src/app/(dashboard)/programs/credentials/[id]/page.tsx` — credential detail page (currently the credentials list links don't go anywhere; this is the holder for evidence + CEUs).
- `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx` — client component showing evidence + CEU log + reminder config.
- `src/app/(dashboard)/programs/credentials/[id]/actions.ts` — `logCeuActivityAction`, `updateReminderConfigAction`.
- `docs/ops/cors-v2-evidence.json` — bucket CORS config.
- `docs/ops/lifecycle-v2-evidence.json` — bucket lifecycle policy.
- `docs/ops/2026-04-27-gcs-bucket-setup.md` — gcloud commands the user runs once.
- `tests/integration/evidence-upload.test.ts` — happy-path upload + dedup-on-storageKey.
- `tests/integration/ceu-activity.test.ts` — CEU lifecycle + progress calc.
- `tests/integration/credential-reminder.test.ts` — milestone firing + dedup.

**Modify:**
- `prisma/schema.prisma` — 3 new models (`Evidence`, `CeuActivity`, `CredentialReminderConfig`) + 3 fields on `CredentialType` (`ceuRequirementHours`, `ceuRequirementWindowMonths`, `requiresEvidenceByDefault`).
- `src/lib/events/registry.ts` — 3 new event types (`EVIDENCE_UPLOADED`, `EVIDENCE_DOWNLOAD_URL_ISSUED`, `EVIDENCE_DELETED`) + Zod schemas. Plus `CEU_ACTIVITY_LOGGED` + `CEU_ACTIVITY_REMOVED`.
- `scripts/seed-credentials.ts` — add `MEDICAL_ASSISTANT_CERT` row + populate `ceuRequirementHours` / `ceuRequirementWindowMonths` on existing types.
- `src/app/(dashboard)/programs/credentials/page.tsx` — make each credential row link to `/programs/credentials/{id}` (the new detail page); add a small evidence-attached badge on each row.
- `src/lib/notifications/generators/index.ts` — register `generateCredentialRenewalNotifications`.
- `package.json` — add `@google-cloud/storage` dependency.
- `.env.example` — add `GCS_EVIDENCE_BUCKET`, `GCP_PROJECT_ID`, `GCP_KEY_FILE` entries.

**Test:**
- `tests/integration/evidence-upload.test.ts`
- `tests/integration/ceu-activity.test.ts`
- `tests/integration/credential-reminder.test.ts`

---

## Pre-Task: GCP bucket creation (Noorros runs once)

Document the exact commands in `docs/ops/2026-04-27-gcs-bucket-setup.md` so they're reproducible. The Evidence subsystem can't deploy without this — but the dev DB doesn't need a bucket since the storage helper falls back to a no-op log mode in dev (port v1's pattern).

```bash
# 1. Create the bucket
gcloud storage buckets create gs://guardwell-v2-evidence \
  --project=guardwell-prod \
  --location=US-CENTRAL1 \
  --uniform-bucket-level-access \
  --public-access-prevention

# 2. Apply CORS
gcloud storage buckets update gs://guardwell-v2-evidence \
  --cors-file=docs/ops/cors-v2-evidence.json

# 3. Apply lifecycle policy
gcloud storage buckets update gs://guardwell-v2-evidence \
  --lifecycle-file=docs/ops/lifecycle-v2-evidence.json

# 4. Grant the v2 Cloud Run service account object-level access
SA_EMAIL=$(gcloud run services describe guardwell-v2 \
  --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)')
gcloud storage buckets add-iam-policy-binding gs://guardwell-v2-evidence \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# 5. Set the Cloud Run env var
gcloud run services update guardwell-v2 --region=us-central1 \
  --update-env-vars=GCS_EVIDENCE_BUCKET=guardwell-v2-evidence
```

---

## Task 1: Install @google-cloud/storage + add env var stubs

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env.example`

- [ ] **Step 1: Install the package**

```bash
cd /d/GuardWell/guardwell-v2
npm install @google-cloud/storage
```

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:

```
# GCS evidence bucket (Phase 3 — credential evidence uploads)
GCS_EVIDENCE_BUCKET=
GCP_PROJECT_ID=
# Local dev: path to a service-account key JSON. Cloud Run uses ADC.
GCP_KEY_FILE=
```

- [ ] **Step 3: Commit**

```bash
git checkout -b feat/launch-3-evidence-ceu
git add package.json package-lock.json .env.example
git commit -m "chore(evidence): add @google-cloud/storage + env stubs"
```

---

## Task 2: GCS storage helper (port from v1)

**Files:**
- Create: `src/lib/storage/gcs.ts`

- [ ] **Step 1: Implement the helper**

```ts
// src/lib/storage/gcs.ts
//
// Thin wrapper around @google-cloud/storage. Lazy singleton + dev no-op
// fallback when GCS_EVIDENCE_BUCKET is unset (matches v1's pattern from
// D:/GuardWell/guardwell/src/lib/storage.ts).

import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.GCS_EVIDENCE_BUCKET;

let storage: Storage | null = null;

function getClient(): Storage | null {
  if (storage) return storage;
  if (!BUCKET) return null;
  storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? {} // Cloud Run uses the SA automatically
      : process.env.GCP_KEY_FILE
        ? { keyFilename: process.env.GCP_KEY_FILE }
        : {}),
  });
  return storage;
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

/** Issue a 15-minute signed GET URL for downloads. */
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
      expires: Date.now() + 15 * 60 * 1000,
    });
  return { url };
}

/** Delete (best-effort, ignoreNotFound). */
export async function deleteObject(storageKey: string): Promise<void> {
  const client = getClient();
  if (!client || !BUCKET) return;
  await client
    .bucket(BUCKET)
    .file(storageKey)
    .delete({ ignoreNotFound: true });
}

/** Build the canonical key path for an Evidence row. */
export function buildEvidenceKey(args: {
  practiceId: string;
  entityType: string;
  entityId: string;
  fileName: string;
}): string {
  // {practiceId}/{entityType}/{entityId}/{cuid-prefix}-{filename}
  const sanitized = args.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const cuidPrefix = Math.random().toString(36).slice(2, 12);
  return `practices/${args.practiceId}/${args.entityType}/${args.entityId}/${cuidPrefix}-${sanitized}`;
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/storage/gcs.ts
git commit -m "feat(evidence): GCS helper (signed URLs + key builder, dev no-op)"
```

---

## Task 3: Schema migration — Evidence, CeuActivity, CredentialReminderConfig + CredentialType fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the 3 new fields on `CredentialType`**

Find `model CredentialType` and add inside:

```prisma
  // CEU defaults — overridable per Credential when state requirements vary.
  ceuRequirementHours          Decimal?   @db.Decimal(6, 2)
  ceuRequirementWindowMonths   Int?       // e.g. 24 for biennial CME
  requiresEvidenceByDefault    Boolean    @default(false)
```

- [ ] **Step 2: Append the 3 new models at end of schema.prisma**

```prisma

// ────────────────────────────────────────────────────────────────────────────
// Evidence / file uploads — polymorphic across credentials, vendors,
// incidents, tech assets, etc. (docs/plans/2026-04-27-evidence-ceu-reminders.md)
// ────────────────────────────────────────────────────────────────────────────

model Evidence {
  id               String    @id @default(cuid())
  practiceId       String
  // Polymorphic association — entityType ∈ {CREDENTIAL, VENDOR, TECH_ASSET,
  // INCIDENT, TRAINING_COMPLETION, DESTRUCTION, ALLERGY_DRILL, CEU_ACTIVITY, OTHER}
  entityType       String
  entityId         String
  fileName         String    // original
  storageKey       String    @unique // gs path: practices/{p}/{type}/{id}/...
  mimeType         String
  sizeBytes        Int
  uploadedByUserId String
  uploadedAt       DateTime  @default(now())
  // Future AI extraction results (license number, expiry date, etc.).
  aiExtracted      Json?
  notes            String?   @db.Text
  retiredAt        DateTime? // soft-delete; lifecycle rule purges after 90d

  practice Practice @relation(fields: [practiceId], references: [id], onDelete: Cascade)

  @@index([practiceId, entityType, entityId, retiredAt])
  @@index([uploadedAt])
}

// CEU activity — continuing education hours earned externally that count
// toward credential renewal.
model CeuActivity {
  id              String    @id @default(cuid())
  practiceId      String
  practiceUserId  String    // who earned it
  title           String
  accreditingBody String?   // "AMA PRA Cat 1", "AAMA", state board
  category        String?   // "Pain Management", "Ethics", "General"
  hours           Decimal   @db.Decimal(6, 2)
  completedAt     DateTime
  // Optional link: which credential's renewal does this count toward?
  credentialId    String?
  notes           String?   @db.Text
  retiredAt       DateTime?
  createdAt       DateTime  @default(now())

  practice     Practice      @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  practiceUser PracticeUser  @relation("CeuActivityHolder", fields: [practiceUserId], references: [id], onDelete: Cascade)
  credential   Credential?   @relation(fields: [credentialId], references: [id], onDelete: SetNull)

  @@index([practiceId, practiceUserId])
  @@index([credentialId])
  @@index([completedAt])
}

// Per-credential reminder configuration. Defaults to enabled +
// [90, 60, 30, 7] days-before-expiry. firedMilestones tracks which
// schedule entries have been sent (resets when expiryDate moves).
model CredentialReminderConfig {
  id                  String    @id @default(cuid())
  credentialId        String    @unique
  enabled             Boolean   @default(true)
  reminderSchedule    Int[]     @default([90, 60, 30, 7])
  notifyHolder        Boolean   @default(true)
  notifyOfficer       Boolean   @default(true)
  firedMilestones     Int[]     @default([])
  expiryDateAtFire    DateTime? // expiry baseline — when this changes, reset firedMilestones
  lastFiredAt         DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  credential Credential @relation(fields: [credentialId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Add back-relations on Practice + PracticeUser + Credential**

`model Practice { ... }`:

```prisma
  evidence       Evidence[]
  ceuActivities  CeuActivity[]
```

`model PracticeUser { ... }`:

```prisma
  ceuActivities  CeuActivity[]  @relation("CeuActivityHolder")
```

`model Credential { ... }`:

```prisma
  ceuActivities  CeuActivity[]
  reminderConfig CredentialReminderConfig?
```

- [ ] **Step 4: Push + generate**

```bash
docker start guardwell-v2-pg
npx prisma db push --skip-generate
# Stop dev server first to release the Prisma client DLL on Windows
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(evidence): schema — Evidence + CeuActivity + CredentialReminderConfig"
```

---

## Task 4: Event registry — 5 new events

**Files:**
- Modify: `src/lib/events/registry.ts`

- [ ] **Step 1: Add 5 EVENT_TYPES**

```ts
  // Evidence / file uploads — see docs/plans/2026-04-27-evidence-ceu-reminders.md
  "EVIDENCE_UPLOADED",
  "EVIDENCE_DOWNLOAD_URL_ISSUED",
  "EVIDENCE_DELETED",
  "CEU_ACTIVITY_LOGGED",
  "CEU_ACTIVITY_REMOVED",
```

- [ ] **Step 2: Add the 5 Zod schemas**

```ts
  EVIDENCE_UPLOADED: {
    1: z.object({
      evidenceId: z.string().min(1),
      entityType: z.string().min(1).max(50),
      entityId: z.string().min(1),
      fileName: z.string().min(1).max(500),
      storageKey: z.string().min(1).max(1000),
      mimeType: z.string().min(1).max(200),
      sizeBytes: z.number().int().min(0),
      uploadedByUserId: z.string().min(1),
    }),
  },
  EVIDENCE_DOWNLOAD_URL_ISSUED: {
    1: z.object({
      evidenceId: z.string().min(1),
      issuedToUserId: z.string().min(1),
      ttlSeconds: z.number().int().min(0).max(3600),
    }),
  },
  EVIDENCE_DELETED: {
    1: z.object({
      evidenceId: z.string().min(1),
      deletedByUserId: z.string().min(1),
    }),
  },
  CEU_ACTIVITY_LOGGED: {
    1: z.object({
      ceuActivityId: z.string().min(1),
      practiceUserId: z.string().min(1),
      title: z.string().min(1).max(500),
      accreditingBody: z.string().max(200).nullable().optional(),
      category: z.string().max(200).nullable().optional(),
      hours: z.number().min(0).max(1000),
      completedAt: z.string().datetime(),
      credentialId: z.string().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  CEU_ACTIVITY_REMOVED: {
    1: z.object({
      ceuActivityId: z.string().min(1),
    }),
  },
```

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/events/registry.ts
git commit -m "feat(evidence): 5 new event types (EVIDENCE_*, CEU_*)"
```

---

## Task 5: Evidence projection + write tests

**Files:**
- Create: `src/lib/events/projections/evidence.ts`
- Create: `tests/integration/evidence-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/evidence-upload.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectEvidenceUploaded,
  projectEvidenceDeleted,
} from "@/lib/events/projections/evidence";
import { randomUUID } from "node:crypto";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `ev-${Math.random().toString(36).slice(2, 10)}`,
      email: `e-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Evidence Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice };
}

describe("Evidence upload projection", () => {
  it("inserts an Evidence row from EVIDENCE_UPLOADED", async () => {
    const { owner, practice } = await seed();
    const evidenceId = randomUUID();
    const payload = {
      evidenceId,
      entityType: "CREDENTIAL",
      entityId: "cred-123",
      fileName: "license.pdf",
      storageKey: `practices/${practice.id}/CREDENTIAL/cred-123/abcd1234-license.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 123456,
      uploadedByUserId: owner.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "EVIDENCE_UPLOADED",
        payload,
      },
      async (tx) =>
        projectEvidenceUploaded(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.entityType).toBe("CREDENTIAL");
    expect(row.fileName).toBe("license.pdf");
    expect(row.retiredAt).toBeNull();
  });

  it("is idempotent on storageKey", async () => {
    const { owner, practice } = await seed();
    const evidenceId = randomUUID();
    const storageKey = `practices/${practice.id}/CREDENTIAL/x/dup.pdf`;
    const payload = {
      evidenceId,
      entityType: "CREDENTIAL",
      entityId: "x",
      fileName: "dup.pdf",
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: 100,
      uploadedByUserId: owner.id,
    };
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "EVIDENCE_UPLOADED",
          payload,
        },
        async (tx) =>
          projectEvidenceUploaded(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }
    const rows = await db.evidence.findMany({ where: { storageKey } });
    expect(rows).toHaveLength(1);
  });

  it("EVIDENCE_DELETED soft-deletes the row", async () => {
    const { owner, practice } = await seed();
    const evidenceId = randomUUID();
    const upPayload = {
      evidenceId,
      entityType: "CREDENTIAL",
      entityId: "x",
      fileName: "del.pdf",
      storageKey: `practices/${practice.id}/CREDENTIAL/x/del.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 100,
      uploadedByUserId: owner.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "EVIDENCE_UPLOADED",
        payload: upPayload,
      },
      async (tx) =>
        projectEvidenceUploaded(tx, {
          practiceId: practice.id,
          payload: upPayload,
        }),
    );
    const delPayload = { evidenceId, deletedByUserId: owner.id };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "EVIDENCE_DELETED",
        payload: delPayload,
      },
      async (tx) =>
        projectEvidenceDeleted(tx, {
          practiceId: practice.id,
          payload: delPayload,
        }),
    );
    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.retiredAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
npx vitest run tests/integration/evidence-upload.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the projection**

```ts
// src/lib/events/projections/evidence.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type UploadPayload = PayloadFor<"EVIDENCE_UPLOADED", 1>;
type DeletePayload = PayloadFor<"EVIDENCE_DELETED", 1>;

export async function projectEvidenceUploaded(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UploadPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.evidence.upsert({
    where: { storageKey: payload.storageKey },
    create: {
      id: payload.evidenceId,
      practiceId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      fileName: payload.fileName,
      storageKey: payload.storageKey,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      uploadedByUserId: payload.uploadedByUserId,
    },
    update: {
      // Idempotent — just touch updatedAt-equivalent. Other fields don't
      // change for a given storageKey.
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    },
  });
}

export async function projectEvidenceDeleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DeletePayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const row = await tx.evidence.findUnique({
    where: { id: payload.evidenceId },
    select: { practiceId: true },
  });
  if (!row || row.practiceId !== practiceId) {
    throw new Error(`EVIDENCE_DELETED refused: not found / cross-practice`);
  }
  await tx.evidence.update({
    where: { id: payload.evidenceId },
    data: { retiredAt: new Date() },
  });
}
```

- [ ] **Step 4: Run — should pass**

```bash
npx vitest run tests/integration/evidence-upload.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/projections/evidence.ts tests/integration/evidence-upload.test.ts
git commit -m "feat(evidence): EVIDENCE_UPLOADED + EVIDENCE_DELETED projections"
```

---

## Task 6: Evidence high-level helpers + API routes

**Files:**
- Create: `src/lib/storage/evidence.ts`
- Create: `src/app/api/evidence/upload/route.ts`
- Create: `src/app/api/evidence/[id]/download/route.ts`

- [ ] **Step 1: Implement the high-level helpers**

```ts
// src/lib/storage/evidence.ts
//
// High-level evidence helpers used by the API routes + server actions.
// Keep file shape, validation, and event-emission logic in one place
// so per-surface upload UIs are thin wrappers.

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectEvidenceUploaded,
  projectEvidenceDeleted,
} from "@/lib/events/projections/evidence";
import {
  buildEvidenceKey,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  deleteObject,
} from "./gcs";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

export interface IssueUploadArgs {
  practiceId: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface IssueUploadResult {
  evidenceId: string;
  storageKey: string;
  uploadUrl: string | null;
  reason?: string;
}

/**
 * Issue a signed PUT URL the client uses to upload directly to GCS.
 * Validates mime + size first. Returns null upload URL when GCS isn't
 * configured (dev no-op).
 */
export async function issueUploadUrl(
  args: IssueUploadArgs,
): Promise<IssueUploadResult> {
  if (!ALLOWED_MIME.has(args.mimeType)) {
    throw new Error(`Unsupported file type: ${args.mimeType}`);
  }
  if (args.sizeBytes > MAX_BYTES) {
    throw new Error(`File too large: max ${MAX_BYTES} bytes`);
  }
  const evidenceId = randomUUID();
  const storageKey = buildEvidenceKey({
    practiceId: args.practiceId,
    entityType: args.entityType,
    entityId: args.entityId,
    fileName: args.fileName,
  });
  const signed = await getSignedUploadUrl(storageKey, args.mimeType);
  return {
    evidenceId,
    storageKey,
    uploadUrl: signed.url,
    reason: signed.reason,
  };
}

export interface ConfirmUploadArgs {
  practiceId: string;
  actorUserId: string;
  evidenceId: string;
  entityType: string;
  entityId: string;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

/** Called by the client AFTER it has uploaded to GCS. Writes the row. */
export async function confirmUpload(args: ConfirmUploadArgs): Promise<void> {
  const payload = {
    evidenceId: args.evidenceId,
    entityType: args.entityType,
    entityId: args.entityId,
    fileName: args.fileName,
    storageKey: args.storageKey,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    uploadedByUserId: args.actorUserId,
  };
  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.actorUserId,
      type: "EVIDENCE_UPLOADED",
      payload,
    },
    async (tx) =>
      projectEvidenceUploaded(tx, {
        practiceId: args.practiceId,
        payload,
      }),
  );
}

/**
 * Issue a 15-minute signed download URL. Writes
 * EVIDENCE_DOWNLOAD_URL_ISSUED as audit trail. The actual download
 * happens client-side via the returned URL.
 */
export async function issueDownloadUrl(args: {
  practiceId: string;
  actorUserId: string;
  evidenceId: string;
}): Promise<{ url: string | null; reason?: string }> {
  const ev = await db.evidence.findUnique({
    where: { id: args.evidenceId },
    select: { practiceId: true, storageKey: true, retiredAt: true },
  });
  if (!ev || ev.practiceId !== args.practiceId) {
    throw new Error("Evidence not found");
  }
  if (ev.retiredAt) throw new Error("Evidence has been deleted");
  const signed = await getSignedDownloadUrl(ev.storageKey);
  if (signed.url) {
    await appendEventAndApply(
      {
        practiceId: args.practiceId,
        actorUserId: args.actorUserId,
        type: "EVIDENCE_DOWNLOAD_URL_ISSUED",
        payload: {
          evidenceId: args.evidenceId,
          issuedToUserId: args.actorUserId,
          ttlSeconds: 15 * 60,
        },
      },
      async () => {
        // No projection — audit-only event.
      },
    );
  }
  return signed;
}

/** Soft-delete the row + (best-effort) delete the GCS object. */
export async function softDeleteEvidence(args: {
  practiceId: string;
  actorUserId: string;
  evidenceId: string;
}): Promise<void> {
  const ev = await db.evidence.findUnique({
    where: { id: args.evidenceId },
    select: { practiceId: true, storageKey: true, retiredAt: true },
  });
  if (!ev || ev.practiceId !== args.practiceId) {
    throw new Error("Evidence not found");
  }
  if (ev.retiredAt) return;
  const payload = { evidenceId: args.evidenceId, deletedByUserId: args.actorUserId };
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
  // Best-effort GCS delete (lifecycle rule cleans up if this fails).
  await deleteObject(ev.storageKey).catch(() => {});
}
```

- [ ] **Step 2: Implement the upload route**

```ts
// src/app/api/evidence/upload/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { issueUploadUrl, confirmUpload } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

const InitInput = z.object({
  action: z.literal("init"),
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0),
});
const ConfirmInput = z.object({
  action: z.literal("confirm"),
  evidenceId: z.string().min(1),
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1),
  fileName: z.string().min(1).max(500),
  storageKey: z.string().min(1).max(1000),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0),
});
const Body = z.union([InitInput, ConfirmInput]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const pu = await getPracticeUser();
    if (!pu) {
      return NextResponse.json({ error: "No practice" }, { status: 401 });
    }
    const json = await request.json();
    const parsed = Body.parse(json);

    if (parsed.action === "init") {
      const result = await issueUploadUrl({
        practiceId: pu.practiceId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.sizeBytes,
      });
      return NextResponse.json(result);
    }
    await confirmUpload({
      practiceId: pu.practiceId,
      actorUserId: user.id,
      ...parsed,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 3: Implement the download route**

```ts
// src/app/api/evidence/[id]/download/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { issueDownloadUrl } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const pu = await getPracticeUser();
    if (!pu) {
      return NextResponse.json({ error: "No practice" }, { status: 401 });
    }
    const result = await issueDownloadUrl({
      practiceId: pu.practiceId,
      actorUserId: user.id,
      evidenceId: id,
    });
    if (!result.url) {
      return NextResponse.json(
        { error: result.reason ?? "GCS not configured" },
        { status: 503 },
      );
    }
    return NextResponse.redirect(result.url, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "download failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Add `/api/evidence` to PUBLIC_ROUTES exempt? No — these are auth-gated. But the proxy.ts cookie-check should let the route handler do the actual auth.**

Verify the existing proxy.ts logic doesn't block authenticated `/api/evidence/*` requests. If it does, no change needed since real users have the fb-token cookie.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/storage/ src/app/api/evidence/
git commit -m "feat(evidence): high-level helpers + upload/download API routes"
```

---

## Task 7: `<EvidenceUpload>` reusable client component

**Files:**
- Create: `src/components/gw/EvidenceUpload/EvidenceUpload.tsx`
- Create: `src/components/gw/EvidenceUpload/index.ts`

- [ ] **Step 1: Implement**

```tsx
// src/components/gw/EvidenceUpload/EvidenceUpload.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Download, FileText } from "lucide-react";

export interface EvidenceItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface EvidenceUploadProps {
  entityType: string;
  entityId: string;
  initialEvidence: EvidenceItem[];
  /** Server action that soft-deletes — called from the trash button. */
  onDelete: (evidenceId: string) => Promise<void>;
  /** Called after a successful upload so the parent can refresh. */
  onUploaded?: () => void;
}

export function EvidenceUpload(props: EvidenceUploadProps) {
  const [items, setItems] = useState(props.initialEvidence);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const upload = async (file: File) => {
    setError(null);
    try {
      const initRes = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          entityType: props.entityType,
          entityId: props.entityId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).error ?? "init failed");
      const init = (await initRes.json()) as {
        evidenceId: string;
        storageKey: string;
        uploadUrl: string | null;
        reason?: string;
      };
      if (!init.uploadUrl) {
        throw new Error(init.reason ?? "GCS not configured (dev mode)");
      }
      const putRes = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      const confirmRes = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          evidenceId: init.evidenceId,
          entityType: props.entityType,
          entityId: props.entityId,
          fileName: file.name,
          storageKey: init.storageKey,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      if (!confirmRes.ok)
        throw new Error((await confirmRes.json()).error ?? "confirm failed");
      setItems((prev) => [
        ...prev,
        {
          id: init.evidenceId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
        },
      ]);
      props.onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    }
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await props.onDelete(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "delete failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.heic,.webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
        className="block w-full text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No files attached yet. PDF or image, up to 25 MB.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-xs">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate">{it.fileName}</span>
              <span className="text-muted-foreground">
                {Math.round(it.sizeBytes / 1024)} KB
              </span>
              <a
                href={`/api/evidence/${it.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1 hover:bg-accent"
                aria-label="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(it.id)}
                disabled={isPending}
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```ts
// src/components/gw/EvidenceUpload/index.ts
export { EvidenceUpload, type EvidenceItem, type EvidenceUploadProps } from "./EvidenceUpload";
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/gw/EvidenceUpload/
git commit -m "feat(evidence): reusable EvidenceUpload client component"
```

---

## Task 8: Credential detail page + first surface for evidence

**Files:**
- Create: `src/app/(dashboard)/programs/credentials/[id]/page.tsx`
- Create: `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx`
- Create: `src/app/(dashboard)/programs/credentials/[id]/actions.ts`
- Modify: `src/app/(dashboard)/programs/credentials/page.tsx` (link rows + show evidence count badge)

- [ ] **Step 1: Implement the detail page (server component)**

Fetches: credential + holder + credentialType + evidence (filter by entityType=CREDENTIAL, entityId=this.id, retiredAt=null) + ceuActivities + reminderConfig.

- [ ] **Step 2: Implement `<CredentialDetail>` (client)**

Renders:
- Credential header (title, license #, issuer, dates, expiry status)
- Evidence section using `<EvidenceUpload entityType="CREDENTIAL" entityId={credential.id} ... />`
- CEU section with progress bar (`hours so far / required hours`) + "Log CEU activity" form
- Reminder config section: enabled toggle + schedule editor (default 90/60/30/7 days; multi-input pills)

- [ ] **Step 3: Implement the actions**

`logCeuActivityAction({title, accreditingBody?, category?, hours, completedAt, credentialId, notes?})` — emits `CEU_ACTIVITY_LOGGED`, projection inserts the row.

`updateReminderConfigAction({credentialId, enabled, reminderSchedule, notifyHolder, notifyOfficer})` — upserts the `CredentialReminderConfig` row (no event needed — pure config).

`deleteEvidenceAction({evidenceId})` — wraps `softDeleteEvidence` from the helper.

- [ ] **Step 4: Modify the credentials list page**

In `src/app/(dashboard)/programs/credentials/page.tsx`, wrap each credential row with a `<Link href={\`/programs/credentials/${c.id}\`}>` and (in the same query) also fetch `_count.evidenceItems` (or a separate query) to show "📎 N" badge when evidence is attached.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/programs/credentials/
git commit -m "feat(evidence): credential detail page with evidence + CEU + reminder config"
```

---

## Task 9: CEU integration test

**Files:**
- Create: `tests/integration/ceu-activity.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/ceu-activity.test.ts
//
// CEU activity lifecycle + per-credential progress.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
// (implementation imports — paths once you create them in Task 8 actions.ts)

describe("CEU activity", () => {
  it("logs and aggregates hours per credential", async () => {
    const owner = await db.user.create({
      data: {
        firebaseUid: `ceu-${Math.random().toString(36).slice(2, 10)}`,
        email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "CEU Test", primaryState: "AZ" },
    });
    const ownerPu = await db.practiceUser.create({
      data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
    });
    const credType = await db.credentialType.upsert({
      where: { code: "MD_STATE_LICENSE" },
      update: {},
      create: {
        code: "MD_STATE_LICENSE",
        name: "State medical license",
        category: "PROFESSIONAL",
        ceuRequirementHours: 40,
        ceuRequirementWindowMonths: 24,
      },
    });
    const credential = await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: ownerPu.id,
        credentialTypeId: credType.id,
        title: "Owner · AZ MD License",
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    // Log 3 CEU activities totaling 18 hours.
    for (const hrs of [10, 5, 3]) {
      await db.ceuActivity.create({
        data: {
          practiceId: practice.id,
          practiceUserId: ownerPu.id,
          credentialId: credential.id,
          title: `CME activity (${hrs}h)`,
          hours: hrs,
          completedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
    const total = await db.ceuActivity.aggregate({
      where: { credentialId: credential.id, retiredAt: null },
      _sum: { hours: true },
    });
    expect(Number(total._sum.hours ?? 0)).toBe(18);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run tests/integration/ceu-activity.test.ts
```

Expected: PASS once Task 8 actions implement `logCeuActivityAction`. (The test above uses direct db.create as a simpler verification — replace with the action call once it exists.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ceu-activity.test.ts
git commit -m "test(evidence): CEU activity aggregation"
```

---

## Task 10: Renewal reminder generator + integration test

**Files:**
- Create: `src/lib/notifications/generators/credentialRenewal.ts`
- Modify: `src/lib/notifications/generators/index.ts`
- Create: `tests/integration/credential-reminder.test.ts`

- [ ] **Step 1: Write the generator**

```ts
// src/lib/notifications/generators/credentialRenewal.ts
//
// Daily generator. For each active credential with reminderConfig enabled
// + expiryDate set + days-until-expiry matching a milestone in the
// schedule that hasn't been fired yet, emit one notification per
// recipient (holder / officer based on config).

import type { Prisma } from "@prisma/client";
import type { NotificationProposal } from "./types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function generateCredentialRenewalNotifications(
  db: Prisma.TransactionClient,
  practiceId: string,
  recipientUserIds: string[],
): Promise<NotificationProposal[]> {
  const credentials = await db.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { not: null },
    },
    include: {
      reminderConfig: true,
      holder: { include: { user: { select: { id: true } } } },
      credentialType: { select: { name: true, code: true } },
    },
  });

  const proposals: NotificationProposal[] = [];

  for (const c of credentials) {
    const expiry = c.expiryDate;
    if (!expiry) continue;
    const cfg = c.reminderConfig;
    const enabled = cfg?.enabled ?? true; // default enabled if no config row yet
    if (!enabled) continue;
    const schedule = cfg?.reminderSchedule ?? [90, 60, 30, 7];
    const fired = cfg?.firedMilestones ?? [];

    // If the expiry baseline has changed (renewal happened), reset fired.
    const baseline = cfg?.expiryDateAtFire;
    const baselineMatches =
      baseline && baseline.getTime() === expiry.getTime();
    const effectiveFired = baselineMatches ? fired : [];

    const daysUntil = Math.round(
      (expiry.getTime() - Date.now()) / ONE_DAY_MS,
    );

    // Find milestones that are due now and not yet fired.
    const due = schedule.filter(
      (m) => daysUntil <= m && !effectiveFired.includes(m),
    );
    if (due.length === 0) continue;

    // Recipient set: holder (if config says so + holder exists) + officer
    // (proxy: every recipient passed in — they're the practice's notifiable
    // users; the digest fan-out filters per user prefs).
    const targets = new Set<string>();
    if (cfg?.notifyHolder !== false && c.holder?.user?.id) {
      targets.add(c.holder.user.id);
    }
    if (cfg?.notifyOfficer !== false) {
      for (const u of recipientUserIds) targets.add(u);
    }

    // Pick the most-imminent milestone for the title (smallest days).
    const tightest = Math.min(...due);

    for (const userId of targets) {
      proposals.push({
        practiceId,
        userId,
        type: "CREDENTIAL_RENEWAL_DUE",
        severity:
          tightest <= 7 ? "HIGH" : tightest <= 30 ? "MEDIUM" : "LOW",
        title:
          tightest < 0
            ? `${c.title} has expired`
            : `${c.title} expires in ${tightest} day${tightest === 1 ? "" : "s"}`,
        body: `${c.credentialType.name} renewal due. Update at /programs/credentials/${c.id}.`,
        href: `/programs/credentials/${c.id}`,
        entityKey: `credential-renewal-${c.id}-${tightest}`,
      });
    }

    // Mark these milestones as fired (tracked at the config level).
    await db.credentialReminderConfig.upsert({
      where: { credentialId: c.id },
      create: {
        credentialId: c.id,
        firedMilestones: [...effectiveFired, ...due],
        expiryDateAtFire: expiry,
        lastFiredAt: new Date(),
      },
      update: {
        firedMilestones: [...effectiveFired, ...due],
        expiryDateAtFire: expiry,
        lastFiredAt: new Date(),
      },
    });
  }

  return proposals;
}
```

- [ ] **Step 2: Register the generator**

In `src/lib/notifications/generators/index.ts`, add `generateCredentialRenewalNotifications` to the central registry/aggregator.

- [ ] **Step 3: Write the test**

```ts
// tests/integration/credential-reminder.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { generateCredentialRenewalNotifications } from "@/lib/notifications/generators/credentialRenewal";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `crem-${Math.random().toString(36).slice(2, 10)}`,
      email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Reminder Test", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  const credType = await db.credentialType.upsert({
    where: { code: "MD_STATE_LICENSE" },
    update: {},
    create: {
      code: "MD_STATE_LICENSE",
      name: "State medical license",
      category: "PROFESSIONAL",
    },
  });
  return { owner, ownerPu, practice, credType };
}

describe("Credential renewal reminders", () => {
  it("fires when expiryDate is within a milestone day count", async () => {
    const { owner, ownerPu, practice, credType } = await seed();
    const credential = await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: ownerPu.id,
        credentialTypeId: credType.id,
        title: "Test license",
        expiryDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days
      },
    });
    const proposals = await generateCredentialRenewalNotifications(
      db,
      practice.id,
      [owner.id],
    );
    // Expect 30-day milestone fires (25 ≤ 30); 60 + 90 also fire (catch-up).
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.type).toBe("CREDENTIAL_RENEWAL_DUE");
    const cfg = await db.credentialReminderConfig.findUniqueOrThrow({
      where: { credentialId: credential.id },
    });
    expect(cfg.firedMilestones.length).toBeGreaterThan(0);
  });

  it("does not re-fire milestones already in firedMilestones", async () => {
    const { owner, ownerPu, practice, credType } = await seed();
    const credential = await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: ownerPu.id,
        credentialTypeId: credType.id,
        title: "Test license",
        expiryDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    });
    await db.credentialReminderConfig.create({
      data: {
        credentialId: credential.id,
        firedMilestones: [90, 60, 30],
        expiryDateAtFire: credential.expiryDate,
      },
    });
    const proposals = await generateCredentialRenewalNotifications(
      db,
      practice.id,
      [owner.id],
    );
    expect(proposals).toHaveLength(0);
  });

  it("resets firedMilestones when expiryDate moves (renewal)", async () => {
    const { owner, ownerPu, practice, credType } = await seed();
    const credential = await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: ownerPu.id,
        credentialTypeId: credType.id,
        title: "Test license",
        expiryDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    });
    const oldExpiry = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await db.credentialReminderConfig.create({
      data: {
        credentialId: credential.id,
        firedMilestones: [90, 60, 30, 7],
        expiryDateAtFire: oldExpiry,
      },
    });
    const proposals = await generateCredentialRenewalNotifications(
      db,
      practice.id,
      [owner.id],
    );
    expect(proposals.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/integration/credential-reminder.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/generators/credentialRenewal.ts src/lib/notifications/generators/index.ts tests/integration/credential-reminder.test.ts
git commit -m "feat(evidence): credential renewal reminder generator + tests"
```

---

## Task 11: Seed MA cert + CEU defaults on existing types

**Files:**
- Modify: `scripts/seed-credentials.ts`

- [ ] **Step 1: Add the MA cert + populate CEU defaults**

In `scripts/seed-credentials.ts`, add a row:

```ts
{
  code: "MEDICAL_ASSISTANT_CERT",
  name: "Medical Assistant Certification",
  category: "PROFESSIONAL",
  description: "AAMA / AMT / NCCT / NHA certification. Issuing body captured per credential.",
  renewalPeriodDays: 1825, // 5 years (AAMA default; AMT is shorter)
  ceuRequirementHours: 60,
  ceuRequirementWindowMonths: 60,
},
```

For existing types where you know the requirement (state-board CME — set 30/24 for MD), populate `ceuRequirementHours` + `ceuRequirementWindowMonths`. Leave others null (UI shows "no required hours" when null).

- [ ] **Step 2: Re-run the seed**

```bash
npx tsx scripts/seed-credentials.ts
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-credentials.ts
git commit -m "feat(evidence): seed MA certification + CEU defaults on existing types"
```

---

## Task 12: GCP bucket setup docs

**Files:**
- Create: `docs/ops/cors-v2-evidence.json`
- Create: `docs/ops/lifecycle-v2-evidence.json`
- Create: `docs/ops/2026-04-27-gcs-bucket-setup.md`

- [ ] **Step 1: CORS config**

```json
{
  "cors": [
    {
      "origin": [
        "https://v2.app.gwcomp.com",
        "https://app.gwcomp.com",
        "http://localhost:3002"
      ],
      "method": ["GET", "PUT"],
      "responseHeader": ["Content-Type", "x-goog-resumable"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

- [ ] **Step 2: Lifecycle config**

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": {
          "daysSinceCustomTime": 90
        }
      }
    ]
  }
}
```

(The 90-day soft-delete grace; CustomTime is set when an Evidence row is soft-deleted. Files without CustomTime are kept indefinitely.)

- [ ] **Step 3: Setup runbook**

`docs/ops/2026-04-27-gcs-bucket-setup.md` documents the gcloud commands from the Pre-Task section above.

- [ ] **Step 4: Commit**

```bash
git add docs/ops/
git commit -m "docs(evidence): GCS bucket setup runbook + CORS + lifecycle configs"
```

---

## Task 13: Chrome verify + push branch + PR

- [ ] **Step 1: Run all tests**

```bash
docker start guardwell-v2-pg
cd /d/GuardWell/guardwell-v2
npm test -- --run
```

Expected: every prior test plus 3 new files pass.

- [ ] **Step 2: tsc clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Chrome verify**

Note: full upload chrome-verify requires the GCS bucket to be created (bucket setup runbook). In dev without the bucket, `<EvidenceUpload>` shows the "GCS not configured (dev mode)" error gracefully — verify that error path renders cleanly.

- Visit `/programs/credentials` → click into a credential row → land on `/programs/credentials/{id}`
- Verify the Evidence section renders the file picker
- Verify the CEU section renders the "Log activity" form
- Verify the Reminder config section renders the toggle + schedule editor

After bucket setup:
- Upload a real PDF, see it appear in the evidence list
- Click download — should redirect to a signed GCS URL and the PDF downloads
- Delete — soft-delete + GCS object removed
- Check the EventLog for `EVIDENCE_UPLOADED` + `EVIDENCE_DOWNLOAD_URL_ISSUED` + `EVIDENCE_DELETED` entries

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/launch-3-evidence-ceu
gh pr create --title "feat(launch-3): Evidence uploads + CEU tracking + renewal reminders" --body "..."
```

PR body summarizes the 3 subsystems, links the gcloud commands the user runs once, lists the new event types, and reminds the user that the AI extraction subsystem (Phase 5 in the launch-readiness master plan) is explicitly out of scope.

- [ ] **Step 5: Stop, await user instruction to merge + run gcloud commands**
