// tests/integration/allergy-cross-type-validation.test.ts
//
// Audit #21 / Allergy IM-7 (2026-04-30): the equipment-check actions
// historically accepted both kit fields (epi expiry, lot, presence,
// replacements) and fridge fields (temperature, in-range) regardless of
// `checkType`. A buggy / malicious client could submit fridge fields on
// a kit row (corrupting the row) or kit fields on a fridge row (nulling
// the temperature). These tests guard the new refusal paths in
// `logEquipmentCheckAction` (Zod superRefine) and
// `updateEquipmentCheckAction` (existing.checkType-aware throw).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __roleSweepTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__roleSweepTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__roleSweepTestUser) throw new Error("Unauthorized");
      return globalThis.__roleSweepTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__roleSweepTestUser = null;
});

async function seedOwner() {
  const user = await db.user.create({
    data: {
      firebaseUid: `imt7-${Math.random().toString(36).slice(2, 10)}`,
      email: `imt7-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "IM-7 Practice", primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  globalThis.__roleSweepTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, pu };
}

describe("Audit #21 / Allergy IM-7 — logEquipmentCheckAction cross-type rejection", () => {
  it("rejects fridge fields on an EMERGENCY_KIT log", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "EMERGENCY_KIT",
        epiExpiryDate: "2027-01-15",
        allItemsPresent: true,
        // ❌ fridge field on a kit check
        temperatureC: 4.5,
      } as Parameters<typeof logEquipmentCheckAction>[0]),
    ).rejects.toThrow();
  });

  it("rejects kit fields on a REFRIGERATOR_TEMP log", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 4.5,
        inRange: true,
        // ❌ kit field on a fridge reading
        epiLotNumber: "AB123",
      } as Parameters<typeof logEquipmentCheckAction>[0]),
    ).rejects.toThrow();
  });

  it("accepts a clean EMERGENCY_KIT log with only kit fields", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "EMERGENCY_KIT",
        epiExpiryDate: "2027-01-15",
        epiLotNumber: "AB123",
        allItemsPresent: true,
        notes: "first check",
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts a clean REFRIGERATOR_TEMP log with only fridge fields", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 4.5,
        inRange: true,
        notes: "morning reading",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("Audit #21 / Allergy IM-7 — updateEquipmentCheckAction cross-type rejection", () => {
  it("rejects fridge fields when the existing row is EMERGENCY_KIT", async () => {
    const { practice, pu } = await seedOwner();
    const { logEquipmentCheckAction, updateEquipmentCheckAction } =
      await import("@/app/(dashboard)/programs/allergy/actions");
    // Seed a kit check via the action so the projection writes the row.
    await logEquipmentCheckAction({
      checkType: "EMERGENCY_KIT",
      epiLotNumber: "INITIAL",
      allItemsPresent: true,
    });
    const existing = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "EMERGENCY_KIT" },
      orderBy: { checkedAt: "desc" },
    });
    expect(pu).toBeTruthy(); // pu used for type narrow only
    await expect(
      updateEquipmentCheckAction({
        equipmentCheckId: existing.id,
        // ❌ fridge fields on a kit row
        temperatureC: 4.5,
        inRange: true,
      } as Parameters<typeof updateEquipmentCheckAction>[0]),
    ).rejects.toThrow(/REFRIGERATOR_TEMP|fridge/i);
  });

  it("rejects kit fields when the existing row is REFRIGERATOR_TEMP", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction, updateEquipmentCheckAction } =
      await import("@/app/(dashboard)/programs/allergy/actions");
    await logEquipmentCheckAction({
      checkType: "REFRIGERATOR_TEMP",
      temperatureC: 5,
      inRange: true,
    });
    const existing = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
      orderBy: { checkedAt: "desc" },
    });
    await expect(
      updateEquipmentCheckAction({
        equipmentCheckId: existing.id,
        // ❌ kit fields on a fridge row
        epiLotNumber: "WRONG",
        allItemsPresent: false,
      } as Parameters<typeof updateEquipmentCheckAction>[0]),
    ).rejects.toThrow(/EMERGENCY_KIT|kit/i);
  });

  it("allows a same-type update on a kit row", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction, updateEquipmentCheckAction } =
      await import("@/app/(dashboard)/programs/allergy/actions");
    await logEquipmentCheckAction({
      checkType: "EMERGENCY_KIT",
      epiLotNumber: "OLD",
      allItemsPresent: true,
    });
    const existing = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "EMERGENCY_KIT" },
    });
    await expect(
      updateEquipmentCheckAction({
        equipmentCheckId: existing.id,
        epiLotNumber: "NEW",
        allItemsPresent: true,
      }),
    ).resolves.toBeUndefined();
  });
});
