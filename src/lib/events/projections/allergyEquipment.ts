// src/lib/events/projections/allergyEquipment.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"ALLERGY_EQUIPMENT_CHECK_LOGGED", 1>;

export async function projectAllergyEquipmentCheckLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse cross-tenant overwrite of an existing equipment
  // check. Without this, a forged event could mutate another practice's
  // refrigerator-temp / emergency-kit log row.
  const existing = await tx.allergyEquipmentCheck.findUnique({
    where: { id: payload.equipmentCheckId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(
    existing,
    practiceId,
    `ALLERGY_EQUIPMENT_CHECK_LOGGED ${payload.equipmentCheckId}`,
  );

  await tx.allergyEquipmentCheck.upsert({
    where: { id: payload.equipmentCheckId },
    create: {
      id: payload.equipmentCheckId,
      practiceId,
      checkedById: payload.checkedByUserId,
      checkType: payload.checkType,
      checkedAt: new Date(payload.checkedAt),
      epiExpiryDate: payload.epiExpiryDate
        ? new Date(payload.epiExpiryDate)
        : null,
      epiLotNumber: payload.epiLotNumber ?? null,
      allItemsPresent: payload.allItemsPresent ?? null,
      itemsReplaced: payload.itemsReplaced ?? null,
      temperatureC: payload.temperatureC ?? null,
      inRange: payload.inRange ?? null,
      notes: payload.notes ?? null,
    },
    update: {
      checkedAt: new Date(payload.checkedAt),
      epiExpiryDate: payload.epiExpiryDate
        ? new Date(payload.epiExpiryDate)
        : null,
      epiLotNumber: payload.epiLotNumber ?? null,
      allItemsPresent: payload.allItemsPresent ?? null,
      itemsReplaced: payload.itemsReplaced ?? null,
      temperatureC: payload.temperatureC ?? null,
      inRange: payload.inRange ?? null,
      notes: payload.notes ?? null,
    },
  });
  if (payload.checkType === "EMERGENCY_KIT") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_EMERGENCY_KIT_CURRENT",
    );
  }
  if (payload.checkType === "REFRIGERATOR_TEMP") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_REFRIGERATOR_LOG",
    );
  }
  // SKIN_TEST_SUPPLIES: no rederive (not a derived requirement)
}
