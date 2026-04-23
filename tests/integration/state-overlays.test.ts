// tests/integration/state-overlays.test.ts
//
// Verifies that jurisdictionFilter on RegulatoryRequirement is honored
// end-to-end: an AZ-only practice never sees or scores against CA-only
// requirements, and a CA practice does. Also covers multi-state
// practices (operatingStates) and score math scoped to jurisdiction.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { recomputeFrameworkScore } from "@/lib/events/projections/frameworkScore";
import {
  getPracticeJurisdictions,
  requirementAppliesToJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";

async function seedFrameworkWithOverlay() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `state-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });

  // Uses a dedicated test framework (not HIPAA) so other seeded
  // requirements don't pollute the denominator when we compute scores.
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "STATE_OVERLAY_TEST" },
    update: {},
    create: {
      code: "STATE_OVERLAY_TEST",
      name: "State Overlay Test Framework",
      description: "Isolated framework used by state-overlay tests only.",
      jurisdiction: "federal",
      weightDefault: 0.1,
      scoringStrategy: "STANDARD_CHECKLIST",
      sortOrder: 9999,
    },
  });

  const federalReq = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "STATE_TEST_FEDERAL_REQ",
      },
    },
    update: { jurisdictionFilter: [] },
    create: {
      frameworkId: framework.id,
      code: "STATE_TEST_FEDERAL_REQ",
      title: "Federal requirement (all jurisdictions)",
      severity: "STANDARD",
      weight: 1,
      description: "Applies everywhere.",
      jurisdictionFilter: [],
      acceptedEvidenceTypes: [],
      sortOrder: 900,
    },
  });

  const caOnlyReq = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "STATE_TEST_CA_ONLY_REQ",
      },
    },
    update: { jurisdictionFilter: ["CA"] },
    create: {
      frameworkId: framework.id,
      code: "STATE_TEST_CA_ONLY_REQ",
      title: "California-only state overlay",
      severity: "STANDARD",
      weight: 1,
      description: "Applies only in CA.",
      jurisdictionFilter: ["CA"],
      acceptedEvidenceTypes: [],
      sortOrder: 910,
    },
  });

  return { user, framework, federalReq, caOnlyReq };
}

async function seedPractice(
  primaryState: string,
  operatingStates: string[] = [],
) {
  return db.practice.create({
    data: { name: `Test ${primaryState}`, primaryState, operatingStates },
  });
}

describe("State overlays — jurisdictionFilter", () => {
  it("getPracticeJurisdictions merges primaryState + operatingStates", () => {
    expect(
      getPracticeJurisdictions({
        primaryState: "AZ",
        operatingStates: ["CA", "TX"],
      }),
    ).toEqual(["AZ", "CA", "TX"]);
  });

  it("getPracticeJurisdictions de-dupes when primary appears in operating", () => {
    expect(
      getPracticeJurisdictions({
        primaryState: "CA",
        operatingStates: ["CA", "NV"],
      }),
    ).toEqual(["CA", "NV"]);
  });

  it("requirementAppliesToJurisdictions: federal requirement always applies", () => {
    expect(
      requirementAppliesToJurisdictions({ jurisdictionFilter: [] }, ["AZ"]),
    ).toBe(true);
  });

  it("requirementAppliesToJurisdictions: CA-only requirement hidden from AZ practice", () => {
    expect(
      requirementAppliesToJurisdictions({ jurisdictionFilter: ["CA"] }, ["AZ"]),
    ).toBe(false);
  });

  it("requirementAppliesToJurisdictions: CA-only requirement visible to CA+AZ practice", () => {
    expect(
      requirementAppliesToJurisdictions({ jurisdictionFilter: ["CA"] }, [
        "AZ",
        "CA",
      ]),
    ).toBe(true);
  });

  it("AZ practice only sees federal requirements under jurisdictionRequirementFilter", async () => {
    const { framework, federalReq, caOnlyReq } = await seedFrameworkWithOverlay();
    const practice = await seedPractice("AZ");

    const visible = await db.regulatoryRequirement.findMany({
      where: {
        frameworkId: framework.id,
        ...jurisdictionRequirementFilter(getPracticeJurisdictions(practice)),
      },
      select: { id: true, code: true },
    });
    const codes = visible.map((v) => v.code);
    expect(codes).toContain(federalReq.code);
    expect(codes).not.toContain(caOnlyReq.code);
  });

  it("CA practice sees federal + CA-only requirements", async () => {
    const { framework, federalReq, caOnlyReq } = await seedFrameworkWithOverlay();
    const practice = await seedPractice("CA");

    const visible = await db.regulatoryRequirement.findMany({
      where: {
        frameworkId: framework.id,
        ...jurisdictionRequirementFilter(getPracticeJurisdictions(practice)),
      },
      select: { id: true, code: true },
    });
    const codes = visible.map((v) => v.code);
    expect(codes).toContain(federalReq.code);
    expect(codes).toContain(caOnlyReq.code);
  });

  it("AZ practice with CA in operatingStates sees the CA overlay", async () => {
    const { framework, caOnlyReq } = await seedFrameworkWithOverlay();
    const practice = await seedPractice("AZ", ["CA"]);

    const visible = await db.regulatoryRequirement.findMany({
      where: {
        frameworkId: framework.id,
        ...jurisdictionRequirementFilter(getPracticeJurisdictions(practice)),
      },
      select: { code: true },
    });
    expect(visible.map((v) => v.code)).toContain(caOnlyReq.code);
  });

  it("recomputeFrameworkScore uses only jurisdiction-scoped requirements in the denominator", async () => {
    const { framework, federalReq } = await seedFrameworkWithOverlay();
    const practice = await seedPractice("AZ");
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: framework.id, enabled: true },
    });
    // Mark the federal requirement COMPLIANT.
    await db.complianceItem.create({
      data: {
        practiceId: practice.id,
        requirementId: federalReq.id,
        status: "COMPLIANT",
      },
    });

    await db.$transaction(async (tx) => {
      await recomputeFrameworkScore(tx, practice.id, framework.id);
    });

    const pf = await db.practiceFramework.findUniqueOrThrow({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    // AZ practice: CA overlay isn't in the denominator. 1 of 1 federal
    // requirement marked COMPLIANT = score 100.
    expect(pf.scoreCache).toBe(100);
  });

  it("recomputeFrameworkScore for a CA practice counts the overlay in the denominator", async () => {
    const { framework, federalReq } = await seedFrameworkWithOverlay();
    const practice = await seedPractice("CA");
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: framework.id, enabled: true },
    });
    await db.complianceItem.create({
      data: {
        practiceId: practice.id,
        requirementId: federalReq.id,
        status: "COMPLIANT",
      },
    });

    await db.$transaction(async (tx) => {
      await recomputeFrameworkScore(tx, practice.id, framework.id);
    });

    const pf = await db.practiceFramework.findUniqueOrThrow({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    // CA practice: overlay IS in the denominator. 1 of 2 COMPLIANT = 50.
    expect(pf.scoreCache).toBe(50);
  });
});
