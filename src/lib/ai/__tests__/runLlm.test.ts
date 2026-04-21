// src/lib/ai/__tests__/runLlm.test.ts
//
// Integration-level: real Prisma (so we assert LlmCall rows land in the DB),
// mocked Anthropic client (so we don't burn tokens in CI).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { runLlm } from "@/lib/ai/runLlm";
import { __resetAnthropicForTests } from "@/lib/ai/client";

// Module-mock Anthropic BEFORE any import touches it.
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  // Use a regular function (not an arrow) so `new Anthropic()` has a valid
  // [[Construct]] internal method under vitest 4.x.
  const Anthropic = vi.fn(function (this: { messages: { create: typeof create } }) {
    this.messages = { create };
  });
  return { default: Anthropic, Anthropic };
});

// Re-acquire the mocked `create` after vi.mock has set up the module.
async function getMockedCreate() {
  const mod = await import("@anthropic-ai/sdk");
  // The Anthropic default export is a constructor mock; the instance's
  // messages.create is the fn we want to program per test.
  const AnthropicCtor = (mod as unknown as { default: ReturnType<typeof vi.fn> })
    .default;
  // Construct a fresh instance to harvest the bound `create` mock.
  const instance = new (AnthropicCtor as unknown as new () => {
    messages: { create: ReturnType<typeof vi.fn> };
  })();
  return instance.messages.create;
}

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  return { user, practice };
}

const VALID_INPUT = {
  practiceName: "Test Clinic",
  primaryState: "AZ",
  requirementCodes: ["HIPAA_PRIVACY_OFFICER"],
};

const VALID_TOOL_OUTPUT = {
  suggestions: [
    {
      requirementCode: "HIPAA_PRIVACY_OFFICER",
      likelyStatus: "NOT_STARTED" as const,
      reason: "Small practice with no documented Privacy Officer designation.",
    },
  ],
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  __resetAnthropicForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runLlm", () => {
  it("calls the mocked Anthropic API with tool-choice forcing structured output", async () => {
    const { practice, user } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_123",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 900, output_tokens: 120 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const result = await runLlm("hipaa.assess.v1", VALID_INPUT, {
      practiceId: practice.id,
      actorUserId: user.id,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]![0];
    expect(call.tool_choice).toEqual({ type: "tool", name: "hipaa_assess_v1" });
    expect(Array.isArray(call.tools)).toBe(true);
    expect(call.tools[0].name).toBe("hipaa_assess_v1");

    expect(result.output).toEqual(VALID_TOOL_OUTPUT);
    expect(typeof result.llmCallId).toBe("string");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("writes an LlmCall row with success=true on a good call", async () => {
    const { practice, user } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_ok",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 1200, output_tokens: 200 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await runLlm("hipaa.assess.v1", VALID_INPUT, {
      practiceId: practice.id,
      actorUserId: user.id,
    });

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(true);
    expect(rows[0]?.promptId).toBe("hipaa.assess.v1");
    expect(rows[0]?.promptVersion).toBe(1);
    expect(rows[0]?.model).toBe("claude-opus-4-7");
    expect(rows[0]?.inputTokens).toBe(1200);
    expect(rows[0]?.outputTokens).toBe(200);
    expect(rows[0]?.containsPHI).toBe(false);
  });

  it("rejects malformed input before calling Anthropic and writes NO LlmCall row", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();

    await expect(
      runLlm(
        "hipaa.assess.v1",
        // Intentionally invalid: primaryState is 7 chars, schema requires 2.
        // (No @ts-expect-error — these are just strings at the TS layer.)
        { practiceName: "X", primaryState: "Arizona", requirementCodes: ["A"] },
        { practiceId: practice.id },
      ),
    ).rejects.toThrow();

    expect(create).not.toHaveBeenCalled();
    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(0);
  });

  it("rejects LLM output that fails the output schema and writes LlmCall success=false", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_bad",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          // missing required field `reason` in the suggestion
          input: {
            suggestions: [
              { requirementCode: "HIPAA_PRIVACY_OFFICER", likelyStatus: "GAP" },
            ],
          },
        },
      ],
      usage: { input_tokens: 900, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/OUTPUT_SCHEMA/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("OUTPUT_SCHEMA");
  });

  it("writes LlmCall success=false when Anthropic throws (e.g. 500)", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockRejectedValueOnce(new Error("Upstream 500"));

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/Upstream 500/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("UPSTREAM");
  });

  it("writes LlmCall success=false when the response has no tool_use block", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_notool",
      content: [{ type: "text", text: "Nope." }],
      usage: { input_tokens: 100, output_tokens: 5 },
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/NO_TOOL_USE/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("NO_TOOL_USE");
  });

  it("hashes the input (sha256 hex) and stores it on LlmCall.inputHash", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_h",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id });

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
