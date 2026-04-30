// tests/integration/concierge-tools.test.ts
//
// Integration tests for the Concierge tool registry added in Phase 2 PR A2.
// Each test seeds a fresh practice and exercises one of the 8 read-only
// tool handlers via invokeTool() — no mocking, real Postgres queries.

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
    expect(defs.length).toBe(8);
    expect(defs.map((d) => d.name).sort()).toEqual([
      "get_compliance_track",
      "get_dashboard_snapshot",
      "list_credentials",
      "list_frameworks",
      "list_incidents",
      "list_policies",
      "list_requirements_by_framework",
      "list_vendors",
    ]);
  });
});
