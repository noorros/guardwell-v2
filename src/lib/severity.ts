// src/lib/severity.ts
//
// Shared severity scale used by ScoreRing, DeadlineWarning, MajorBreachBanner,
// etc. Four bands mirror the compliance-score thresholds in ADR-0005. Each
// maps to a CSS token so components never hardcode colors.

import { scoreToColorToken } from "./utils";

export type Severity = "compliant" | "good" | "needs" | "risk";

const SEVERITY_SCORE: Record<Severity, number> = {
  compliant: 95,
  good: 75,
  needs: 55,
  risk: 25,
};

/** Map a severity enum to the same CSS token that scoreToColorToken emits. */
export function severityToColorToken(severity: Severity): string {
  return scoreToColorToken(SEVERITY_SCORE[severity]);
}

/** Days-until-deadline -> severity band.
 *  - past due (negative days) or <= 3 days: risk
 *  - 4–14 days: needs
 *  - 15–30 days: good
 *  - 30+ days: compliant
 */
export function daysUntilToSeverity(days: number): Severity {
  if (days <= 3) return "risk";
  if (days <= 14) return "needs";
  if (days <= 30) return "good";
  return "compliant";
}
