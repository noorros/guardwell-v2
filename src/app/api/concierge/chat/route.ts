// src/app/api/concierge/chat/route.ts
//
// SSE endpoint for the AI Concierge. POST with { threadId?, message }
// returns text/event-stream. Each chunk is one ConciergeStreamEvent (or a
// `thread_resolved` initial bookkeeping event) JSON-serialized as an SSE
// `data:` line; the final marker is `[DONE]`.
//
// Auth: must be a logged-in PracticeUser (via getPracticeUser cookie).
// Threads are scoped by practiceId + userId — cross-practice or
// cross-user access is rejected with 404 (we don't leak existence).
//
// Why not use the existing single-turn route pattern: streaming requires a
// ReadableStream + text/event-stream framing, and the streamConciergeTurn
// helper itself is an async generator the route wires into a controller.
// The helper persists the user message + final assistant message + every
// tool invocation as event-sourced rows; this route just creates the
// thread (if needed), persists the user message, and pipes the generator.

import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadCreated,
  projectConciergeMessageUserSent,
} from "@/lib/events/projections/conciergeThread";
import { streamConciergeTurn } from "@/lib/ai/streamConciergeTurn";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    message: z.string().min(1).max(10_000),
  })
  .strict();

export async function POST(request: NextRequest) {
  const pu = await getPracticeUser();
  if (!pu) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve or create thread. Brand-new threads get a server-derived title
  // = first 80 chars of the user's first message (matches the projection's
  // optional `title` payload field).
  let threadId = parsed.data.threadId;
  if (!threadId) {
    threadId = randomUUID();
    const title = parsed.data.message.slice(0, 80);
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: pu.dbUser.id,
        type: "CONCIERGE_THREAD_CREATED",
        payload: { threadId, userId: pu.dbUser.id, title },
      },
      async (tx) =>
        projectConciergeThreadCreated(tx, {
          practiceId: pu.practiceId,
          payload: { threadId: threadId!, userId: pu.dbUser.id, title },
        }),
    );
  } else {
    // Verify thread belongs to this practice + user. 404 instead of 403
    // so we don't leak existence of someone else's thread id.
    const t = await db.conversationThread.findUnique({
      where: { id: threadId },
      select: { practiceId: true, userId: true },
    });
    if (!t || t.practiceId !== pu.practiceId || t.userId !== pu.dbUser.id) {
      return new Response("Thread not found", { status: 404 });
    }
  }

  // Persist user message before streaming so it's in history when
  // streamConciergeTurn loads ConversationMessage rows.
  const userMessageId = randomUUID();
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "CONCIERGE_MESSAGE_USER_SENT",
      payload: {
        messageId: userMessageId,
        threadId,
        content: parsed.data.message,
      },
    },
    async (tx) =>
      projectConciergeMessageUserSent(tx, {
        practiceId: pu.practiceId,
        payload: {
          messageId: userMessageId,
          threadId: threadId!,
          content: parsed.data.message,
        },
      }),
  );

  // Practice.providerCount is a String enum (SOLO/SMALL_2_5/...) on the
  // schema and never null in the DB, but the streamConciergeTurn type
  // accepts string | null defensively. Pass through verbatim.
  const practice = {
    name: pu.practice.name,
    primaryState: pu.practice.primaryState,
    providerCount: pu.practice.providerCount ?? null,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Initial event: tell client which thread to anchor on (esp. for
      // brand-new threads — the client doesn't know the id yet).
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "thread_resolved", threadId })}\n\n`,
        ),
      );

      try {
        for await (const event of streamConciergeTurn({
          practiceId: pu.practiceId,
          practice,
          threadId: threadId!,
          actorUserId: pu.dbUser.id,
        })) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              code: "STREAM_ERROR",
              message: err instanceof Error ? err.message : "Stream failed",
            })}\n\n`,
          ),
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
