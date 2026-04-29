// src/lib/ai/costGuard.ts
//
// Monthly cost ceiling. Reads LLM_MONTHLY_BUDGET_USD (USD, string). If
// unset or zero, the guard is disabled. Sums LlmCall.costUsd across the
// current calendar month (server time) and refuses new calls once the
// total meets or exceeds the budget.

import { db } from "@/lib/db";
import { startOfMonthUtc } from "@/lib/ai/monthBoundary";

export async function assertMonthlyCostBudget(): Promise<void> {
  const budgetRaw = process.env.LLM_MONTHLY_BUDGET_USD;
  if (!budgetRaw) return;
  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget) || budget <= 0) return;

  const since = startOfMonthUtc();
  const rows = await db.llmCall.findMany({
    where: { createdAt: { gte: since }, costUsd: { not: null } },
    select: { costUsd: true },
  });
  const total = rows.reduce(
    (sum, r) => sum + Number((r.costUsd as unknown as number) ?? 0),
    0,
  );
  if (total >= budget) {
    throw new Error(
      `COST_BUDGET_EXCEEDED: $${total.toFixed(2)} used this month (budget $${budget.toFixed(2)})`,
    );
  }
}
