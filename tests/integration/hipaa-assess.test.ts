// tests/integration/hipaa-assess.test.ts
//
// End-to-end: mocked Anthropic + real Prisma. Confirms that
// runAiAssessmentAction produces (1) a success LlmCall, (2) one
// REQUIREMENT_STATUS_UPDATED event per valid suggestion, (3) projected
// ComplianceItem rows, (4) filters hallucinated codes, (5) refuses to
// downgrade COMPLIANT.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { __resetAnthropicForTests } from "@/lib/ai/client";

// Next's revalidatePath requires a static-generation store that only exists
// inside a real RSC request. Stub it so server actions can call it in tests.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Module-mock Anthropic BEFORE any import touches it. Uses the pattern
// from src/lib/ai/__tests__/runLlm.test.ts — a regular function (not an
// arrow) so `new Anthropic()` has a valid [[Construct]] under vitest 4.x.
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  const Anthropic = vi.fn(function (this: { messages: { create: typeof create } }) {
    this.messages = { create };
  });
  return { default: Anthropic, Anthropic };
});

async function getMockedCreate() {
  const mod = await import("@anthropic-ai/sdk");
  const Ctor = (mod as unknown as { default: ReturnType<typeof vi.fn> }).default;
  const instance = new (Ctor as unknown as new () => {
    messages: { create: ReturnType<typeof vi.fn> };
  })();
  return instance.messages.create;
}

// We need to stub getCurrentUser / getPracticeUser because server actions
// read them. Easiest path: import the action's function directly and set
// up fixture data in DB, then mock the auth helpers.
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser: { id: string; email: string; firebaseUid: string } | null;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.__testUser = null;
  __resetAnthropicForTests();
});

async function seedHipaa() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Solo PCP", primaryState: "AZ", specialty: "Primary Care" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "Test fixture",
      jurisdiction: "federal",
    },
  });
  const a = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_PRIVACY_OFFICER" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_PRIVACY_OFFICER",
      title: "Privacy Officer",
      description: "test",
    },
  });
  const b = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_SRA" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_SRA",
      title: "SRA",
      description: "test",
    },
  });
  globalThis.__testUser = { id: user.id, email: user.email, firebaseUid: user.firebaseUid };
  return { user, practice, framework, requirements: [a, b] };
}

describe("runAiAssessmentAction (HIPAA)", () => {
  it("applies valid suggestions and writes events + projections", async () => {
    const { practice, requirements } = await seedHipaa();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_PRIVACY_OFFICER",
                likelyStatus: "NOT_STARTED",
                reason: "Solo practice; no officer documented.",
              },
              {
                requirementCode: "HIPAA_SRA",
                likelyStatus: "GAP",
                reason: "Likely partial SRA given the practice size.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 100 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();

    expect(result.applied).toBe(2);
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(2);

    const items = await db.complianceItem.findMany({
      where: { practiceId: practice.id },
    });
    expect(items.map((i) => i.status).sort()).toEqual(["GAP", "NOT_STARTED"]);
    expect(items.map((i) => i.requirementId).sort()).toEqual(
      requirements.map((r) => r.id).sort(),
    );

    const calls = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.success).toBe(true);
  });

  it("skips hallucinated requirement codes", async () => {
    const { practice } = await seedHipaa();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_NONEXISTENT",
                likelyStatus: "GAP",
                reason: "Made up by the model.",
              },
              {
                requirementCode: "HIPAA_SRA",
                likelyStatus: "GAP",
                reason: "Real code.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();
    expect(result.applied).toBe(1);

    const items = await db.complianceItem.findMany({
      where: { practiceId: practice.id },
    });
    expect(items).toHaveLength(1);
  });

  it("does NOT downgrade a human-asserted COMPLIANT requirement", async () => {
    const { practice, requirements } = await seedHipaa();

    // Pre-set HIPAA_PRIVACY_OFFICER to COMPLIANT by emitting a USER event.
    const { appendEventAndApply } = await import("@/lib/events");
    const { projectRequirementStatusUpdated } = await import(
      "@/lib/events/projections/requirementStatus"
    );
    const target = requirements.find((r) => r.code === "HIPAA_PRIVACY_OFFICER")!;
    await appendEventAndApply(
      {
        practiceId: practice.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: target.id,
          frameworkCode: "HIPAA",
          requirementCode: target.code,
          previousStatus: "NOT_STARTED",
          nextStatus: "COMPLIANT",
          source: "USER",
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: {
            requirementId: target.id,
            frameworkCode: "HIPAA",
            requirementCode: target.code,
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        }),
    );

    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_PRIVACY_OFFICER",
                likelyStatus: "NOT_STARTED", // would downgrade
                reason: "Model thinks they don't have one.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();
    expect(result.applied).toBe(0);

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: { practiceId: practice.id, requirementId: target.id },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");
  });
});
