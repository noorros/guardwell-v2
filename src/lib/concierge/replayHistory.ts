// src/lib/concierge/replayHistory.ts
//
// Replay a thread's persisted ConversationMessage rows into the
// UIMessage[] shape that <ConciergeConversation> renders. Live streaming
// builds an AssistantMessage whose `parts` array interleaves text segments
// with tool-chip parts as `tool_use_started` / `tool_result` events arrive.
// Persistence captures USER + ASSISTANT + TOOL rows separately, so naive
// hydration (USER + ASSISTANT only) drops every chip on a resumed thread.
//
// This helper closes that fidelity gap: walking createdAt-asc rows, it
// groups consecutive TOOL rows with the NEXT ASSISTANT row and injects
// them as `tool`-kind AssistantParts at the FRONT of that assistant
// bubble's parts array (chips first, final text last). That matches what
// persistence captures — intermediate-iteration text emitted BEFORE a
// tool_use is streamed live but never persisted; only the final non-tool
// turn's text lands in the assistant ConversationMessage row.
//
// Defensive boundary: TOOL payloads are narrowed via Zod safeParse rather
// than blindly trusted. A row whose payload doesn't match the expected
// shape (legacy data, partial event from an earlier schema, etc.) is
// console.warn'd and skipped — the rest of the conversation still
// renders. Orphan TOOL rows without a closing ASSISTANT (interrupted
// stream, broken ordering) are also dropped with a warning.
//
// This module is pure logic — no DB, no React, no I/O. Callers (the
// /concierge route's history-load step) feed it ConversationMessage rows
// from Prisma and get a UIMessage[] back.

import { z } from "zod";
import type {
  AssistantPart,
  UIMessage,
} from "@/components/gw/ConciergeConversation";

export interface ConversationMessageRow {
  id: string;
  role: string; // "USER" | "ASSISTANT" | "TOOL"
  content: string;
  payload: unknown; // Json — defensive narrow inside
}

// The minimal shape we need to render a tool chip on replay. The real
// TOOL payload also carries threadId, messageId, toolInput, and toolOutput
// (see projectConciergeToolInvoked) but those aren't needed for chip
// rendering — leave them out of the parsed shape.
const ToolInvokedPayload = z.object({
  toolName: z.string().min(1),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
  // toolInvocationId is the chip's stable React key — it's also the
  // tool_use_id the streaming UI used. Required so chip parts have a
  // stable id that matches what live streaming would have produced.
  toolInvocationId: z.string().min(1),
});

export function replayThreadHistory(
  rows: ConversationMessageRow[],
): UIMessage[] {
  const output: UIMessage[] = [];
  let pendingToolParts: AssistantPart[] = [];

  for (const row of rows) {
    if (row.role === "USER") {
      // A new USER turn arriving before its closing ASSISTANT means the
      // prior turn's tools never landed an assistant response (interrupted
      // stream). Drop the orphan parts — there's no bubble to attach
      // them to without inventing a synthetic assistant turn.
      if (pendingToolParts.length > 0) {
        console.warn(
          `[replayThreadHistory] ${pendingToolParts.length} orphan TOOL row(s) dropped — no closing ASSISTANT before USER ${row.id}`,
        );
        pendingToolParts = [];
      }
      output.push({
        id: row.id,
        role: "user",
        content: row.content,
      });
      continue;
    }

    if (row.role === "TOOL") {
      const parsed = ToolInvokedPayload.safeParse(row.payload);
      if (!parsed.success) {
        console.warn(
          `[replayThreadHistory] malformed TOOL payload on row ${row.id}; skipping`,
        );
        continue;
      }
      pendingToolParts.push({
        kind: "tool",
        toolUseId: parsed.data.toolInvocationId,
        toolName: parsed.data.toolName,
        // status: "running" is impossible at replay time — every persisted
        // TOOL row has a final outcome (success or error).
        status: parsed.data.error ? "error" : "done",
        latencyMs: parsed.data.latencyMs,
        errorMessage: parsed.data.error,
      });
      continue;
    }

    if (row.role === "ASSISTANT") {
      output.push({
        id: row.id,
        role: "assistant",
        // Chips FIRST, then the final text — matches what persistence
        // captures (intermediate text isn't persisted; only the final
        // non-tool turn's text). Live streaming order on a fresh turn is
        // also chips-first for a tool-using response, so resumed threads
        // visually match what the user saw the first time.
        parts: [
          ...pendingToolParts,
          { kind: "text", text: row.content },
        ],
        // Historical messages are NOT streaming — they're hydrated.
        streaming: false,
      });
      pendingToolParts = [];
      continue;
    }

    // Unknown role — defensive no-op. The Prisma schema only emits
    // USER / ASSISTANT / TOOL today, but a future role added in a later
    // PR shouldn't crash the page.
  }

  // Trailing TOOL rows without a closing ASSISTANT — same rationale as
  // the USER-mid-pending-tools branch above. Interrupted-stream edge
  // case; warn + drop rather than fabricate a bubble.
  if (pendingToolParts.length > 0) {
    console.warn(
      `[replayThreadHistory] ${pendingToolParts.length} trailing TOOL row(s) dropped — no closing ASSISTANT at end of history`,
    );
  }

  return output;
}
