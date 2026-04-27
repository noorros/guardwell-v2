// src/app/(dashboard)/programs/vendors/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectVendorUpserted,
  projectVendorBaaExecuted,
  projectVendorRemoved,
} from "@/lib/events/projections/vendor";
import { db } from "@/lib/db";

const AddInput = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(50).optional().nullable(),
  service: z.string().max(500).optional().nullable(),
  contact: z.string().max(200).optional().nullable(),
  email: z
    .string()
    .email()
    .or(z.literal(""))
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional().nullable(),
  processesPhi: z.boolean(),
});

const BaaInput = z.object({
  vendorId: z.string().min(1),
});

const RemoveInput = z.object({
  vendorId: z.string().min(1),
});

async function verifyVendorInPractice(vendorId: string, practiceId: string) {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.practiceId !== practiceId) {
    throw new Error("Unauthorized: vendor not in your practice");
  }
  return vendor;
}

export async function addVendorAction(input: z.infer<typeof AddInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = AddInput.parse(input);
  const vendorId = randomUUID();

  const payload = {
    vendorId,
    name: parsed.name,
    type: parsed.type ?? null,
    service: parsed.service ?? null,
    contact: parsed.contact ?? null,
    email: parsed.email ?? null,
    notes: parsed.notes ?? null,
    processesPhi: parsed.processesPhi,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_UPSERTED",
      payload,
    },
    async (tx) =>
      projectVendorUpserted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}

export async function markBaaExecutedAction(input: z.infer<typeof BaaInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = BaaInput.parse(input);
  await verifyVendorInPractice(parsed.vendorId, pu.practiceId);

  const payload = {
    vendorId: parsed.vendorId,
    executedAt: new Date().toISOString(),
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_BAA_EXECUTED",
      payload,
    },
    async (tx) =>
      projectVendorBaaExecuted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}

// ──────────────────────────────────────────────────────────────────────
// Bulk CSV import — emits VENDOR_UPSERTED per row, plus
// VENDOR_BAA_EXECUTED when BAA fields are set on the row. Dedup by
// lowercased name within batch + against active vendors. Per-row
// results.
// ──────────────────────────────────────────────────────────────────────

const BulkVendorRow = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(50).nullable().optional(),
  service: z.string().max(500).nullable().optional(),
  contact: z.string().max(200).nullable().optional(),
  email: z
    .string()
    .email()
    .or(z.literal(""))
    .nullable()
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
  processesPhi: z.boolean(),
  baaExecutedAt: z.string().datetime().nullable().optional(),
  baaExpiresAt: z.string().datetime().nullable().optional(),
  baaDirection: z
    .enum([
      "PRACTICE_PROVIDED",
      "VENDOR_PROVIDED",
      "PLATFORM_ACKNOWLEDGMENT",
    ])
    .nullable()
    .optional(),
});

export type BulkVendorImportRow = z.infer<typeof BulkVendorRow>;

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

export async function bulkImportVendorsAction(input: {
  rows: BulkVendorImportRow[];
}): Promise<BulkResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can bulk-import vendors");
  }
  if (input.rows.length > MAX_BATCH) {
    throw new Error(
      `Batch too large: ${input.rows.length} rows exceeds the ${MAX_BATCH}-row cap.`,
    );
  }

  const perRowResults: BulkPerRowResult[] = [];
  const seen = new Set<string>();
  let insertedCount = 0;

  const existing = await db.vendor.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((v) => v.name.toLowerCase()));

  for (const raw of input.rows) {
    const r = BulkVendorRow.safeParse(raw);
    if (!r.success) {
      perRowResults.push({
        identifier: raw.name || "(unnamed)",
        status: "INVALID",
        reason: r.error.issues[0]?.message ?? "validation failed",
      });
      continue;
    }
    const row = r.data;
    const lowName = row.name.toLowerCase();
    if (seen.has(lowName)) {
      perRowResults.push({
        identifier: row.name,
        status: "DUPLICATE_IN_BATCH",
      });
      continue;
    }
    seen.add(lowName);
    if (existingNames.has(lowName)) {
      perRowResults.push({
        identifier: row.name,
        status: "ALREADY_EXISTS",
        reason: "active vendor with this name already exists",
      });
      continue;
    }

    const vendorId = randomUUID();
    const upsertPayload = {
      vendorId,
      name: row.name,
      type: row.type ?? null,
      service: row.service ?? null,
      contact: row.contact ?? null,
      email: row.email ?? null,
      notes: row.notes ?? null,
      processesPhi: row.processesPhi,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "VENDOR_UPSERTED",
        payload: upsertPayload,
      },
      async (tx) =>
        projectVendorUpserted(tx, {
          practiceId: pu.practiceId,
          payload: upsertPayload,
        }),
    );

    if (row.baaExecutedAt) {
      const baaPayload = {
        vendorId,
        executedAt: row.baaExecutedAt,
        expiresAt: row.baaExpiresAt ?? null,
        baaDirection: row.baaDirection ?? null,
      };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "VENDOR_BAA_EXECUTED",
          payload: baaPayload,
        },
        async (tx) =>
          projectVendorBaaExecuted(tx, {
            practiceId: pu.practiceId,
            payload: baaPayload,
          }),
      );
    }
    insertedCount += 1;
    perRowResults.push({ identifier: row.name, status: "INSERTED" });
  }

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
  return {
    insertedCount,
    updatedCount: 0,
    skippedCount: perRowResults.length - insertedCount,
    perRowResults,
  };
}

export async function removeVendorAction(input: z.infer<typeof RemoveInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = RemoveInput.parse(input);
  const vendor = await verifyVendorInPractice(parsed.vendorId, pu.practiceId);
  if (vendor.retiredAt) return;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_REMOVED",
      payload: { vendorId: parsed.vendorId },
    },
    async (tx) =>
      projectVendorRemoved(tx, {
        practiceId: pu.practiceId,
        payload: { vendorId: parsed.vendorId },
      }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}
