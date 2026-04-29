// src/lib/ai/monthBoundary.ts
//
// Shared month-boundary helper. Both the cost-budget guard
// (assertMonthlyCostBudget) and the dashboard cost tile
// (getConciergeMonthlySpend) sum LlmCall.costUsd over the same calendar
// month — they MUST agree on where that month starts, otherwise the
// number the dashboard shows can drift past the budget the guard is
// enforcing. Centralizing the boundary keeps the two in lockstep.

/**
 * UTC start-of-month for a given (or current) date. Used by:
 *   - costGuard (monthly budget enforcement)
 *   - conciergeMonthlySpend (dashboard tile)
 * Both must use the same boundary so the budget exposed in UI matches the
 * window the guard enforces.
 */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}
