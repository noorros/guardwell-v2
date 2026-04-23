// src/lib/events/projections/techAsset.ts
//
// Projects TECH_ASSET_UPSERTED + TECH_ASSET_RETIRED events into the
// TechAsset table. Both fire SRA rederivation since the SRA rule cares
// about whether ≥1 PHI-processing asset is on file.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type UpsertedPayload = PayloadFor<"TECH_ASSET_UPSERTED", 1>;
type RetiredPayload = PayloadFor<"TECH_ASSET_RETIRED", 1>;

export async function projectTechAssetUpserted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UpsertedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.techAsset.upsert({
    where: { id: payload.techAssetId },
    update: {
      name: payload.name,
      assetType: payload.assetType,
      processesPhi: payload.processesPhi,
      encryption: payload.encryption,
      vendor: payload.vendor ?? null,
      location: payload.location ?? null,
      ownerUserId: payload.ownerUserId ?? null,
      notes: payload.notes ?? null,
      retiredAt: null,
    },
    create: {
      id: payload.techAssetId,
      practiceId,
      name: payload.name,
      assetType: payload.assetType,
      processesPhi: payload.processesPhi,
      encryption: payload.encryption,
      vendor: payload.vendor ?? null,
      location: payload.location ?? null,
      ownerUserId: payload.ownerUserId ?? null,
      notes: payload.notes ?? null,
    },
  });
  // SRA rule cares about presence of PHI assets.
  await rederiveRequirementStatus(tx, practiceId, "TECH_ASSET:UPSERTED");
}

export async function projectTechAssetRetired(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RetiredPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.techAsset.update({
    where: { id: payload.techAssetId },
    data: { retiredAt: new Date() },
  });
  await rederiveRequirementStatus(tx, practiceId, "TECH_ASSET:UPSERTED");
}
