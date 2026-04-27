// src/app/(dashboard)/programs/security-assets/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectTechAssetUpserted,
  projectTechAssetRetired,
} from "@/lib/events/projections/techAsset";

const UpsertInput = z.object({
  techAssetId: z.string().min(1).optional(), // omit to create
  name: z.string().min(1).max(200),
  assetType: z.enum([
    "SERVER",
    "LAPTOP",
    "DESKTOP",
    "MOBILE",
    "EMR",
    "NETWORK_DEVICE",
    "CLOUD_SERVICE",
    "OTHER",
  ]),
  processesPhi: z.boolean(),
  encryption: z.enum(["FULL_DISK", "FIELD_LEVEL", "NONE", "UNKNOWN"]),
  vendor: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  ownerUserId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export async function upsertTechAssetAction(input: z.infer<typeof UpsertInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = UpsertInput.parse(input);
  const techAssetId = parsed.techAssetId ?? randomUUID();

  if (parsed.techAssetId) {
    const existing = await db.techAsset.findUnique({
      where: { id: parsed.techAssetId },
      select: { practiceId: true },
    });
    if (!existing || existing.practiceId !== pu.practiceId) {
      throw new Error("Asset not found");
    }
  }

  const payload = {
    techAssetId,
    name: parsed.name,
    assetType: parsed.assetType,
    processesPhi: parsed.processesPhi,
    encryption: parsed.encryption,
    vendor: parsed.vendor ?? null,
    location: parsed.location ?? null,
    ownerUserId: parsed.ownerUserId ?? null,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TECH_ASSET_UPSERTED",
      payload,
    },
    async (tx) =>
      projectTechAssetUpserted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/security-assets");
  revalidatePath("/programs/risk");
  revalidatePath("/modules/hipaa");
}

// ──────────────────────────────────────────────────────────────────────
// Bulk CSV import — emits one TECH_ASSET_UPSERTED event per row.
// Dedup within the batch by lowercased name; the projection itself is
// idempotent on techAssetId (a fresh cuid per row in this path).
// Per-row results so the UI can show what landed vs what failed.
// ──────────────────────────────────────────────────────────────────────

const BulkRowInput = z.object({
  name: z.string().min(1).max(200),
  assetType: z.enum([
    "SERVER",
    "LAPTOP",
    "DESKTOP",
    "MOBILE",
    "EMR",
    "NETWORK_DEVICE",
    "CLOUD_SERVICE",
    "OTHER",
  ]),
  processesPhi: z.boolean(),
  encryption: z.enum(["FULL_DISK", "FIELD_LEVEL", "NONE", "UNKNOWN"]),
  vendor: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type BulkTechAssetRow = z.infer<typeof BulkRowInput>;

const MAX_BATCH = 200;

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

export async function bulkImportTechAssetsAction(input: {
  rows: BulkTechAssetRow[];
}): Promise<BulkResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can bulk-import assets");
  }
  if (input.rows.length > MAX_BATCH) {
    throw new Error(
      `Batch too large: ${input.rows.length} rows exceeds the ${MAX_BATCH}-row cap.`,
    );
  }

  const perRowResults: BulkPerRowResult[] = [];
  const seenNames = new Set<string>();
  let insertedCount = 0;
  const skippedCount = 0;

  // Pre-load existing names for dedup (active assets only).
  const existing = await db.techAsset.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((a) => a.name.toLowerCase()));

  for (const raw of input.rows) {
    const parseResult = BulkRowInput.safeParse(raw);
    if (!parseResult.success) {
      perRowResults.push({
        identifier: raw.name || "(unnamed)",
        status: "INVALID",
        reason: parseResult.error.issues[0]?.message ?? "validation failed",
      });
      continue;
    }
    const row = parseResult.data;
    const lowName = row.name.toLowerCase();

    if (seenNames.has(lowName)) {
      perRowResults.push({
        identifier: row.name,
        status: "DUPLICATE_IN_BATCH",
      });
      continue;
    }
    seenNames.add(lowName);

    if (existingNames.has(lowName)) {
      perRowResults.push({
        identifier: row.name,
        status: "ALREADY_EXISTS",
        reason: "active asset with this name already exists",
      });
      continue;
    }

    const techAssetId = randomUUID();
    const payload = {
      techAssetId,
      name: row.name,
      assetType: row.assetType,
      processesPhi: row.processesPhi,
      encryption: row.encryption,
      vendor: row.vendor ?? null,
      location: row.location ?? null,
      ownerUserId: null,
      notes: row.notes ?? null,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "TECH_ASSET_UPSERTED",
        payload,
      },
      async (tx) =>
        projectTechAssetUpserted(tx, {
          practiceId: pu.practiceId,
          payload,
        }),
    );
    insertedCount += 1;
    perRowResults.push({ identifier: row.name, status: "INSERTED" });
  }

  revalidatePath("/programs/security-assets");
  revalidatePath("/programs/risk");
  revalidatePath("/modules/hipaa");

  return {
    insertedCount,
    updatedCount: 0,
    skippedCount:
      perRowResults.length - insertedCount - 0,
    perRowResults,
  };
}

const RetireInput = z.object({
  techAssetId: z.string().min(1),
});

export async function retireTechAssetAction(
  input: z.infer<typeof RetireInput>,
) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = RetireInput.parse(input);

  const target = await db.techAsset.findUnique({
    where: { id: parsed.techAssetId },
    select: { practiceId: true, retiredAt: true },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Asset not found");
  }
  if (target.retiredAt) return;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TECH_ASSET_RETIRED",
      payload: { techAssetId: parsed.techAssetId },
    },
    async (tx) =>
      projectTechAssetRetired(tx, {
        practiceId: pu.practiceId,
        payload: { techAssetId: parsed.techAssetId },
      }),
  );

  revalidatePath("/programs/security-assets");
  revalidatePath("/programs/risk");
  revalidatePath("/modules/hipaa");
}
