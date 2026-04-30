// tests/integration/concierge-tools.test.ts
//
// Integration tests for the Concierge tool registry added in Phase 2 PR A2
// and expanded in PR-C5 (audit #21 IM-4 + IM-9). Each test seeds a fresh
// practice and exercises a tool handler via invokeTool() — no mocking,
// real Postgres queries.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { invokeTool } from "@/lib/ai/conciergeTools";

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `concierge-tools-${Math.random().toString(36).slice(2, 10)}`,
      email: `concierge-tools-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Concierge Tools Test", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("Concierge tool registry", () => {
  it("list_frameworks returns enrolled frameworks with score + counts", async () => {
    const { practice } = await seedPractice();
    const fw = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
    });
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fw.id,
        enabled: true,
        scoreCache: 73,
      },
    });
    const { output, error } = await invokeTool({
      toolName: "list_frameworks",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as { frameworks: Array<{ code: string; score: number }> };
    expect(result.frameworks.find((f) => f.code === "HIPAA")?.score).toBe(73);
  });

  it("list_requirements_by_framework returns requirements with status", async () => {
    const { practice } = await seedPractice();
    const fw = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
    });
    const reqs = await db.regulatoryRequirement.findMany({
      where: { frameworkId: fw.id },
      take: 1,
    });
    const firstReq = reqs[0];
    expect(firstReq).toBeDefined();
    if (!firstReq) throw new Error("expected at least one HIPAA requirement seeded");
    await db.complianceItem.create({
      data: {
        practiceId: practice.id,
        requirementId: firstReq.id,
        status: "COMPLIANT",
      },
    });
    const { output, error } = await invokeTool({
      toolName: "list_requirements_by_framework",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: { frameworkCode: "HIPAA" },
    });
    expect(error).toBeNull();
    const result = output as {
      requirements: Array<{ code: string; status: string }>;
    };
    const found = result.requirements.find((r) => r.code === firstReq.code);
    expect(found?.status).toBe("COMPLIANT");
  });

  it("list_requirements_by_framework returns error for unknown framework code", async () => {
    const { practice } = await seedPractice();
    const { output } = await invokeTool({
      toolName: "list_requirements_by_framework",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: { frameworkCode: "BOGUS" },
    });
    const result = output as { error?: string; requirements: unknown[] };
    expect(result.error).toContain("Unknown framework");
    expect(result.requirements).toEqual([]);
  });

  it("get_dashboard_snapshot computes overall score + open incident count", async () => {
    const { user, practice } = await seedPractice();
    const fw = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
    });
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: fw.id, enabled: true, scoreCache: 80 },
    });
    // Score is computed via the canonical computeOverallScore() helper —
    // count of COMPLIANT ComplianceItem rows / count of applicable
    // RegulatoryRequirements (jurisdiction-filtered). Seed an applicable
    // requirement set + mark exactly one COMPLIANT so we can assert the
    // exact ratio.
    const applicableReqs = await db.regulatoryRequirement.findMany({
      where: {
        frameworkId: fw.id,
        OR: [
          { jurisdictionFilter: { isEmpty: true } },
          { jurisdictionFilter: { hasSome: ["TX"] } },
        ],
      },
      select: { id: true },
      take: 4,
    });
    expect(applicableReqs.length).toBe(4);
    // 1 COMPLIANT out of 4 applicable across the entire practice = 25%.
    // (The 4 we seeded are the only ComplianceItem rows for this practice.
    // The denominator over ALL applicable requirements is much larger,
    // so we instead assert the score is a small positive number — proves
    // the helper found the COMPLIANT row and divided by the right
    // denominator.)
    await db.complianceItem.create({
      data: {
        practiceId: practice.id,
        requirementId: applicableReqs[0]!.id,
        status: "COMPLIANT",
      },
    });
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Test incident",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        discoveredAt: new Date(),
        reportedByUserId: user.id,
      },
    });
    const { output, error } = await invokeTool({
      toolName: "get_dashboard_snapshot",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      overallScore: number;
      frameworkCount: number;
      openIncidentCount: number;
    };
    // Score = round(1 / totalApplicable * 100) — small positive integer.
    // Assert it's > 0 (proved we found the COMPLIANT row) and < 100
    // (proved we divided by all applicable, not just the seeded items).
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.overallScore).toBeLessThan(100);
    expect(result.frameworkCount).toBe(1);
    expect(result.openIncidentCount).toBe(1);
  });

  it("unknown tool name returns error", async () => {
    const { practice } = await seedPractice();
    const { output, error } = await invokeTool({
      toolName: "nonexistent_tool",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(output).toBeNull();
    expect(error).toContain("Unknown tool");
  });

  it("invalid tool input returns INPUT_SCHEMA error", async () => {
    const { practice } = await seedPractice();
    const { error } = await invokeTool({
      toolName: "list_requirements_by_framework",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: { frameworkCode: 12345 }, // wrong type
    });
    expect(error).toContain("INPUT_SCHEMA");
  });

  it("list_credentials derives ACTIVE / EXPIRING_SOON / EXPIRED / NO_EXPIRY status from expiryDate", async () => {
    const { practice } = await seedPractice();
    // Reuse a seeded CredentialType — credential-projection.test.ts shows
    // MD_STATE_LICENSE is in the master seed.
    const credType = await db.credentialType.findUniqueOrThrow({
      where: { code: "MD_STATE_LICENSE" },
    });
    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;
    // ACTIVE: 100 days from now (well past 90-day window)
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Active license",
        expiryDate: new Date(now.getTime() + 100 * DAY_MS),
      },
    });
    // EXPIRING_SOON: 30 days from now
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Expiring soon license",
        expiryDate: new Date(now.getTime() + 30 * DAY_MS),
      },
    });
    // EXPIRED: 5 days ago
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Expired license",
        expiryDate: new Date(now.getTime() - 5 * DAY_MS),
      },
    });
    // NO_EXPIRY: null expiryDate
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Permanent license",
        expiryDate: null,
      },
    });

    const { output, error } = await invokeTool({
      toolName: "list_credentials",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      credentials: Array<{
        title: string;
        status: string;
        credentialTypeCode: string;
        regulation: { code: string; display: string; title: string } | null;
      }>;
    };
    const byTitle = new Map(result.credentials.map((c) => [c.title, c.status]));
    expect(byTitle.get("Active license")).toBe("ACTIVE");
    expect(byTitle.get("Expiring soon license")).toBe("EXPIRING_SOON");
    expect(byTitle.get("Expired license")).toBe("EXPIRED");
    expect(byTitle.get("Permanent license")).toBe("NO_EXPIRY");
    // Status-priority order: EXPIRED → EXPIRING_SOON → ACTIVE → NO_EXPIRY
    expect(result.credentials.map((c) => c.status)).toEqual([
      "EXPIRED",
      "EXPIRING_SOON",
      "ACTIVE",
      "NO_EXPIRY",
    ]);
    // Audit #21 IM-8 (PR-C6): every MD_STATE_LICENSE row should carry
    // a state-board citation so the Concierge LLM has a regulation to
    // anchor on when the user asks "why does this need to be on file".
    for (const cred of result.credentials) {
      expect(cred.credentialTypeCode).toBe("MD_STATE_LICENSE");
      expect(cred.regulation).not.toBeNull();
      expect(cred.regulation?.code).toBe("State medical practice act");
    }
  });

  // Audit #21 IM-8 (PR-C6): DEA + CMS credential rows should carry the
  // appropriate federal citation so the Concierge can anchor its
  // explanation on the right regulation, not just the credential type
  // code.
  it("list_credentials surfaces 21 CFR §1301.13 for DEA + 42 CFR §424.515 for Medicare PECOS", async () => {
    const { practice } = await seedPractice();
    const dea = await db.credentialType.findUniqueOrThrow({
      where: { code: "DEA_CONTROLLED_SUBSTANCE_REGISTRATION" },
    });
    const pecos = await db.credentialType.findUniqueOrThrow({
      where: { code: "MEDICARE_PECOS_ENROLLMENT" },
    });
    const insurance = await db.credentialType.findUniqueOrThrow({
      where: { code: "PROFESSIONAL_LIABILITY_INSURANCE" },
    });
    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: dea.id,
        title: "DEA registration",
        expiryDate: new Date(now.getTime() + 200 * DAY_MS),
      },
    });
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: pecos.id,
        title: "PECOS enrollment",
        expiryDate: new Date(now.getTime() + 200 * DAY_MS),
      },
    });
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: insurance.id,
        title: "Liability policy",
        expiryDate: new Date(now.getTime() + 200 * DAY_MS),
      },
    });

    const { output, error } = await invokeTool({
      toolName: "list_credentials",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      credentials: Array<{
        title: string;
        credentialTypeCode: string;
        regulation: { code: string; display: string } | null;
      }>;
    };
    const byTitle = new Map(result.credentials.map((c) => [c.title, c]));
    expect(byTitle.get("DEA registration")?.regulation?.code).toBe(
      "21 CFR §1301.13",
    );
    expect(byTitle.get("DEA registration")?.regulation?.display).toBe(
      "DEA 21 CFR §1301.13",
    );
    expect(byTitle.get("PECOS enrollment")?.regulation?.code).toBe(
      "42 CFR §424.515",
    );
    expect(byTitle.get("PECOS enrollment")?.regulation?.display).toBe(
      "CMS 42 CFR §424.515",
    );
    // Insurance has no specific federal citation — `regulation` should
    // be explicit-null so the Concierge prompt doesn't hallucinate one.
    expect(byTitle.get("Liability policy")?.regulation).toBeNull();
  });

  it("getAnthropicToolDefinitions returns one entry per registered tool", async () => {
    const { getAnthropicToolDefinitions } = await import("@/lib/ai/conciergeTools");
    const defs = getAnthropicToolDefinitions();
    expect(defs.length).toBe(11);
    expect(defs.map((d) => d.name).sort()).toEqual([
      "get_allergy_drill_status",
      "get_compliance_track",
      "get_dashboard_snapshot",
      "get_fridge_readings",
      "list_allergy_compounders",
      "list_credentials",
      "list_frameworks",
      "list_incidents",
      "list_policies",
      "list_requirements_by_framework",
      "list_vendors",
    ]);
  });

  it("list_credentials includes the credential id (audit #21 IM-9)", async () => {
    const { practice } = await seedPractice();
    const credType = await db.credentialType.findUniqueOrThrow({
      where: { code: "MD_STATE_LICENSE" },
    });
    const created = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "License with id",
        expiryDate: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
      },
    });
    const { output, error } = await invokeTool({
      toolName: "list_credentials",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as { credentials: Array<{ id: string; title: string }> };
    const found = result.credentials.find((c) => c.title === "License with id");
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  // ── list_allergy_compounders ────────────────────────────────────────────────
  it("list_allergy_compounders returns compounders with current-year qualification status", async () => {
    const { practice } = await seedPractice();
    const year = new Date().getFullYear();
    // Three users — each gets requiresAllergyCompetency=true.
    async function makeCompounder(label: string) {
      const u = await db.user.create({
        data: {
          firebaseUid: `compounder-${label}-${Math.random().toString(36).slice(2, 8)}`,
          email: `compounder-${label}-${Math.random().toString(36).slice(2, 8)}@test.test`,
          firstName: label,
          lastName: "Tester",
        },
      });
      return db.practiceUser.create({
        data: {
          userId: u.id,
          practiceId: practice.id,
          role: "STAFF",
          requiresAllergyCompetency: true,
        },
      });
    }
    const fully = await makeCompounder("Fully");
    const inProgress = await makeCompounder("InProgress");
    const newComp = await makeCompounder("New");

    // Fully qualified — quiz + 3 fingertips + media fill + flag
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: fully.id,
        year,
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(),
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    // In progress — quiz only
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: inProgress.id,
        year,
        quizPassedAt: new Date(),
        fingertipPassCount: 0,
        mediaFillPassedAt: null,
        isFullyQualified: false,
      },
    });
    // New — no AllergyCompetency row at all → not-yet-this-year

    const { output, error } = await invokeTool({
      toolName: "list_allergy_compounders",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      compounders: Array<{
        practiceUserId: string;
        name: string;
        qualificationStatus: string;
        currentYearProgress: string;
      }>;
    };
    expect(result.compounders).toHaveLength(3);
    const byUser = new Map(result.compounders.map((c) => [c.practiceUserId, c]));
    expect(byUser.get(fully.id)?.qualificationStatus).toBe("FULLY_QUALIFIED");
    expect(byUser.get(inProgress.id)?.qualificationStatus).toBe("IN_PROGRESS");
    expect(byUser.get(newComp.id)?.qualificationStatus).toBe("not-yet-this-year");
    expect(byUser.get(fully.id)?.name).toBe("Fully Tester");
  });

  it("list_allergy_compounders returns empty array when practice has no compounders", async () => {
    const { practice } = await seedPractice();
    const { output, error } = await invokeTool({
      toolName: "list_allergy_compounders",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as { compounders: unknown[] };
    expect(result.compounders).toEqual([]);
  });

  // ── get_allergy_drill_status ────────────────────────────────────────────────
  it("get_allergy_drill_status returns nulls when no drills exist", async () => {
    const { practice } = await seedPractice();
    const { output, error } = await invokeTool({
      toolName: "get_allergy_drill_status",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      lastDrillDate: string | null;
      daysSinceLastDrill: number | null;
      nextDrillDue: string | null;
      participantCount: number;
      scenarioSummary: string | null;
    };
    expect(result.lastDrillDate).toBeNull();
    expect(result.daysSinceLastDrill).toBeNull();
    expect(result.nextDrillDue).toBeNull();
    expect(result.participantCount).toBe(0);
    expect(result.scenarioSummary).toBeNull();
  });

  it("get_allergy_drill_status returns daysSinceLastDrill + nextDrillDue when a prior drill exists", async () => {
    const { user, practice } = await seedPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id, practiceId: practice.id },
    });
    const DAY_MS = 24 * 60 * 60 * 1000;
    const conductedAt = new Date(Date.now() - 10 * DAY_MS); // 10 days ago
    const nextDrillDue = new Date(Date.now() + 355 * DAY_MS);
    await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: ownerPu.id,
        conductedAt,
        scenario: "Patient develops anaphylaxis 5 minutes after injection",
        participantIds: [ownerPu.id, "other-pu-id"],
        nextDrillDue,
      },
    });
    const { output, error } = await invokeTool({
      toolName: "get_allergy_drill_status",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      lastDrillDate: string | null;
      daysSinceLastDrill: number | null;
      nextDrillDue: string | null;
      overdueByDays: number | null;
      participantCount: number;
      scenarioSummary: string | null;
    };
    expect(result.lastDrillDate).not.toBeNull();
    // 10 days ago — Math.floor of 10 days expressed in ms / DAY_MS = 10.
    expect(result.daysSinceLastDrill).toBe(10);
    expect(result.nextDrillDue).not.toBeNull();
    expect(result.overdueByDays).toBe(0);
    expect(result.participantCount).toBe(2);
    expect(result.scenarioSummary).toContain("anaphylaxis");
  });

  // ── get_fridge_readings ─────────────────────────────────────────────────────
  it("get_fridge_readings respects the limit parameter", async () => {
    const { user, practice } = await seedPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id, practiceId: practice.id },
    });
    // Seed 15 fridge readings.
    const HOUR_MS = 60 * 60 * 1000;
    for (let i = 0; i < 15; i++) {
      await db.allergyEquipmentCheck.create({
        data: {
          practiceId: practice.id,
          checkedById: ownerPu.id,
          checkType: "REFRIGERATOR_TEMP",
          checkedAt: new Date(Date.now() - i * HOUR_MS),
          temperatureC: 5.0,
          inRange: true,
        },
      });
    }
    const { output, error } = await invokeTool({
      toolName: "get_fridge_readings",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: { limit: 5 },
    });
    expect(error).toBeNull();
    const result = output as { readings: unknown[] };
    expect(result.readings).toHaveLength(5);
  });

  it("get_fridge_readings sorts newest first", async () => {
    const { user, practice } = await seedPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id, practiceId: practice.id },
    });
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Insert in non-chronological order so we know the sort isn't an
    // accidental insertion-order pass.
    const middle = new Date(Date.now() - 2 * DAY_MS);
    const oldest = new Date(Date.now() - 5 * DAY_MS);
    const newest = new Date(Date.now() - 1 * DAY_MS);
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: middle,
        temperatureC: 4.0,
        inRange: true,
        notes: "middle reading",
      },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: oldest,
        temperatureC: 3.5,
        inRange: true,
        notes: "oldest reading",
      },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: newest,
        temperatureC: 6.0,
        inRange: true,
        notes: "newest reading",
      },
    });
    const { output, error } = await invokeTool({
      toolName: "get_fridge_readings",
      practiceId: practice.id,
      practiceTimezone: "UTC",
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      readings: Array<{ notes: string | null }>;
    };
    expect(result.readings.map((r) => r.notes)).toEqual([
      "newest reading",
      "middle reading",
      "oldest reading",
    ]);
  });
});
