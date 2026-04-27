// src/app/(dashboard)/programs/credentials/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectCredentialUpserted,
  projectCredentialRemoved,
} from "@/lib/events/projections/credential";
import { db } from "@/lib/db";

const isoOrEmpty = z.string().optional().nullable();

const AddInput = z.object({
  credentialTypeCode: z.string().min(1),
  holderId: z.string().min(1).optional().nullable(),
  title: z.string().min(1).max(200),
  licenseNumber: z.string().max(100).optional().nullable(),
  issuingBody: z.string().max(200).optional().nullable(),
  issueDate: isoOrEmpty,    // YYYY-MM-DD from <input type="date">
  expiryDate: isoOrEmpty,
  notes: z.string().max(2000).optional().nullable(),
});

const RemoveInput = z.object({
  credentialId: z.string().min(1),
});

function toIso(date: string | null | undefined): string | null {
  if (!date) return null;
  // <input type="date"> yields "YYYY-MM-DD"; turn it into an ISO at noon UTC
  // to avoid TZ-drift edge cases.
  return `${date}T12:00:00.000Z`;
}

async function verifyHolderInPractice(holderId: string, practiceId: string) {
  const pu = await db.practiceUser.findUnique({ where: { id: holderId } });
  if (!pu || pu.practiceId !== practiceId) {
    throw new Error("Unauthorized: holder not in your practice");
  }
  if (pu.removedAt) {
    throw new Error("Cannot assign a credential to a removed user");
  }
}

async function verifyCredentialInPractice(credentialId: string, practiceId: string) {
  const c = await db.credential.findUnique({ where: { id: credentialId } });
  if (!c || c.practiceId !== practiceId) {
    throw new Error("Unauthorized: credential not in your practice");
  }
  return c;
}

export async function addCredentialAction(input: z.infer<typeof AddInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = AddInput.parse(input);

  if (parsed.holderId) {
    await verifyHolderInPractice(parsed.holderId, pu.practiceId);
  }

  const credentialId = randomUUID();
  const payload = {
    credentialId,
    credentialTypeCode: parsed.credentialTypeCode,
    holderId: parsed.holderId ?? null,
    title: parsed.title,
    licenseNumber: parsed.licenseNumber ?? null,
    issuingBody: parsed.issuingBody ?? null,
    issueDate: toIso(parsed.issueDate),
    expiryDate: toIso(parsed.expiryDate),
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "CREDENTIAL_UPSERTED",
      payload,
    },
    async (tx) =>
      projectCredentialUpserted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/credentials");
}

// ──────────────────────────────────────────────────────────────────────
// Bulk CSV import — emits CREDENTIAL_UPSERTED per row. Resolves
// holderEmail → PracticeUser.id by joining User.email; missing/unknown
// emails are reported as INVALID. credentialTypeCode is the CredentialType
// code (e.g., "MD_STATE_LICENSE"). Per-row results.
// ──────────────────────────────────────────────────────────────────────

const BulkCredentialRow = z.object({
  credentialTypeCode: z.string().min(1).max(100),
  holderEmail: z.string().nullable().optional(), // empty = practice-level
  title: z.string().min(1).max(200),
  licenseNumber: z.string().max(100).nullable().optional(),
  issuingBody: z.string().max(200).nullable().optional(),
  issueDate: z.string().nullable().optional(), // ISO or YYYY-MM-DD
  expiryDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type BulkCredentialImportRow = z.infer<typeof BulkCredentialRow>;

export interface BulkPerRowResult {
  identifier: string;
  status:
    | "INSERTED"
    | "UPDATED"
    | "DUPLICATE_IN_BATCH"
    | "ALREADY_EXISTS"
    | "INVALID";
  reason?: string;
}

export interface BulkResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  perRowResults: BulkPerRowResult[];
}

const MAX_BATCH = 200;

export async function bulkImportCredentialsAction(input: {
  rows: BulkCredentialImportRow[];
}): Promise<BulkResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can bulk-import credentials");
  }
  if (input.rows.length > MAX_BATCH) {
    throw new Error(
      `Batch too large: ${input.rows.length} rows exceeds the ${MAX_BATCH}-row cap.`,
    );
  }

  const perRowResults: BulkPerRowResult[] = [];
  let insertedCount = 0;

  // Resolve all the things we'll need for lookups in one pass.
  const allTypes = await db.credentialType.findMany({
    select: { id: true, code: true },
  });
  const typeByCode = new Map(allTypes.map((t) => [t.code.toUpperCase(), t.id]));

  // Map email → PracticeUser.id for active members of this practice.
  const members = await db.practiceUser.findMany({
    where: { practiceId: pu.practiceId, removedAt: null },
    include: { user: { select: { email: true } } },
  });
  const holderByEmail = new Map<string, string>();
  for (const m of members) {
    if (m.user.email) holderByEmail.set(m.user.email.toLowerCase(), m.id);
  }

  // (license#, type) intra-batch dedup so a CSV with two rows for the
  // same license doesn't double-write.
  const seenInBatch = new Set<string>();

  for (const raw of input.rows) {
    const r = BulkCredentialRow.safeParse(raw);
    if (!r.success) {
      perRowResults.push({
        identifier: raw.title || "(untitled)",
        status: "INVALID",
        reason: r.error.issues[0]?.message ?? "validation failed",
      });
      continue;
    }
    const row = r.data;
    const id = `${(row.licenseNumber ?? row.title).toLowerCase()}::${row.credentialTypeCode.toUpperCase()}`;
    if (seenInBatch.has(id)) {
      perRowResults.push({
        identifier: row.title,
        status: "DUPLICATE_IN_BATCH",
      });
      continue;
    }
    seenInBatch.add(id);

    if (!typeByCode.has(row.credentialTypeCode.toUpperCase())) {
      perRowResults.push({
        identifier: row.title,
        status: "INVALID",
        reason: `unknown credentialTypeCode "${row.credentialTypeCode}"`,
      });
      continue;
    }

    let holderId: string | null = null;
    const emailLower = row.holderEmail?.trim().toLowerCase();
    if (emailLower) {
      const resolved = holderByEmail.get(emailLower);
      if (!resolved) {
        perRowResults.push({
          identifier: row.title,
          status: "INVALID",
          reason: `holderEmail "${row.holderEmail}" is not an active member of this practice`,
        });
        continue;
      }
      holderId = resolved;
    }

    const credentialId = randomUUID();
    const payload = {
      credentialId,
      credentialTypeCode: row.credentialTypeCode,
      holderId,
      title: row.title,
      licenseNumber: row.licenseNumber ?? null,
      issuingBody: row.issuingBody ?? null,
      issueDate: row.issueDate
        ? new Date(row.issueDate).toISOString()
        : null,
      expiryDate: row.expiryDate
        ? new Date(row.expiryDate).toISOString()
        : null,
      notes: row.notes ?? null,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "CREDENTIAL_UPSERTED",
        payload,
      },
      async (tx) =>
        projectCredentialUpserted(tx, { practiceId: pu.practiceId, payload }),
    );
    insertedCount += 1;
    perRowResults.push({ identifier: row.title, status: "INSERTED" });
  }

  revalidatePath("/programs/credentials");
  return {
    insertedCount,
    updatedCount: 0,
    skippedCount: perRowResults.length - insertedCount,
    perRowResults,
  };
}

export async function removeCredentialAction(input: z.infer<typeof RemoveInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = RemoveInput.parse(input);
  const existing = await verifyCredentialInPractice(parsed.credentialId, pu.practiceId);
  if (existing.retiredAt) return;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "CREDENTIAL_REMOVED",
      payload: { credentialId: parsed.credentialId },
    },
    async (tx) =>
      projectCredentialRemoved(tx, {
        practiceId: pu.practiceId,
        payload: { credentialId: parsed.credentialId },
      }),
  );

  revalidatePath("/programs/credentials");
}
