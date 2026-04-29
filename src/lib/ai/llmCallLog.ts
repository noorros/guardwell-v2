// src/lib/ai/llmCallLog.ts
//
// Shared LlmCall row writer. Every Anthropic call (single-turn via runLlm,
// multi-turn streaming via streamConciergeTurn) persists exactly one
// LlmCall row capturing tokens / cost / latency / success — the
// observability backbone called out in ADR-0003 and the foundation of
// the cost dashboard.
//
// Both runLlm and streamConciergeTurn import this helper so the row
// shape stays in one place. The error-code union here is a SUPERSET of
// what runLlm uses today (PERSISTENCE is exclusive to the streaming path,
// where the AI call succeeded but the projection write failed).

import { db } from "@/lib/db";

/**
 * All error codes any Anthropic call site may persist on a failed
 * LlmCall row. Adding a new code? Update both call sites and the
 * cost-dashboard label map.
 *
 * - INPUT_SCHEMA / NO_TOOL_USE / OUTPUT_SCHEMA: runLlm validation paths
 * - UPSTREAM: SDK threw (network, 5xx, abort other than user-initiated)
 * - INTERNAL: catch-all for unexpected runtime errors
 * - PERSISTENCE: AI call succeeded but the projection / DB write failed
 *   (streaming-only — runLlm has no projection step)
 */
export type LlmCallErrorCode =
  | "INPUT_SCHEMA"
  | "UPSTREAM"
  | "NO_TOOL_USE"
  | "OUTPUT_SCHEMA"
  | "INTERNAL"
  | "PERSISTENCE";

export interface WriteLlmCallArgs {
  promptId: string;
  promptVersion: number;
  model: string;
  practiceId?: string | null;
  actorUserId?: string | null;
  inputHash: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs: number;
  costUsd: number | null;
  success: boolean;
  errorCode?: LlmCallErrorCode | null;
  containsPHI: boolean;
}

/**
 * Persist one LlmCall row and return its id. The id is then attached to
 * downstream events / ConversationMessage rows so audits can trace from
 * a user-facing message back to the exact AI call that produced it.
 */
export async function writeLlmCall(args: WriteLlmCallArgs): Promise<string> {
  const row = await db.llmCall.create({
    data: {
      promptId: args.promptId,
      promptVersion: args.promptVersion,
      model: args.model,
      practiceId: args.practiceId ?? null,
      actorUserId: args.actorUserId ?? null,
      inputHash: args.inputHash,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      latencyMs: args.latencyMs,
      costUsd: args.costUsd as unknown as null, // Prisma Decimal accepts number
      success: args.success,
      errorCode: args.errorCode ?? null,
      containsPHI: args.containsPHI,
    },
  });
  return row.id;
}
