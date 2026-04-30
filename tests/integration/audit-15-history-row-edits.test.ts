// tests/integration/audit-15-history-row-edits.test.ts
//
// Audit #15 (2026-04-30): Edit/Delete affordances on history rows.
// Verifies the action layer + projection layer + derivation interaction
// for the 5 new event types:
//   - ALLERGY_DRILL_UPDATED / _DELETED
//   - ALLERGY_EQUIPMENT_CHECK_UPDATED / _DELETED
//   - INCIDENT_OSHA_OUTCOME_UPDATED
//
// Coverage:
//   - Role gates: STAFF rejected, ADMIN allowed
//   - Cross-tenant: editing/deleting another practice's row throws
//   - Soft-delete sets retiredAt and re-derives the matching rule back
//     to NOT_STARTED when the deleted row was the only one
//   - Edits update the row in place; retired rows refuse subsequent
//     edits

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  // Reuse the same global the role-gate-sweep test uses so a single
  // auth mock works for both files in the same test run.
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

async function seedPracticeWithUser(
  role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER",
) {
  const user = await db.user.create({
    data: {
      firebaseUid: `a15-${Math.random().toString(36).slice(2, 10)}`,
      email: `a15-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `A15 ${role} Practice`, primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__roleSweepTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, pu };
}

describe("Audit #15 — drill edit/delete", () => {
  it("updateDrillAction rejects STAFF callers", async () => {
    const { practice, pu } = await seedPracticeWithUser("STAFF");
    const drill = await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: pu.id,
        conductedAt: new Date(),
        scenario: "Original scenario",
        participantIds: [pu.id],
      },
    });
    const { updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      updateDrillAction({
        drillId: drill.id,
        conductedAt: "2026-04-30",
        scenario: "Edited scenario",
        participantIds: [pu.id],
      }),
    ).rejects.toThrow(/Only owners and admins/);
  });

  it("updateDrillAction rejects cross-tenant drill", async () => {
    const { pu } = await seedPracticeWithUser("ADMIN");
    // Drill belongs to a DIFFERENT practice.
    const otherPractice = await db.practice.create({
      data: { name: "Other practice", primaryState: "TX" },
    });
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `a15-other-${Math.random().toString(36).slice(2, 10)}`,
        email: `a15-other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "OWNER" },
    });
    const drill = await db.allergyDrill.create({
      data: {
        practiceId: otherPractice.id,
        conductedById: otherPu.id,
        conductedAt: new Date(),
        scenario: "Other practice's drill",
        participantIds: [otherPu.id],
      },
    });
    const { updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      updateDrillAction({
        drillId: drill.id,
        conductedAt: "2026-04-30",
        scenario: "Hijack attempt",
        participantIds: [pu.id],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("updateDrillAction edits an existing drill in place", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const drill = await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: pu.id,
        conductedAt: new Date("2026-01-01T00:00:00Z"),
        scenario: "Typo scenarioo",
        participantIds: [pu.id],
      },
    });
    const { updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await updateDrillAction({
      drillId: drill.id,
      conductedAt: "2026-04-15",
      scenario: "Fixed scenario",
      participantIds: [pu.id],
      observations: "Went well",
    });
    const after = await db.allergyDrill.findUnique({ where: { id: drill.id } });
    expect(after?.scenario).toBe("Fixed scenario");
    expect(after?.observations).toBe("Went well");
    expect(after?.conductedAt.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    // conductedById preserved (original conductor stays).
    expect(after?.conductedById).toBe(pu.id);
  });

  it("deleteDrillAction soft-deletes (sets retiredAt) and is idempotent", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const drill = await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: pu.id,
        conductedAt: new Date(),
        scenario: "To delete",
        participantIds: [pu.id],
      },
    });
    const { deleteDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await deleteDrillAction({ drillId: drill.id });
    const afterFirst = await db.allergyDrill.findUnique({
      where: { id: drill.id },
    });
    expect(afterFirst?.retiredAt).not.toBeNull();
    const firstRetiredAt = afterFirst?.retiredAt;

    // Idempotent: re-deleting leaves retiredAt unchanged.
    await deleteDrillAction({ drillId: drill.id });
    const afterSecond = await db.allergyDrill.findUnique({
      where: { id: drill.id },
    });
    expect(afterSecond?.retiredAt?.toISOString()).toBe(
      firstRetiredAt?.toISOString(),
    );
  });

  it("updateDrillAction refuses to edit a retired drill", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const drill = await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: pu.id,
        conductedAt: new Date(),
        scenario: "Already retired",
        participantIds: [pu.id],
        retiredAt: new Date(),
      },
    });
    const { updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      updateDrillAction({
        drillId: drill.id,
        conductedAt: "2026-04-30",
        scenario: "Try to edit",
        participantIds: [pu.id],
      }),
    ).rejects.toThrow(/retired/i);
  });
});

describe("Audit #15 — equipment check edit/delete", () => {
  it("updateEquipmentCheckAction rejects STAFF callers", async () => {
    const { practice, pu } = await seedPracticeWithUser("STAFF");
    const check = await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: pu.id,
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 5.0,
        inRange: true,
      },
    });
    const { updateEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      updateEquipmentCheckAction({
        equipmentCheckId: check.id,
        temperatureC: 6.0,
        inRange: true,
      }),
    ).rejects.toThrow(/Only owners and admins/);
  });

  it("deleteEquipmentCheckAction soft-deletes a fridge reading", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const check = await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: pu.id,
        checkType: "REFRIGERATOR_TEMP",
        temperatureC: 5.0,
        inRange: true,
      },
    });
    const { deleteEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await deleteEquipmentCheckAction({ equipmentCheckId: check.id });
    const after = await db.allergyEquipmentCheck.findUnique({
      where: { id: check.id },
    });
    expect(after?.retiredAt).not.toBeNull();
  });

  it("retired equipment checks are skipped by deriveAllergyEmergencyKit", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    // Single kit check, then retire it. Derivation should fall back to
    // NOT_STARTED (no remaining live rows).
    const check = await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: pu.id,
        checkType: "EMERGENCY_KIT",
        allItemsPresent: true,
      },
    });
    const { deleteEquipmentCheckAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await deleteEquipmentCheckAction({ equipmentCheckId: check.id });
    const { deriveAllergyEmergencyKit } = await import(
      "@/lib/compliance/derivation/allergy"
    );
    const status = await deriveAllergyEmergencyKit(db, practice.id);
    expect(status).toBe("NOT_STARTED");
  });
});

describe("Audit #15 — incident OSHA outcome edit", () => {
  it("updateIncidentOshaOutcomeAction rejects STAFF callers", async () => {
    const { practice, pu } = await seedPracticeWithUser("STAFF");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: pu.userId,
        title: "Test injury",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        discoveredAt: new Date(),
        oshaOutcome: "DAYS_AWAY",
      },
    });
    const { updateIncidentOshaOutcomeAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      updateIncidentOshaOutcomeAction({
        incidentId: incident.id,
        oshaOutcome: "FIRST_AID",
      }),
    ).rejects.toThrow();
  });

  it("updateIncidentOshaOutcomeAction edits OSHA fields on existing incident", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: pu.userId,
        title: "Needlestick",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        discoveredAt: new Date(),
        oshaBodyPart: "Hand",
        oshaInjuryNature: "Needlestick",
        oshaOutcome: "DAYS_AWAY",
      },
    });
    const { updateIncidentOshaOutcomeAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await updateIncidentOshaOutcomeAction({
      incidentId: incident.id,
      oshaBodyPart: "Right hand",
      oshaInjuryNature: "Needlestick (hollow-bore)",
      oshaOutcome: "FIRST_AID",
      sharpsDeviceType: "Hollow-bore needle",
      injuredUserId: pu.userId,
    });
    const after = await db.incident.findUnique({
      where: { id: incident.id },
    });
    expect(after?.oshaBodyPart).toBe("Right hand");
    expect(after?.oshaOutcome).toBe("FIRST_AID");
    expect(after?.sharpsDeviceType).toBe("Hollow-bore needle");
    expect(after?.injuredUserId).toBe(pu.userId);
  });

  it("updateIncidentOshaOutcomeAction rejects non-OSHA incident types", async () => {
    const { practice, pu } = await seedPracticeWithUser("ADMIN");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: pu.userId,
        title: "PHI exposure",
        description: "Test",
        type: "PRIVACY",
        severity: "MEDIUM",
        phiInvolved: true,
        discoveredAt: new Date(),
      },
    });
    const { updateIncidentOshaOutcomeAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      updateIncidentOshaOutcomeAction({
        incidentId: incident.id,
        oshaOutcome: "FIRST_AID",
      }),
    ).rejects.toThrow(/OSHA_RECORDABLE/);
  });

  it("updateIncidentOshaOutcomeAction rejects cross-tenant incident", async () => {
    await seedPracticeWithUser("ADMIN");
    const otherPractice = await db.practice.create({
      data: { name: "Cross-tenant practice", primaryState: "CA" },
    });
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `a15-x-${Math.random().toString(36).slice(2, 10)}`,
        email: `a15-x-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const incident = await db.incident.create({
      data: {
        practiceId: otherPractice.id,
        reportedByUserId: otherUser.id,
        title: "Other practice incident",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        discoveredAt: new Date(),
      },
    });
    const { updateIncidentOshaOutcomeAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      updateIncidentOshaOutcomeAction({
        incidentId: incident.id,
        oshaOutcome: "DEATH",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
