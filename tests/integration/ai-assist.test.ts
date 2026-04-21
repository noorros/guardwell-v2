// tests/integration/ai-assist.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { __resetAnthropicForTests } from "@/lib/ai/client";

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

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  globalThis.__testUser = { id: user.id, email: user.email, firebaseUid: user.firebaseUid };
  return { user, practice };
}

describe("askAiAssistantAction", () => {
  it("returns ok:true with the model's answer", async () => {
    const { practice } = await seed();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "assistant_page_help_v1",
          input: {
            answer: "Typically the owner or clinic manager signs the designation.",
          },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
    });

    const { askAiAssistantAction } = await import(
      "@/components/gw/AiAssistDrawer/actions"
    );
    const res = await askAiAssistantAction({
      route: "/modules/hipaa",
      summary: "HIPAA module",
      question: "Who signs the Privacy Officer designation?",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.answer).toMatch(/designation/);
    }

    const calls = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.promptId).toBe("assistant.page-help.v1");
  });

  it("returns ok:false on output schema violation (answer > 800 chars)", async () => {
    await seed();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "assistant_page_help_v1",
          input: { answer: "x".repeat(2000) },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 400 },
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
    });

    const { askAiAssistantAction } = await import(
      "@/components/gw/AiAssistDrawer/actions"
    );
    const res = await askAiAssistantAction({
      route: "/modules/hipaa",
      question: "ask me anything",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/OUTPUT_SCHEMA/);
  });
});
