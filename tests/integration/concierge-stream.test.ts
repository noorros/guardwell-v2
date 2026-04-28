// tests/integration/concierge-stream.test.ts
//
// Integration tests for streamConciergeTurn() (Phase 2 PR A3). Each test
// injects a fake Anthropic-shaped stub via __setAnthropicForTests so the
// runtime never reaches the real API; rate-limit + cost-guard behavior is
// exercised independently via __setConciergeLimiterForTests.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadCreated,
  projectConciergeMessageUserSent,
} from "@/lib/events/projections/conciergeThread";
import {
  streamConciergeTurn,
  type ConciergeStreamEvent,
} from "@/lib/ai/streamConciergeTurn";
import {
  __setAnthropicForTests,
  __resetAnthropicForTests,
} from "@/lib/ai/client";
import { __setConciergeLimiterForTests } from "@/lib/ai/rateLimit";

// Stub limiter that always allows. Lives at module scope so the test for
// rate-limit failure can swap a denying limiter back in without leaking.
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
      firebaseUid: `concierge-stream-${Math.random().toString(36).slice(2, 10)}`,
      email: `concierge-stream-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Concierge Stream Test", primaryState: "TX" },
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

// Build a fake Anthropic-shaped object that yields scripted stream events.
// SDK 0.78 returns from `messages.stream()` an async-iterable that emits
// message_start, content_block_delta, message_delta, ... plus a
// finalMessage() method. We only emit the events streamConciergeTurn
// actually inspects (message_start for token + model, content_block_delta
// for text deltas, message_delta for stop_reason + output_tokens).
function makeFakeAnthropic(opts: {
  textChunks: string[];
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}) {
  const inputTokens = opts.inputTokens ?? 100;
  const outputTokens = opts.outputTokens ?? 50;
  const model = opts.model ?? "claude-sonnet-4-6";
  const text = opts.textChunks.join("");
  const toolCalls = opts.toolCalls ?? [];

  return {
    messages: {
      stream() {
        const stream: AsyncIterable<unknown> & {
          finalMessage: () => Promise<unknown>;
        } = {
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
              delta: {
                stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
              },
              usage: { output_tokens: outputTokens },
            };
          },
          async finalMessage() {
            const blocks: unknown[] = [];
            if (text.length > 0) blocks.push({ type: "text", text });
            for (const tc of toolCalls) {
              blocks.push({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input: tc.input,
              });
            }
            return {
              content: blocks,
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
              model,
              stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
            };
          },
        };
        return stream;
      },
    },
  };
}

async function collect<T>(
  gen: AsyncGenerator<T, void, unknown>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("streamConciergeTurn", () => {
  it("text-only turn: streams text deltas, persists assistant message, ends with turn_complete", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "What does HIPAA §164.402 require?",
    );
    __setAnthropicForTests(
      makeFakeAnthropic({
        textChunks: ["HIPAA ", "§164.402 defines a breach as..."],
      }) as never,
    );

    const events = (await collect(
      streamConciergeTurn({
        practiceId: practice.id,
        practice: {
          name: practice.name,
          primaryState: practice.primaryState,
          providerCount: null,
        },
        threadId,
        actorUserId: user.id,
      }),
    )) as ConciergeStreamEvent[];

    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents.length).toBe(2);
    expect((textEvents[0] as { text: string }).text).toBe("HIPAA ");

    const completes = events.filter((e) => e.type === "turn_complete");
    expect(completes.length).toBe(1);

    const errs = events.filter((e) => e.type === "error");
    expect(errs).toEqual([]);

    // Confirm an ASSISTANT message landed.
    const assistantMsgs = await db.conversationMessage.findMany({
      where: { threadId, role: "ASSISTANT" },
    });
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0]!.content).toBe(
      "HIPAA §164.402 defines a breach as...",
    );
  });

  it("rate-limit failure yields an error event and never calls Anthropic", async () => {
    const { user, practice, threadId } =
      await seedThreadWithUserMessage("ping");
    __setConciergeLimiterForTests({
      async limit() {
        return { success: false, reset: Date.now() + 60_000 };
      },
    });
    __setAnthropicForTests(
      makeFakeAnthropic({ textChunks: ["should-never-stream"] }) as never,
    );
    // Clear UPSTASH_DISABLE so the rate-limit assertion actually fires
    // (tests/setup.ts pins it to "1" by default).
    const previous = process.env.UPSTASH_DISABLE;
    delete process.env.UPSTASH_DISABLE;
    try {
      const events = (await collect(
        streamConciergeTurn({
          practiceId: practice.id,
          practice: {
            name: practice.name,
            primaryState: practice.primaryState,
            providerCount: null,
          },
          threadId,
          actorUserId: user.id,
        }),
      )) as ConciergeStreamEvent[];
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe("error");
      expect((events[0] as { code: string }).code).toBe("RATE_LIMITED");
      // No assistant message persisted.
      const assistantMsgs = await db.conversationMessage.findMany({
        where: { threadId, role: "ASSISTANT" },
      });
      expect(assistantMsgs.length).toBe(0);
    } finally {
      if (previous !== undefined) process.env.UPSTASH_DISABLE = previous;
      else process.env.UPSTASH_DISABLE = "1";
    }
  });

  it("empty thread history yields EMPTY_HISTORY error", async () => {
    const user = await db.user.create({
      data: {
        firebaseUid: `concierge-empty-${Math.random().toString(36).slice(2, 10)}`,
        email: `concierge-empty-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "Empty thread test", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
    });
    const threadId = `empty-${Math.random().toString(36).slice(2, 10)}`;
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

    __setAnthropicForTests(
      makeFakeAnthropic({ textChunks: ["nope"] }) as never,
    );

    const events = (await collect(
      streamConciergeTurn({
        practiceId: practice.id,
        practice: {
          name: practice.name,
          primaryState: practice.primaryState,
          providerCount: null,
        },
        threadId,
        actorUserId: user.id,
      }),
    )) as ConciergeStreamEvent[];
    expect(events.length).toBe(1);
    expect((events[0] as { code: string }).code).toBe("EMPTY_HISTORY");
  });
});
