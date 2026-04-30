// tests/integration/allergy-end-to-end.test.ts
//
// Audit #14 / #20 (Allergy B-1): "Logging fridge readings + drills
// doesn't flip /modules/allergy requirements to COMPLIANT."
//
// The audit hedged between "projection missing rederive call" or
// "framework gating suppresses rule computation". Neither hypothesis
// matches the current code:
//   - allergyEquipment.ts:44-58 calls rederiveRequirementStatus
//   - allergyDrill.ts:41 calls rederiveRequirementStatus
//   - rederive.ts dispatches to deriveAllergy* rules which return
//     COMPLIANT when valid evidence exists in window
//
// Existing tests cover the projection insert path
// (allergy-equipment.test.ts) and the rederive-direct path
// (allergy-derivation.test.ts) but NOT the full end-to-end through
// appendEventAndApply → projection → rederive → ComplianceItem.
// This test fills that gap as a regression guard so a future change
// to the rederive dispatch or the projection cannot silently break
// the COMPLIANT flip.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import { randomUUID } from "node:crypto";

async function seedAllergyEnabledPractice() {
  // Framework + the 3 derived requirements (skip ALLERGY_COMPETENCY —
  // covered by allergy-derivation.test.ts already).
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "ALLERGY" },
    update: {},
    create: {
      code: "ALLERGY",
      name: "Allergy / USP 797 §21",
      description: "test",
      sortOrder: 100,
    },
  });
  for (const r of [
    { code: "ALLERGY_EMERGENCY_KIT_CURRENT", title: "Emergency kit current" },
    { code: "ALLERGY_REFRIGERATOR_LOG", title: "Refrigerator log within 30d" },
    { code: "ALLERGY_ANNUAL_DRILL", title: "Anaphylaxis drill within 365d" },
  ]) {
    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId: fw.id, code: r.code } },
      update: { acceptedEvidenceTypes: [r.code] },
      create: {
        code: r.code,
        title: r.title,
        description: r.title,
        frameworkId: fw.id,
        severity: "HIGH",
        weight: 1,
        acceptedEvidenceTypes: [r.code],
      },
    });
  }
  const owner = await db.user.create({
    data: {
      firebaseUid: `e2e-${Math.random().toString(36).slice(2, 10)}`,
      email: `e2e-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "E2E Allergy Test", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  await db.practiceFramework.create({
    data: {
      practiceId: practice.id,
      frameworkId: fw.id,
      enabled: true,
      enabledAt: new Date(),
      scoreCache: 0,
      scoreLabel: "At Risk",
      lastScoredAt: new Date(),
    },
  });
  return { owner, ownerPu, practice, framework: fw };
}

describe("Audit #14 — Allergy projection → rederive → ComplianceItem end-to-end", () => {
  it("ALLERGY_EQUIPMENT_CHECK_LOGGED (EMERGENCY_KIT, valid) flips ALLERGY_EMERGENCY_KIT_CURRENT → COMPLIANT", async () => {
    const { owner, ownerPu, practice } = await seedAllergyEnabledPractice();

    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "EMERGENCY_KIT" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      epiLotNumber: "LOT-E2E-001",
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

    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_EMERGENCY_KIT_CURRENT" },
      },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_EQUIPMENT_CHECK_LOGGED (REFRIGERATOR_TEMP, in-range) flips ALLERGY_REFRIGERATOR_LOG → COMPLIANT", async () => {
    const { owner, ownerPu, practice } = await seedAllergyEnabledPractice();

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

    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_REFRIGERATOR_LOG" },
      },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_DRILL_LOGGED (recent) flips ALLERGY_ANNUAL_DRILL → COMPLIANT", async () => {
    const { owner, ownerPu, practice } = await seedAllergyEnabledPractice();

    const id = randomUUID();
    const payload = {
      drillId: id,
      conductedByUserId: ownerPu.id,
      conductedAt: new Date().toISOString(),
      scenario: "Patient develops anaphylaxis 5 minutes after injection",
      participantIds: [ownerPu.id],
      durationMinutes: 30,
      observations: null,
      correctiveActions: null,
      nextDrillDue: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_DRILL_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyDrillLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_ANNUAL_DRILL" },
      },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("EMERGENCY_KIT with allItemsPresent=false → GAP (not COMPLIANT)", async () => {
    const { owner, ownerPu, practice } = await seedAllergyEnabledPractice();

    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "EMERGENCY_KIT" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      epiLotNumber: "LOT-GAP",
      allItemsPresent: false,
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

    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_EMERGENCY_KIT_CURRENT" },
      },
    });
    expect(item.status).toBe("GAP");
  });

  it("REFRIGERATOR_TEMP with inRange=false → GAP", async () => {
    const { owner, ownerPu, practice } = await seedAllergyEnabledPractice();

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
      temperatureC: 12.0,
      inRange: false,
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

    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_REFRIGERATOR_LOG" },
      },
    });
    expect(item.status).toBe("GAP");
  });
});
