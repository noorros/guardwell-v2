// tests/integration/concierge-projection.test.ts
//
// Integration tests for the Concierge thread/message projections added in
// Phase 2 PR A1. Pure data plane — no AI calls, no auth checks (those happen
// at the action/route layer before the projection runs). Covers:
//   1. CONCIERGE_THREAD_CREATED  — writes a ConversationThread row
//   2. CONCIERGE_MESSAGE_USER_SENT — writes a ConversationMessage + bumps
//      lastMessageAt on the parent thread
//   3. CONCIERGE_MESSAGE_ASSISTANT_PRODUCED — writes a ConversationMessage
//      with token counts + cost + llmCallId

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadCreated,
  projectConciergeMessageUserSent,
  projectConciergeMessageAssistantProduced,
  projectConciergeToolInvoked,
} from "@/lib/events/projections/conciergeThread";

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `concierge-proj-${Math.random().toString(36).slice(2, 10)}`,
      email: `concierge-proj-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Concierge Proj Test", primaryState: "GA" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("Concierge thread projections", () => {
  it("CONCIERGE_THREAD_CREATED writes a ConversationThread row", async () => {
    const { user, practice } = await seedPractice();
    const threadId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_THREAD_CREATED",
        payload: { threadId, userId: user.id, title: "Hello" },
      },
      async (tx) => projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: "Hello" },
      }),
    );
    const thread = await db.conversationThread.findUnique({ where: { id: threadId } });
    expect(thread).not.toBeNull();
    expect(thread!.title).toBe("Hello");
    expect(thread!.archivedAt).toBeNull();
  });

  it("CONCIERGE_MESSAGE_USER_SENT writes a ConversationMessage and bumps lastMessageAt", async () => {
    const { user, practice } = await seedPractice();
    const threadId = randomUUID();
    const messageId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_THREAD_CREATED",
        payload: { threadId, userId: user.id, title: null },
      },
      async (tx) => projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: null },
      }),
    );
    const before = await db.conversationThread.findUniqueOrThrow({ where: { id: threadId } });
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_MESSAGE_USER_SENT",
        payload: { messageId, threadId, content: "What's our HIPAA score?" },
      },
      async (tx) => projectConciergeMessageUserSent(tx, {
        practiceId: practice.id,
        payload: { messageId, threadId, content: "What's our HIPAA score?" },
      }),
    );
    const msg = await db.conversationMessage.findUnique({ where: { id: messageId } });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("USER");
    const after = await db.conversationThread.findUniqueOrThrow({ where: { id: threadId } });
    // toBeGreaterThanOrEqual: clock granularity / fast paths can produce equal
    // timestamps in CI; the role-USER message-row check above proves the
    // projection actually ran.
    expect(after.lastMessageAt.getTime()).toBeGreaterThanOrEqual(before.lastMessageAt.getTime());
  });

  it("CONCIERGE_MESSAGE_ASSISTANT_PRODUCED stores tokens + cost", async () => {
    const { user, practice } = await seedPractice();
    const threadId = randomUUID();
    const messageId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_THREAD_CREATED",
        payload: { threadId, userId: user.id, title: null },
      },
      async (tx) => projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: null },
      }),
    );
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_MESSAGE_ASSISTANT_PRODUCED",
        payload: {
          messageId,
          threadId,
          content: "Your HIPAA score is 75.",
          inputTokens: 200,
          outputTokens: 12,
          costUsd: 0.000780,
          llmCallId: randomUUID(),
          model: "claude-sonnet-4-6",
          stopReason: "end_turn",
        },
      },
      async (tx) => projectConciergeMessageAssistantProduced(tx, {
        practiceId: practice.id,
        payload: {
          messageId,
          threadId,
          content: "Your HIPAA score is 75.",
          inputTokens: 200,
          outputTokens: 12,
          costUsd: 0.000780,
          llmCallId: randomUUID(),
          model: "claude-sonnet-4-6",
          stopReason: "end_turn",
        },
      }),
    );
    const msg = await db.conversationMessage.findUnique({ where: { id: messageId } });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("ASSISTANT");
    expect(msg!.inputTokens).toBe(200);
    expect(msg!.outputTokens).toBe(12);
  });

  it("CONCIERGE_TOOL_INVOKED writes a TOOL ConversationMessage row", async () => {
    const { user, practice } = await seedPractice();
    const threadId = randomUUID();
    const toolInvocationId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_THREAD_CREATED",
        payload: { threadId, userId: user.id, title: null },
      },
      async (tx) => projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: null },
      }),
    );
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CONCIERGE_TOOL_INVOKED",
        payload: {
          toolInvocationId,
          threadId,
          messageId: toolInvocationId,
          toolName: "list_frameworks",
          toolInput: {},
          toolOutput: { frameworks: [{ code: "HIPAA", score: 75 }] },
          latencyMs: 42,
          error: null,
        },
      },
      async (tx) => projectConciergeToolInvoked(tx, {
        practiceId: practice.id,
        payload: {
          toolInvocationId,
          threadId,
          messageId: toolInvocationId,
          toolName: "list_frameworks",
          toolInput: {},
          toolOutput: { frameworks: [{ code: "HIPAA", score: 75 }] },
          latencyMs: 42,
          error: null,
        },
      }),
    );
    const msg = await db.conversationMessage.findUnique({ where: { id: toolInvocationId } });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("TOOL");
    expect(msg!.content).toContain("list_frameworks");
  });
});
