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

  it("generator no longer enforces rate limit (pre-flight moved to the route handler)", async () => {
    // POST-POLISH BEHAVIOR: the route handler at /api/concierge/chat owns
    // pre-flight (cost guard + rate limit) so a denied request never gets
    // far enough to persist a user message. The generator runs without
    // re-checking. This test pins that contract: even with a denying
    // limiter set, the generator proceeds to call Anthropic and does NOT
    // yield a RATE_LIMITED error. Route-level rate-limit denial belongs
    // in a separate route-handler test (PR A4 introduces the surface).
    const { user, practice, threadId } =
      await seedThreadWithUserMessage("ping");
    __setConciergeLimiterForTests({
      async limit() {
        return { success: false, reset: Date.now() + 60_000 };
      },
    });
    __setAnthropicForTests(
      makeFakeAnthropic({ textChunks: ["actually-streams"] }) as never,
    );
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
      // No RATE_LIMITED event — generator no longer pre-flights.
      const rateLimitErrors = events.filter(
        (e) => e.type === "error" && (e as { code: string }).code === "RATE_LIMITED",
      );
      expect(rateLimitErrors.length).toBe(0);
      // The fake Anthropic produced text + turn_complete normally.
      expect(events.some((e) => e.type === "text_delta")).toBe(true);
      expect(events.some((e) => e.type === "turn_complete")).toBe(true);
    } finally {
      if (previous !== undefined) process.env.UPSTASH_DISABLE = previous;
      else process.env.UPSTASH_DISABLE = "1";
    }
  });

  it("empty thread history yields EMPTY_HISTORY error and never calls Anthropic", async () => {
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

    let streamCallCount = 0;
    const fake = makeFakeAnthropic({ textChunks: ["nope"] });
    __setAnthropicForTests({
      messages: {
        stream(...streamArgs: unknown[]) {
          streamCallCount += 1;
          // Forward to the inner fake so the test still "works" if the
          // generator ever DOES call stream() (then assertion below fails
          // loudly with a useful count).
          return (
            fake.messages.stream as unknown as (...a: unknown[]) => unknown
          )(...streamArgs);
        },
      },
    } as never);

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
    // Generator must short-circuit before opening an Anthropic stream.
    expect(streamCallCount).toBe(0);
  });

  it("tool-use turn: invokes tool, streams tool events, persists CONCIERGE_TOOL_INVOKED", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "What's our HIPAA score?",
    );

    // Seed an enrolled framework so list_frameworks returns useful data.
    const fw = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
    });
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fw.id,
        enabled: true,
        scoreCache: 75,
      },
    });

    // Two-iteration stub: iter 1 emits a tool_use block; iter 2 emits
    // text + end_turn. The generator should invoke the tool between them,
    // append a CONCIERGE_TOOL_INVOKED event, and persist iter 2's text.
    let callCount = 0;
    __setAnthropicForTests({
      messages: {
        stream() {
          callCount += 1;
          const isFirstTurn = callCount === 1;
          const toolUseId = "toolu_test_001";
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
                  delta: {
                    type: "text_delta",
                    text: "Your HIPAA score is 75.",
                  },
                };
              }
              yield {
                type: "message_delta",
                delta: {
                  stop_reason: isFirstTurn ? "tool_use" : "end_turn",
                },
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

    const toolStarted = events.filter((e) => e.type === "tool_use_started");
    expect(toolStarted.length).toBe(1);
    expect((toolStarted[0] as { toolName: string }).toolName).toBe(
      "list_frameworks",
    );

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults.length).toBe(1);
    expect((toolResults[0] as { error: string | null }).error).toBeNull();

    const completes = events.filter((e) => e.type === "turn_complete");
    expect(completes.length).toBe(1);

    // Final assistant message holds iter 2 text — intermediate-iteration
    // text is not persisted.
    const assistantMsgs = await db.conversationMessage.findMany({
      where: { threadId, role: "ASSISTANT" },
    });
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0]!.content).toBe("Your HIPAA score is 75.");

    // CONCIERGE_TOOL_INVOKED event row landed in the EventLog.
    const toolEvents = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "CONCIERGE_TOOL_INVOKED" },
    });
    expect(toolEvents.length).toBe(1);

    // Anthropic was called exactly twice (one per iteration).
    expect(callCount).toBe(2);
  });

  it("LlmCall row written on success with cost / latency / tokens populated", async () => {
    const { user, practice, threadId } = await seedThreadWithUserMessage(
      "say hi",
    );
    __setAnthropicForTests(
      makeFakeAnthropic({
        textChunks: ["hello"],
        inputTokens: 200,
        outputTokens: 25,
      }) as never,
    );

    await collect(
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
    );

    const row = await db.llmCall.findFirst({
      where: { promptId: "concierge.chat.v1", practiceId: practice.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.success).toBe(true);
    expect(row!.errorCode).toBeNull();
    expect(row!.inputTokens).toBe(200);
    expect(row!.outputTokens).toBe(25);
    // costUsd is Prisma Decimal — coerce to number for the comparison.
    expect(row!.costUsd).not.toBeNull();
    expect(Number(row!.costUsd)).toBeGreaterThan(0);
    // latency must be a real elapsed measurement.
    expect(row!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row!.containsPHI).toBe(false);
    expect(row!.actorUserId).toBe(user.id);
  });

  it("LlmCall row written with success:false + errorCode UPSTREAM when SDK throws", async () => {
    const { user, practice, threadId } =
      await seedThreadWithUserMessage("force an error");

    // Stub a stream() that throws synchronously — this hits the
    // stream-open UPSTREAM catch in streamConciergeTurn.
    __setAnthropicForTests({
      messages: {
        stream() {
          throw new Error("simulated upstream failure");
        },
      },
    } as never);

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

    // Generator surfaces UPSTREAM as the only event.
    expect(
      events.find(
        (e) => e.type === "error" && (e as { code: string }).code === "UPSTREAM",
      ),
    ).toBeDefined();

    const row = await db.llmCall.findFirst({
      where: { promptId: "concierge.chat.v1", practiceId: practice.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.success).toBe(false);
    expect(row!.errorCode).toBe("UPSTREAM");
  });

  it("llmCallId on the assistant event payload matches the ConversationMessage row", async () => {
    const { user, practice, threadId } =
      await seedThreadWithUserMessage("trace the id");
    __setAnthropicForTests(
      makeFakeAnthropic({ textChunks: ["traced"] }) as never,
    );

    await collect(
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
    );

    const event = await db.eventLog.findFirst({
      where: {
        practiceId: practice.id,
        type: "CONCIERGE_MESSAGE_ASSISTANT_PRODUCED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    const payload = event!.payload as { llmCallId: string | null };
    expect(payload.llmCallId).not.toBeNull();
    expect(typeof payload.llmCallId).toBe("string");

    const assistantMsg = await db.conversationMessage.findFirst({
      where: { threadId, role: "ASSISTANT" },
      orderBy: { createdAt: "desc" },
    });
    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg!.llmCallId).toBe(payload.llmCallId);

    // Belt-and-suspenders: that id actually points to a real LlmCall row.
    const row = await db.llmCall.findUnique({
      where: { id: payload.llmCallId! },
    });
    expect(row).not.toBeNull();
    expect(row!.success).toBe(true);
  });

  it("per-thread token compaction drops oldest USER+ASSISTANT pairs over the budget", async () => {
    // Build the thread WITHOUT the seed helper's user message — we want
    // the new user message to land LAST in createdAt order so it mirrors
    // the production sequence (route handler appends the user message
    // BEFORE invoking the generator). Seeding it first via the helper
    // would put it at the front of the FIFO and make it the first row
    // dropped — exercising compaction but not the realistic scenario.
    const user = await db.user.create({
      data: {
        firebaseUid: `concierge-compaction-${Math.random().toString(36).slice(2, 10)}`,
        email: `concierge-compaction-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "Concierge Compaction Test", primaryState: "TX" },
    });
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
    });
    const threadId = `thread-compaction-${Math.random().toString(36).slice(2, 10)}`;
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

    // Seed 5 prior USER+ASSISTANT pairs, each ASSISTANT row carrying
    // 12_000 inputTokens. Five pairs × 12k = 60k > the 50k default
    // budget; compaction should drop the oldest pair.
    //
    // Insert directly via db.conversationMessage.create — we don't need
    // the event-log + projection plumbing for these synthetic rows,
    // they just have to surface in the history query.
    for (let i = 0; i < 5; i++) {
      await db.conversationMessage.create({
        data: {
          threadId,
          role: "USER",
          content: `older user msg ${i}`,
          payload: { content: `older user msg ${i}` },
        },
      });
      await db.conversationMessage.create({
        data: {
          threadId,
          role: "ASSISTANT",
          content: `older assistant msg ${i}`,
          payload: { content: `older assistant msg ${i}` },
          inputTokens: 12_000,
          outputTokens: 100,
        },
      });
    }

    // Now append the NEW user message via the projection, so it sits at
    // the tail of the history (createdAt-asc).
    const newMessageId = `msg-${Math.random().toString(36).slice(2, 10)}`;
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_MESSAGE_USER_SENT",
        payload: {
          messageId: newMessageId,
          threadId,
          content: "turn 6 user msg",
        },
      },
      async (tx) =>
        projectConciergeMessageUserSent(tx, {
          practiceId: practice.id,
          payload: {
            messageId: newMessageId,
            threadId,
            content: "turn 6 user msg",
          },
        }),
    );

    let receivedMessagesLength = -1;
    __setAnthropicForTests({
      messages: {
        stream(req: { messages: unknown[] }) {
          receivedMessagesLength = req.messages.length;
          // Hand back a normal end_turn stream so the rest of the
          // generator runs unimpeded.
          return (
            makeFakeAnthropic({ textChunks: ["ok"] })
              .messages.stream as unknown as (...a: unknown[]) => unknown
          )(req);
        },
      },
    } as never);

    await collect(
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
    );

    // Five pairs × 12k = 60k tokens, over the 50k default budget by 10k.
    // Dropping the oldest USER+ASSISTANT pair frees 12k (the assistant
    // row carries the inputTokens), bringing the total to 48k — under
    // budget. So exactly one pair drops: 4 historical pairs (8 msgs) +
    // 1 new user message = 9 messages reach the SDK. An exact-value
    // assertion catches stranded-USER regressions in pair-drop logic
    // (e.g. dropping a USER without its ASSISTANT, which would yield 10).
    expect(receivedMessagesLength).toBe(9);
  });

  it("per-thread token compaction respects CONCIERGE_THREAD_MAX_INPUT_TOKENS env override", async () => {
    const previousEnv = process.env.CONCIERGE_THREAD_MAX_INPUT_TOKENS;
    process.env.CONCIERGE_THREAD_MAX_INPUT_TOKENS = "5000";
    try {
      const { user, practice, threadId } =
        await seedThreadWithUserMessage("new user message after small budget");

      // Single historical pair tagged with 12_000 inputTokens — over
      // the 5_000 override, so the only pair must drop.
      await db.conversationMessage.create({
        data: {
          threadId,
          role: "USER",
          content: "older user",
          payload: { content: "older user" },
        },
      });
      await db.conversationMessage.create({
        data: {
          threadId,
          role: "ASSISTANT",
          content: "older assistant",
          payload: { content: "older assistant" },
          inputTokens: 12_000,
          outputTokens: 100,
        },
      });

      let receivedMessagesLength = -1;
      __setAnthropicForTests({
        messages: {
          stream(req: { messages: unknown[] }) {
            receivedMessagesLength = req.messages.length;
            return (
              makeFakeAnthropic({ textChunks: ["ok"] })
                .messages.stream as unknown as (...a: unknown[]) => unknown
            )(req);
          },
        },
      } as never);

      await collect(
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
      );

      // The 1 historical pair is dropped; only the new user message
      // remains. messages.length === 1.
      expect(receivedMessagesLength).toBe(1);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.CONCIERGE_THREAD_MAX_INPUT_TOKENS;
      } else {
        process.env.CONCIERGE_THREAD_MAX_INPUT_TOKENS = previousEnv;
      }
    }
  });
});
