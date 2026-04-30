// src/lib/ai/runConciergeTurn.ts
//
// Non-streaming variant of streamConciergeTurn() — a thin async-generator
// collector that walks the streaming primitive end-to-end and returns a
// single result object (final text + observed tool calls + tokens + cost).
//
// Designed for the eval harness (scripts/eval-concierge.ts) and the
// matching unit tests. Production traffic still goes through
// streamConciergeTurn (chat route is SSE-streamed); this collector is
// purely a convenience for non-interactive callers that need the
// completed turn synchronously.
//
// Contract notes:
//   - This is a THIN COLLECTOR. We do NOT reimplement any of the loop /
//     tool-handling / persistence logic — streamConciergeTurn writes
//     ConversationMessage + LlmCall + EventLog rows on its own; we only
//     project the events we observe back to the caller.
//   - No AbortSignal: eval runs to completion. Add one later if a
//     non-eval caller needs cancellation.
//   - Errors from the generator (UPSTREAM, EMPTY_HISTORY, PERSISTENCE,
//     ITERATION_CAP_REACHED, etc.) accumulate into result.errors instead
//     of throwing. Callers decide whether a non-empty errors array is
//     fatal — for the eval harness, an EMPTY_HISTORY would be a setup
//     bug worth surfacing, but a PERSISTENCE on the final write is still
//     a "the model produced text" outcome.

import { streamConciergeTurn } from "./streamConciergeTurn";

export interface RunConciergeTurnArgs {
  practiceId: string;
  practice: {
    name: string;
    primaryState: string;
    providerCount: string | null;
    /** Coerce to "UTC" before calling if the practice has no timezone set. */
    timezone: string;
  };
  threadId: string;
  actorUserId: string;
}

export interface RunConciergeTurnToolCall {
  toolName: string;
  toolUseId: string;
  /** null on success; populated when the tool handler raised. */
  error: string | null;
  latencyMs: number;
}

export interface RunConciergeTurnResult {
  /** Concatenation of every text_delta event the generator yielded (the
   *  final-iteration assistant text — the same string that lands in the
   *  assistant ConversationMessage row). */
  text: string;
  toolCalls: RunConciergeTurnToolCall[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** Non-fatal error events emitted by the generator (e.g. TOOL_PERSISTENCE).
   *  A terminal error (UPSTREAM, EMPTY_HISTORY, ABORTED) also lands here —
   *  the generator returns immediately after yielding it. */
  errors: Array<{ code: string; message: string }>;
}

export async function runConciergeTurn(
  args: RunConciergeTurnArgs,
): Promise<RunConciergeTurnResult> {
  const result: RunConciergeTurnResult = {
    text: "",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    errors: [],
  };

  // Index tool_use_started events by toolUseId so the matching tool_result
  // event can fill in error + latencyMs without re-scanning the whole array.
  const toolCallIndex = new Map<string, RunConciergeTurnToolCall>();

  for await (const event of streamConciergeTurn(args)) {
    switch (event.type) {
      case "text_delta":
        result.text += event.text;
        break;
      case "tool_use_started": {
        const tc: RunConciergeTurnToolCall = {
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          error: null,
          latencyMs: 0,
        };
        result.toolCalls.push(tc);
        toolCallIndex.set(event.toolUseId, tc);
        break;
      }
      case "tool_result": {
        const tc = toolCallIndex.get(event.toolUseId);
        if (tc) {
          tc.error = event.error;
          tc.latencyMs = event.latencyMs;
        }
        break;
      }
      case "turn_complete":
        result.inputTokens = event.inputTokens;
        result.outputTokens = event.outputTokens;
        result.costUsd = event.costUsd;
        break;
      case "error":
        result.errors.push({ code: event.code, message: event.message });
        break;
    }
  }

  return result;
}
