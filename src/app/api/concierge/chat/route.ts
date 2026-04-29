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
import { assertConciergeRateLimit } from "@/lib/ai/rateLimit";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cloud Run kills HTTP requests at 60s by default. Concierge tool-loop turns
// can legitimately run several minutes when chained tools fan out — match
// the 5-minute ceiling used by /api/cron/onboarding-drip.
export const maxDuration = 300;

const RequestSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    message: z.string().min(1).max(10_000),
  })
  .strict();

export async function POST(request: NextRequest) {
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

  // Resolve thread + PracticeUser together.
  //
  // Multi-practice rule: when a threadId is provided, look up the thread
  // FIRST (it's keyed by primary key) and resolve PracticeUser scoped to
  // thread.practiceId. Otherwise a user whose default practice (the one
  // getPracticeUser() returns when called with no args) differs from the
  // thread's practice gets a spurious 404 because their default-practice
  // PracticeUser doesn't match the thread's practiceId.
  //
  // For brand-new threads we still use the user's default practice — PR A4
  // (drawer UI) will introduce an explicit practiceId field on the request
  // body for the new-thread case.
  let threadId = parsed.data.threadId;
  let pu;
  if (threadId) {
    const thread = await db.conversationThread.findUnique({
      where: { id: threadId },
      select: { practiceId: true, userId: true },
    });
    if (!thread) {
      return new Response("Thread not found", { status: 404 });
    }
    pu = await getPracticeUser(thread.practiceId);
    // 404 (not 403) so we don't leak existence of someone else's thread.
    if (!pu || pu.dbUser.id !== thread.userId) {
      return new Response("Thread not found", { status: 404 });
    }
  } else {
    pu = await getPracticeUser();
    if (!pu) {
      return new Response("Unauthorized", { status: 401 });
    }
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
          practiceId: pu!.practiceId,
          payload: { threadId: threadId!, userId: pu!.dbUser.id, title },
        }),
    );
  }

  // Pre-flight: cost guard + per-user rate limit. MUST run BEFORE persisting
  // the user message so a denied request doesn't leave an orphan user
  // message dangling in the thread without an assistant reply.
  try {
    await assertMonthlyCostBudget();
    await assertConciergeRateLimit(pu.dbUser.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pre-flight failed";
    const code = message.startsWith("RATE_LIMITED")
      ? "RATE_LIMITED"
      : message.startsWith("COST_BUDGET_EXCEEDED")
        ? "COST_BUDGET_EXCEEDED"
        : "PREFLIGHT_FAILURE";
    return new Response(JSON.stringify({ error: code, message }), {
      status: code === "RATE_LIMITED" ? 429 : 500,
      headers: { "Content-Type": "application/json" },
    });
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
        practiceId: pu!.practiceId,
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
          practiceId: pu!.practiceId,
          practice,
          threadId: threadId!,
          actorUserId: pu!.dbUser.id,
          // request.signal aborts when the consumer (browser tab, fetch
          // AbortController) disconnects. The generator checks this at
          // iteration boundaries + before each tool invocation, and the
          // SDK forwards it to fetch so the in-flight Anthropic stream
          // is also torn down. Stops ticking tokens on closed-tab streams.
          signal: request.signal,
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
    cancel() {
      // ReadableStream.cancel fires when the consumer closes. Next.js links
      // request.signal to this event, so the generator already sees the
      // abort and exits naturally; this handler exists mostly so future
      // best-effort logging can hook in without a structural change.
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
