// src/lib/ai/conciergeMonthlySpend.ts
//
// Helper for the dashboard "Concierge usage" tile. Sums LlmCall.costUsd
// for the registered Concierge prompt (concierge.chat.v1) for a given
// practice across the current calendar month (UTC).
//
// Boundary convention is shared with src/lib/ai/costGuard.ts so the
// dashboard number cannot drift past the budget the guard enforces —
// see src/lib/ai/monthBoundary.ts for the rationale.

import { db } from "@/lib/db";
import { startOfMonthUtc } from "@/lib/ai/monthBoundary";

const CONCIERGE_PROMPT_ID = "concierge.chat.v1";

export interface ConciergeMonthlySpend {
  costUsd: number; // sum, 6-decimal precision (Prisma Decimal cast to number)
  messageCount: number; // count of LlmCall rows in the window (success + failure)
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sum LlmCall.costUsd for the Concierge prompt across the current calendar
 * month (UTC) for a given practice. Returns the dollar amount as a JS number.
 *
 * Mirrors the start-of-month convention in src/lib/ai/costGuard.ts so the
 * dashboard tile and the cost-budget enforcement use the same window
 * boundary.
 *
 * Includes both successful and failed LlmCall rows in the count — the
 * cost was incurred either way. A failed row with costUsd=null contributes
 * 0 to the sum but still increments the message count.
 */
export async function getConciergeMonthlySpend(args: {
  practiceId: string;
}): Promise<ConciergeMonthlySpend> {
  const since = startOfMonthUtc();
  const rows = await db.llmCall.findMany({
    where: {
      practiceId: args.practiceId,
      promptId: CONCIERGE_PROMPT_ID,
      createdAt: { gte: since },
    },
    select: {
      costUsd: true,
      inputTokens: true,
      outputTokens: true,
    },
  });

  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of rows) {
    // costUsd is Prisma Decimal | null. Number(null) === 0, but spell out
    // the null branch so the intent is explicit (failed calls with no
    // cost still count toward messageCount but contribute 0 to the sum).
    if (r.costUsd != null) {
      costUsd += Number(r.costUsd as unknown as number);
    }
    if (r.inputTokens != null) inputTokens += r.inputTokens;
    if (r.outputTokens != null) outputTokens += r.outputTokens;
  }

  return {
    costUsd,
    messageCount: rows.length,
    inputTokens,
    outputTokens,
  };
}
