// src/lib/ai/__tests__/runConciergeTurn.test.ts
//
// Integration tests for the runConciergeTurn() collector. Same fake-Anthropic
// pattern as tests/integration/concierge-stream.test.ts — we never reach
// the real API. Each test exercises one shape of streamConciergeTurn output
// (text-only, tool-using, tool-handler-failure, token + cost accounting)
// and verifies the collector mirrors the events into RunConciergeTurnResult
// fields correctly.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadCreated,
  projectConciergeMessageUserSent,
} from "@/lib/events/projections/conciergeThread";
import { runConciergeTurn } from "@/lib/ai/runConciergeTurn";
import {
  __setAnthropicForTests,
  __resetAnthropicForTests,
} from "@/lib/ai/client";
import { __setConciergeLimiterForTests } from "@/lib/ai/rateLimit";

const ALLOW_ALL_LIMITER = {
  async limit() {
    return { success: true, reset: Date.now() + 1000 };
  },
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  __setConciergeLimiterForTests(ALLOW_ALL_LIMITER);
});

afterAll(() => {
  __resetAnthropicForTests();
  __setConciergeLimiterForTests(null);
});

async function seedThreadWithUserMessage(content: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `run-concierge-${Math.random().toString(36).slice(2, 10)}`,
      email: `run-concierge-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Run Concierge Test", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const threadId = `thread-${Math.random().toString(36).slice(2, 10)}`;
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "CONCIERGE_THREAD_CREATED",
      payload: { threadId, userId: user.id, title: null },
    },
    async (tx) =>
      projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: null },
      }),
  );
  const messageId = `msg-${Math.random().toString(36).slice(2, 10)}`;
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "CONCIERGE_MESSAGE_USER_SENT",
      payload: { messageId, threadId, content },
    },
    async (tx) =>
      projectConciergeMessageUserSent(tx, {
        practiceId: practice.id,
        payload: { messageId, threadId, content },
      }),
  );
  return { user, practice, threadId };
}

function makeFakeAnthropic(opts: {
  textChunks: string[];
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}) {
  const inputTokens = opts.inputTokens ?? 100;
  const outputTokens = opts.outputTokens ?? 50;
  const model = opts.model ?? "claude-sonnet-4-6";
  const text = opts.textChunks.join("");
  return {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "message_start",
              message: { usage: { input_tokens: inputTokens }, model },
            };
            for (const chunk of opts.textChunks) {
              yield {
                type: "content_block_delta",
                delta: { type: "text_delta", text: chunk },
              };
            }
            yield {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: outputTokens },
            };
          },
          async finalMessage() {
            return {
              content: text.length > 0 ? [{ type: "text", text }] : [],
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
              model,
              stop_reason: "end_turn",
            };
          },
        };
      },
    },
  };
}

describe("runConciergeTurn", () => {
  it("text-only turn: returns concatenated text, empty toolCalls, no errors", async () => {
    const { user, practice, threadId } =
      await seedThreadWithUserMessage("hello");
    __setAnthropicForTests(
      makeFakeAnthropic({
        textChunks: ["Hello, ", "compliance officer."],
      }) as never,
    );

    const result = await runConciergeTurn({
      practiceId: practice.id,
      practice: {
        name: practice.name,
        primaryState: practice.primaryState,
        providerCount: null,
      },
      threadId,
      actorUserId: user.id,
    });

    expect(result.text).toBe("Hello, compliance officer.");
    expect(result.toolCalls).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("tool-using turn: records toolCall with toolName + toolUseId + null error", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "What's our HIPAA score?",
    );

    // No PracticeFramework rows seeded — list_frameworks returns
    // {frameworks: [], _truncated: false} which is a non-error response,
    // exactly what we need to verify the success-path tool-call mirror.

    let callCount = 0;
    __setAnthropicForTests({
      messages: {
        stream() {
          callCount += 1;
          const isFirstTurn = callCount === 1;
          const toolUseId = "toolu_run_001";
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: "message_start",
                message: {
                  usage: { input_tokens: 100 },
                  model: "claude-sonnet-4-6",
                },
              };
              if (!isFirstTurn) {
                yield {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "Your HIPAA score is 75." },
                };
              }
              yield {
                type: "message_delta",
                delta: { stop_reason: isFirstTurn ? "tool_use" : "end_turn" },
                usage: { output_tokens: 30 },
              };
            },
            async finalMessage() {
              if (isFirstTurn) {
                return {
                  content: [
                    {
                      type: "tool_use",
                      id: toolUseId,
                      name: "list_frameworks",
                      input: {},
                    },
                  ],
                  usage: { input_tokens: 100, output_tokens: 30 },
                  model: "claude-sonnet-4-6",
                  stop_reason: "tool_use",
                };
              }
              return {
                content: [{ type: "text", text: "Your HIPAA score is 75." }],
                usage: { input_tokens: 100, output_tokens: 30 },
                model: "claude-sonnet-4-6",
                stop_reason: "end_turn",
              };
            },
          };
        },
      },
    } as never);

    const result = await runConciergeTurn({
      practiceId: practice.id,
      practice: {
        name: practice.name,
        primaryState: practice.primaryState,
        providerCount: null,
      },
      threadId,
      actorUserId: user.id,
    });

    expect(result.text).toBe("Your HIPAA score is 75.");
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]!.toolName).toBe("list_frameworks");
    expect(result.toolCalls[0]!.toolUseId).toBe("toolu_run_001");
    expect(result.toolCalls[0]!.error).toBeNull();
    expect(result.toolCalls[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.errors).toEqual([]);
  });

  it("tool-handler error: result.toolCalls[0].error is populated", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "list frameworks",
    );

    // No PracticeFramework rows seeded, but the model emits a tool_use for
    // a NON-EXISTENT tool — the registry returns "Unknown tool: <name>"
    // as the error string and does NOT throw, exercising the error-pathway.
    let callCount = 0;
    __setAnthropicForTests({
      messages: {
        stream() {
          callCount += 1;
          const isFirstTurn = callCount === 1;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: "message_start",
                message: {
                  usage: { input_tokens: 50 },
                  model: "claude-sonnet-4-6",
                },
              };
              if (!isFirstTurn) {
                yield {
                  type: "content_block_delta",
                  delta: {
                    type: "text_delta",
                    text: "Tool failed; sorry.",
                  },
                };
              }
              yield {
                type: "message_delta",
                delta: { stop_reason: isFirstTurn ? "tool_use" : "end_turn" },
                usage: { output_tokens: 10 },
              };
            },
            async finalMessage() {
              if (isFirstTurn) {
                return {
                  content: [
                    {
                      type: "tool_use",
                      id: "toolu_err_1",
                      name: "totally_made_up_tool",
                      input: {},
                    },
                  ],
                  usage: { input_tokens: 50, output_tokens: 10 },
                  model: "claude-sonnet-4-6",
                  stop_reason: "tool_use",
                };
              }
              return {
                content: [{ type: "text", text: "Tool failed; sorry." }],
                usage: { input_tokens: 50, output_tokens: 10 },
                model: "claude-sonnet-4-6",
                stop_reason: "end_turn",
              };
            },
          };
        },
      },
    } as never);

    const result = await runConciergeTurn({
      practiceId: practice.id,
      practice: {
        name: practice.name,
        primaryState: practice.primaryState,
        providerCount: null,
      },
      threadId,
      actorUserId: user.id,
    });

    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]!.toolName).toBe("totally_made_up_tool");
    expect(result.toolCalls[0]!.error).toMatch(/Unknown tool/);
  });

  it("token + cost accounting: tokens populated, costUsd > 0", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "say hi",
    );
    __setAnthropicForTests(
      makeFakeAnthropic({
        textChunks: ["hi"],
        inputTokens: 200,
        outputTokens: 25,
      }) as never,
    );

    const result = await runConciergeTurn({
      practiceId: practice.id,
      practice: {
        name: practice.name,
        primaryState: practice.primaryState,
        providerCount: null,
      },
      threadId,
      actorUserId: user.id,
    });

    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(25);
    expect(result.costUsd).not.toBeNull();
    expect(result.costUsd!).toBeGreaterThan(0);
  });
});
