// tests/integration/allergy-equipment.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { randomUUID } from "node:crypto";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `eq-${Math.random().toString(36).slice(2, 10)}`,
      email: `e-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Equip Test", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, ownerPu, practice };
}

describe("Allergy equipment check projection", () => {
  it("inserts an EMERGENCY_KIT check row", async () => {
    const { owner, ownerPu, practice } = await seed();
    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "EMERGENCY_KIT" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      epiLotNumber: "ABC123",
      allItemsPresent: true,
      itemsReplaced: null,
      temperatureC: null,
      inRange: null,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyEquipmentCheckLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const row = await db.allergyEquipmentCheck.findUniqueOrThrow({
      where: { id },
    });
    expect(row.checkType).toBe("EMERGENCY_KIT");
    expect(row.allItemsPresent).toBe(true);
  });

  it("is idempotent on equipmentCheckId", async () => {
    const { owner, ownerPu, practice } = await seed();
    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "REFRIGERATOR_TEMP" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: null,
      epiLotNumber: null,
      allItemsPresent: null,
      itemsReplaced: null,
      temperatureC: 5.0,
      inRange: true,
      notes: null,
    };
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
          payload,
        },
        async (tx) =>
          projectAllergyEquipmentCheckLogged(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }
    const rows = await db.allergyEquipmentCheck.findMany({
      where: { id },
    });
    expect(rows).toHaveLength(1);
  });
});
