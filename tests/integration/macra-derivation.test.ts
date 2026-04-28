// tests/integration/macra-derivation.test.ts
//
// Integration tests for the MACRA derivation rules added in PR 6.
// Covers the five rules driven by MACRA_ACTIVITY_LOGGED events plus the
// cross-framework SRA reuse rule:
//   1. MACRA_IMPROVEMENT_ACTIVITIES   — ≥2 IMPROVEMENT activities for the year
//   2. MACRA_ANNUAL_DATA_SUBMISSION   — ≥1 SUBMISSION activity for the year
//   3. MACRA_MIPS_EXEMPTION_VERIFIED  — ≥1 QUALITY activity for the year (proxy)
//   4. MACRA_PROMOTING_INTEROPERABILITY — ≥1 PI activity for the year
//   5. MACRA_SECURITY_RISK_ANALYSIS   — ≥1 completed SraAssessment (cross-framework)
// Also covers the GAP path (1 IMPROVEMENT activity is not enough) and the
// year-scoping (last year's activities don't satisfy this year's rule).

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectMacraActivityLogged } from "@/lib/events/projections/macraActivity";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function seedMacra() {
  const user = await db.user.create({
    data: {
      firebaseUid: `macra-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `macra-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "MACRA Derivation Test Clinic", primaryState: "GA" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "MACRA" },
  });
  const reqs = await db.regulatoryRequirement.findMany({
    where: { frameworkId: framework.id },
  });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

async function logActivity(
  practiceId: string,
  userId: string,
  activityType: "QUALITY" | "IMPROVEMENT" | "PI" | "SUBMISSION",
  attestationYear: number,
  suffix: string,
) {
  const payload = {
    activityId: randomUUID(),
    loggedByUserId: userId,
    activityCode: `${activityType}_${suffix}`,
    activityType,
    attestationYear,
    activityName: `${activityType} activity ${suffix}`,
    notes: null,
  };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "MACRA_ACTIVITY_LOGGED",
      payload,
    },
    async (tx) =>
      projectMacraActivityLogged(tx, { practiceId, payload }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MACRA derivation rules", () => {
  it("MACRA_ACTIVITY_LOGGED (IMPROVEMENT type, 2+) flips MACRA_IMPROVEMENT_ACTIVITIES to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_IMPROVEMENT_ACTIVITIES")!;
    expect(req).toBeDefined();
    const year = new Date().getFullYear();

    await logActivity(practice.id, user.id, "IMPROVEMENT", year, "1");
    await logActivity(practice.id, user.id, "IMPROVEMENT", year, "2");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("MACRA_IMPROVEMENT_ACTIVITIES stays GAP with only 1 IMPROVEMENT activity", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_IMPROVEMENT_ACTIVITIES")!;
    expect(req).toBeDefined();
    const year = new Date().getFullYear();

    await logActivity(practice.id, user.id, "IMPROVEMENT", year, "1");

    expect(await statusOf(practice.id, req.id)).toBe("GAP");
  });

  it("MACRA_IMPROVEMENT_ACTIVITIES is year-scoped — last year's activities don't credit this year", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_IMPROVEMENT_ACTIVITIES")!;
    expect(req).toBeDefined();
    const lastYear = new Date().getFullYear() - 1;

    await logActivity(practice.id, user.id, "IMPROVEMENT", lastYear, "1");
    await logActivity(practice.id, user.id, "IMPROVEMENT", lastYear, "2");

    expect(await statusOf(practice.id, req.id)).toBe("GAP");
  });

  it("MACRA_ACTIVITY_LOGGED (SUBMISSION type) flips MACRA_ANNUAL_DATA_SUBMISSION to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_ANNUAL_DATA_SUBMISSION")!;
    expect(req).toBeDefined();
    const year = new Date().getFullYear();

    await logActivity(practice.id, user.id, "SUBMISSION", year, "QPP");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("MACRA_ACTIVITY_LOGGED (QUALITY type) flips MACRA_MIPS_EXEMPTION_VERIFIED to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_MIPS_EXEMPTION_VERIFIED")!;
    expect(req).toBeDefined();
    const year = new Date().getFullYear();

    await logActivity(practice.id, user.id, "QUALITY", year, "MEAS_1");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("MACRA_ACTIVITY_LOGGED (PI type) flips MACRA_PROMOTING_INTEROPERABILITY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_PROMOTING_INTEROPERABILITY")!;
    expect(req).toBeDefined();
    const year = new Date().getFullYear();

    await logActivity(practice.id, user.id, "PI", year, "EPRX");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Completing the HIPAA SRA flips MACRA_SECURITY_RISK_ANALYSIS to COMPLIANT (cross-framework)", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_SECURITY_RISK_ANALYSIS")!;
    expect(req).toBeDefined();

    // Seed a single SRA question so projectSraCompleted can resolve the
    // questionCode → questionId mapping. The MACRA SRA rule itself only
    // counts SraAssessment.completedAt rows, so the answer content is
    // not material to this test — we just need a valid event to flow
    // through the projection.
    const sraQ = await db.sraQuestion.upsert({
      where: { code: "MACRA_TEST_Q1" },
      update: {},
      create: {
        code: "MACRA_TEST_Q1",
        category: "ADMINISTRATIVE",
        subcategory: "MACRA cross-framework test",
        title: "Test question for MACRA SRA cross-framework derivation",
        description: "Stub question used by the MACRA derivation test only.",
        sortOrder: 9999,
      },
    });
    expect(sraQ).toBeDefined();

    const sraPayload = {
      assessmentId: randomUUID(),
      completedByUserId: user.id,
      overallScore: 90,
      addressedCount: 1,
      totalCount: 1,
      answers: [
        {
          questionCode: "MACRA_TEST_Q1",
          answer: "YES" as const,
          notes: null,
        },
      ],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "SRA_COMPLETED",
        payload: sraPayload,
      },
      async (tx) =>
        projectSraCompleted(tx, { practiceId: practice.id, payload: sraPayload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
