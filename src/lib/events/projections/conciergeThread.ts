// src/lib/events/projections/conciergeThread.ts
//
// Projects the four CONCIERGE_* event types to ConversationThread +
// ConversationMessage rows. Pure data plane — no AI calls, no auth checks
// (those happen at the action/route layer before this projection runs).
// All projections are idempotent via .upsert (matches the pattern from
// projectMacraActivityLogged + projectPolicyAdopted): re-projecting the
// same event (event-bus retry, manual rerun, projection backfill) is a
// no-op on update instead of throwing P2002.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type ThreadCreatedPayload = PayloadFor<"CONCIERGE_THREAD_CREATED", 1>;
type UserMessagePayload = PayloadFor<"CONCIERGE_MESSAGE_USER_SENT", 1>;
type AssistantMessagePayload = PayloadFor<
  "CONCIERGE_MESSAGE_ASSISTANT_PRODUCED",
  1
>;
type ToolInvokedPayload = PayloadFor<"CONCIERGE_TOOL_INVOKED", 1>;

export async function projectConciergeThreadCreated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ThreadCreatedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.conversationThread.upsert({
    where: { id: payload.threadId },
    update: {},
    create: {
      id: payload.threadId,
      practiceId,
      userId: payload.userId,
      title: payload.title ?? null,
    },
  });
}

export async function projectConciergeMessageUserSent(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UserMessagePayload },
): Promise<void> {
  const { payload } = args;
  await tx.conversationMessage.upsert({
    where: { id: payload.messageId },
    update: {},
    create: {
      id: payload.messageId,
      threadId: payload.threadId,
      role: "USER",
      content: payload.content,
      // USER rows duplicate content into payload for forward-compat with
      // future client metadata fields — attachments, tone preferences, etc.
      // Keeping `payload Json` non-nullable matches ASSISTANT/TOOL rows.
      payload: { content: payload.content } as Prisma.InputJsonValue,
    },
  });
  await tx.conversationThread.update({
    where: { id: payload.threadId },
    data: { lastMessageAt: new Date() },
  });
}

export async function projectConciergeMessageAssistantProduced(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: AssistantMessagePayload },
): Promise<void> {
  const { payload } = args;
  await tx.conversationMessage.upsert({
    where: { id: payload.messageId },
    update: {},
    create: {
      id: payload.messageId,
      threadId: payload.threadId,
      role: "ASSISTANT",
      content: payload.content,
      payload: payload as unknown as Prisma.InputJsonValue,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      costUsd: payload.costUsd ?? undefined,
      // llmCallId is nullable in the registry schema (PR A6 will wire the
      // actual LlmCall row write); column is also nullable in the DB.
      llmCallId: payload.llmCallId ?? undefined,
    },
  });
  await tx.conversationThread.update({
    where: { id: payload.threadId },
    data: { lastMessageAt: new Date() },
  });
}

export async function projectConciergeToolInvoked(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ToolInvokedPayload },
): Promise<void> {
  const { payload } = args;
  await tx.conversationMessage.upsert({
    where: { id: payload.toolInvocationId },
    update: {},
    create: {
      id: payload.toolInvocationId,
      threadId: payload.threadId,
      role: "TOOL",
      content: `Tool ${payload.toolName} invoked${payload.error ? ` — error: ${payload.error}` : ""}`,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}
