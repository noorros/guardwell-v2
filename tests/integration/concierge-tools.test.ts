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
      input: {},
    });
    expect(error).toBeNull();
    const result = output as {
      overallScore: number;
      frameworkCount: number;
      openIncidentCount: number;
    };
    expect(result.overallScore).toBe(80);
    expect(result.frameworkCount).toBe(1);
    expect(result.openIncidentCount).toBe(1);
  });

  it("unknown tool name returns error", async () => {
    const { practice } = await seedPractice();
    const { output, error } = await invokeTool({
      toolName: "nonexistent_tool",
      practiceId: practice.id,
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
      input: { frameworkCode: 12345 }, // wrong type
    });
    expect(error).toContain("INPUT_SCHEMA");
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
