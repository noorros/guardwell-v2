// src/lib/events/projections/allergyEquipment.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type LoggedPayload = PayloadFor<"ALLERGY_EQUIPMENT_CHECK_LOGGED", 1>;
type UpdatedPayload = PayloadFor<"ALLERGY_EQUIPMENT_CHECK_UPDATED", 1>;
type DeletedPayload = PayloadFor<"ALLERGY_EQUIPMENT_CHECK_DELETED", 1>;

async function rederiveForCheckType(
  tx: Prisma.TransactionClient,
  practiceId: string,
  checkType: string,
): Promise<void> {
  if (checkType === "EMERGENCY_KIT") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_EMERGENCY_KIT_CURRENT",
    );
  } else if (checkType === "REFRIGERATOR_TEMP") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_REFRIGERATOR_LOG",
    );
  }
  // SKIN_TEST_SUPPLIES: no derived requirement
}

export async function projectAllergyEquipmentCheckLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: LoggedPayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse a forged ALLERGY_EQUIPMENT_CHECK_LOGGED carrying
  // another practice's equipmentCheckId — without this guard, the row's
  // temperature reading or epi-pen lot could be overwritten.
  const existing = await tx.allergyEquipmentCheck.findUnique({
    where: { id: payload.equipmentCheckId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyEquipmentCheck",
    id: payload.equipmentCheckId,
  });

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
  await rederiveForCheckType(tx, practiceId, payload.checkType);
}

/**
 * Audit #15: typo correction on an existing equipment-check row. checkType
 * is intentionally NOT in the payload — changing kit ↔ fridge would turn
 * the original log into something else (delete + re-log instead). The
 * checkType from the existing row drives which compliance rule rederives.
 */
export async function projectAllergyEquipmentCheckUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UpdatedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.allergyEquipmentCheck.findUnique({
    where: { id: payload.equipmentCheckId },
    select: { practiceId: true, retiredAt: true, checkType: true },
  });
  if (!existing) {
    throw new Error(
      `ALLERGY_EQUIPMENT_CHECK_UPDATED refused: check ${payload.equipmentCheckId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyEquipmentCheck",
    id: payload.equipmentCheckId,
  });
  if (existing.retiredAt) {
    throw new Error(
      `ALLERGY_EQUIPMENT_CHECK_UPDATED refused: check ${payload.equipmentCheckId} is retired`,
    );
  }
  await tx.allergyEquipmentCheck.update({
    where: { id: payload.equipmentCheckId },
    data: {
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
  await rederiveForCheckType(tx, practiceId, existing.checkType);
}

/**
 * Audit #15: soft-delete. Idempotent. Always rederives the matching
 * compliance rule because deleting the most-recent check can flip
 * EMERGENCY_KIT_CURRENT or REFRIGERATOR_LOG back to GAP.
 */
export async function projectAllergyEquipmentCheckDeleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DeletedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.allergyEquipmentCheck.findUnique({
    where: { id: payload.equipmentCheckId },
    select: { practiceId: true, retiredAt: true, checkType: true },
  });
  if (!existing) {
    throw new Error(
      `ALLERGY_EQUIPMENT_CHECK_DELETED refused: check ${payload.equipmentCheckId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyEquipmentCheck",
    id: payload.equipmentCheckId,
  });
  if (!existing.retiredAt) {
    await tx.allergyEquipmentCheck.update({
      where: { id: payload.equipmentCheckId },
      data: { retiredAt: new Date(payload.deletedAt) },
    });
  }
  await rederiveForCheckType(tx, practiceId, existing.checkType);
}
