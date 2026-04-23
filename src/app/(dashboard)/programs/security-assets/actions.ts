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
