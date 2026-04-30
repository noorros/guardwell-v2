// tests/integration/allergy-temperature-boundaries.test.ts
//
// Audit #21 / Allergy MIN-3 + MIN-4 (2026-04-30): boundary tests for the
// REFRIGERATOR_TEMP fridge-temperature input.
//
//   * MIN-3 (in-range boundary): the 2°C–8°C window is inclusive at both
//     ends. 2.0 / 8.0 must save with `inRange=true`; 1.99 / 8.01 must
//     save with `inRange=false`. The audit flagged that this boundary
//     semantic was undocumented and undertested — drift to an exclusive
//     boundary would silently flip thousands of legitimate readings to
//     GAP and tank ALLERGY_REFRIGERATOR_LOG status.
//
//   * MIN-4 (implausible-reading clamp): the action's zod validator
//     `z.number().min(-20).max(40)` rejects extreme values (negative
//     freezer-thermometer mistakes, Fahrenheit-as-Celsius typos, NaN,
//     Infinity). The form-layer also surfaces a soft "unusual reading"
//     nudge below ±30°C — see EquipmentTab.tsx — but the action layer
//     is the authoritative gate. These tests guard the action gate so
//     a future relaxation (e.g. someone removes `.max(40)` to satisfy
//     a freezer-storage feature) doesn't silently widen the surface.
//
// Action-layer tests (vs. component-level): the inRange computation
// lives in two places — the form (`tempNum >= 2 && tempNum <= 8`) and
// the derivation rule (which reads the boolean as-is). The action does
// NOT recompute inRange; it trusts the client value. So the boundary
// semantics under test here are (1) zod's clamp + (2) the projection
// honoring whatever inRange flag the caller supplied.

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
      firebaseUid: `tb-${Math.random().toString(36).slice(2, 10)}`,
      email: `tb-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Temp Boundary Practice", primaryState: "AZ" },
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

describe("Audit #21 / Allergy MIN-3 — REFRIGERATOR_TEMP in-range boundary", () => {
  it("accepts 2.0°C with inRange=true (lower edge inclusive)", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 2.0,
        inRange: true,
      }),
    ).resolves.toBeUndefined();
    const row = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
    });
    expect(row.temperatureC).toBe(2.0);
    expect(row.inRange).toBe(true);
  });

  it("accepts 8.0°C with inRange=true (upper edge inclusive)", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 8.0,
        inRange: true,
      }),
    ).resolves.toBeUndefined();
    const row = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
    });
    expect(row.temperatureC).toBe(8.0);
    expect(row.inRange).toBe(true);
  });

  it("accepts 1.99°C with inRange=false (just below lower edge)", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 1.99,
        inRange: false,
      }),
    ).resolves.toBeUndefined();
    const row = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
    });
    expect(row.inRange).toBe(false);
  });

  it("accepts 8.01°C with inRange=false (just above upper edge)", async () => {
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 8.01,
        inRange: false,
      }),
    ).resolves.toBeUndefined();
    const row = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
    });
    expect(row.inRange).toBe(false);
  });
});

describe("Audit #21 / Allergy MIN-4 — REFRIGERATOR_TEMP implausible-reading clamp", () => {
  // The zod validator on EquipmentInput.temperatureC is .min(-20).max(40).
  // -30 and 30 are at / outside the absolute clamp boundary — the lower
  // value should be rejected, the upper accepted (still within max=40).
  // This guards two regression directions at once: someone removes the
  // min/max clamp; someone tightens it without updating the constants.

  it("rejects -30°C as below the action's absolute clamp (zod min=-20)", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: -30,
        inRange: false,
      }),
    ).rejects.toThrow();
  });

  it("accepts 30°C (within the action's clamp band, even though out of fridge range)", async () => {
    // 30°C exceeds the 8°C fridge ceiling → inRange=false, but is still
    // within the action's broad ±20/+40 plausibility band, so it must
    // persist. The form-layer warning surfaces "unusual reading" but
    // does not block submission.
    const { practice } = await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 30,
        inRange: false,
      }),
    ).resolves.toBeUndefined();
    const row = await db.allergyEquipmentCheck.findFirstOrThrow({
      where: { practiceId: practice.id, checkType: "REFRIGERATOR_TEMP" },
    });
    expect(row.temperatureC).toBe(30);
    expect(row.inRange).toBe(false);
  });

  it("rejects NaN temperature (zod treats as invalid number)", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: Number.NaN,
        inRange: false,
      }),
    ).rejects.toThrow();
  });

  it("rejects Infinity temperature (above zod max=40)", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: Number.POSITIVE_INFINITY,
        inRange: false,
      }),
    ).rejects.toThrow();
  });

  it("rejects -Infinity temperature (below zod min=-20)", async () => {
    await seedOwner();
    const { logEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logEquipmentCheckAction({
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: Number.NEGATIVE_INFINITY,
        inRange: false,
      }),
    ).rejects.toThrow();
  });
});
