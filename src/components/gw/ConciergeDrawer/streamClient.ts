// src/components/gw/ConciergeDrawer/streamClient.ts
//
// SSE client for /api/concierge/chat. Yields a typed event stream so the
// drawer body's render loop can be a straightforward reducer over events.
//
// Frame format: each SSE frame is one or more lines separated by \n\n.
// Lines start with "data: ". Payload is JSON (a ConciergeStreamEvent or
// a `thread_resolved` bookkeeping event). Final marker is `data: [DONE]`.
//
// The route handler enqueues a `thread_resolved` event before invoking
// the generator, then enqueues every event from streamConciergeTurn,
// then enqueues `[DONE]`. We yield each as a typed StreamClientEvent.
//
// Extracted from the drawer body so it can be unit-tested independently
// of React + jsdom; in tests, the drawer accepts a `__streamForTests`
// prop that bypasses fetch entirely.

import type { ConciergeStreamEvent } from "@/lib/ai/streamConciergeTurn";

export interface StreamClientArgs {
  message: string;
  threadId: string | null;
  signal?: AbortSignal;
}

export type StreamClientEvent =
  | ConciergeStreamEvent
  | { type: "thread_resolved"; threadId: string }
  | { type: "stream_done" };

export async function* streamConciergeChat(
  args: StreamClientArgs,
): AsyncGenerator<StreamClientEvent, void, unknown> {
  const res = await fetch("/api/concierge/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: args.threadId ?? undefined,
      message: args.message,
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // body wasn't JSON — fall through to a generic HTTP error message.
    }
    // The route handler distinguishes COST_BUDGET_EXCEEDED and PREFLIGHT_FAILURE
    // (HTTP 500 with a specific `error` field) from generic HTTP errors so the
    // drawer banner can surface the precise code instead of a flat HTTP_ERROR.
    const bodyError = (payload as { error?: string } | null)?.error;
    const code =
      res.status === 429
        ? "RATE_LIMITED"
        : bodyError === "COST_BUDGET_EXCEEDED"
          ? "COST_BUDGET_EXCEEDED"
          : bodyError === "PREFLIGHT_FAILURE"
            ? "PREFLIGHT_FAILURE"
            : "HTTP_ERROR";
    yield {
      type: "error",
      code,
      message:
        (payload as { message?: string } | null)?.message ??
        bodyError ??
        `HTTP ${res.status}`,
    };
    return;
  }

  if (!res.body) {
    yield {
      type: "error",
      code: "NO_BODY",
      message: "Response had no body",
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by \n\n. A frame's content is one or more
      // lines starting with "data: ". We only emit "data:" lines.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            yield { type: "stream_done" };
            return;
          }
          try {
            const parsed = JSON.parse(payload) as StreamClientEvent;
            yield parsed;
          } catch {
            // Skip malformed frame. Server-side SSE writes via JSON.stringify
            // so this should never fire in practice.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
