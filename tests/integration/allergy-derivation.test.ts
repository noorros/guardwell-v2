import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

async function seedFrameworkAndPractice() {
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "ALLERGY" },
    update: {},
    create: { code: "ALLERGY", name: "Allergy / USP 797 §21", description: "test", sortOrder: 100 },
  });
  // 4 derived requirements (others are policy-attestation).
  // acceptedEvidenceTypes mirrors the requirement code so the rederive
  // dispatcher finds the requirement when called with that code.
  for (const r of [
    { code: "ALLERGY_COMPETENCY", title: "Annual 3-component competency", severity: "CRITICAL", weight: 1 },
    { code: "ALLERGY_EMERGENCY_KIT_CURRENT", title: "Emergency kit current", severity: "HIGH", weight: 1 },
    { code: "ALLERGY_REFRIGERATOR_LOG", title: "Refrigerator log within 30d", severity: "HIGH", weight: 1 },
    { code: "ALLERGY_ANNUAL_DRILL", title: "Anaphylaxis drill within 365d", severity: "HIGH", weight: 1 },
  ]) {
    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId: fw.id, code: r.code } },
      update: { acceptedEvidenceTypes: [r.code] },
      create: {
        code: r.code,
        title: r.title,
        description: r.title,
        frameworkId: fw.id,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: [r.code],
      },
    });
  }
  const owner = await db.user.create({
    data: {
      firebaseUid: `der-${Math.random().toString(36).slice(2, 10)}`,
      email: `d-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Derive Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
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
  return { practice, owner, framework: fw };
}

describe("Allergy derivations", () => {
  it("ALLERGY_COMPETENCY → COMPLIANT only when all required compounders are isFullyQualified", async () => {
    const { practice } = await seedFrameworkAndPractice();
    const compounder = await db.user.create({
      data: {
        firebaseUid: `c-${Math.random().toString(36).slice(2, 10)}`,
        email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const compounderPu = await db.practiceUser.create({
      data: {
        userId: compounder.id,
        practiceId: practice.id,
        role: "STAFF",
        requiresAllergyCompetency: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_COMPETENCY");
    });
    let item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_COMPETENCY" } },
    });
    expect(item.status).toBe("GAP");
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: new Date().getFullYear(),
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(),
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_COMPETENCY");
    });
    item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_COMPETENCY" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_EMERGENCY_KIT_CURRENT → COMPLIANT when latest EMERGENCY_KIT check ≤90 days, allItemsPresent=true, epi not expired", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date(),
        epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        allItemsPresent: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_EMERGENCY_KIT_CURRENT");
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_EMERGENCY_KIT_CURRENT" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_REFRIGERATOR_LOG → COMPLIANT when ≥1 in-range REFRIGERATOR_TEMP check in last 30 days", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        temperatureC: 5.0,
        inRange: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_REFRIGERATOR_LOG");
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_REFRIGERATOR_LOG" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_ANNUAL_DRILL → COMPLIANT when most recent drill within 365 days", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: ownerPu.id,
        conductedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        scenario: "Patient develops anaphylaxis 5 minutes after injection",
        participantIds: [ownerPu.id],
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_ANNUAL_DRILL");
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_ANNUAL_DRILL" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });
});
