// src/lib/compliance/overallScore.ts
//
// Canonical "overall practice compliance" computation. Used by both the
// /audit/overview dashboard and the AI Concierge get_dashboard_snapshot
// tool so the user always sees the same number.
//
// Formula: round(compliantApplicable / totalApplicable * 100). "Applicable"
// = passes the jurisdiction filter (federal + practice's primary/operating
// states). Returns 0 when the practice has no applicable requirements.
//
// NOTE: This counts ALL applicable RegulatoryRequirements, regardless of
// whether the framework is enrolled. That matches the audit/overview page
// behavior (which uses the same filter for the "X of Y compliant" total).
// The onboarding drip in src/lib/onboarding/run-drip.ts intentionally
// scopes to enabled frameworks only — that surface stays separate.

import { db } from "@/lib/db";
import {
  getPracticeJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";

export interface OverallScore {
  /** Rounded 0..100. 0 when totalApplicable === 0. */
  score: number;
  totalApplicable: number;
  compliantApplicable: number;
}

export async function computeOverallScore(
  practiceId: string,
): Promise<OverallScore> {
  const practice = await db.practice.findUnique({
    where: { id: practiceId },
    select: { primaryState: true, operatingStates: true },
  });
  if (!practice) {
    return { score: 0, totalApplicable: 0, compliantApplicable: 0 };
  }

  const jurisdictions = getPracticeJurisdictions(practice);
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const [applicableReqs, items] = await Promise.all([
    db.regulatoryRequirement.findMany({
      where: { ...jurisdictionClause },
      select: { id: true },
    }),
    db.complianceItem.findMany({
      where: { practiceId },
      select: { requirementId: true, status: true },
    }),
  ]);

  const totalApplicable = applicableReqs.length;
  if (totalApplicable === 0) {
    return { score: 0, totalApplicable: 0, compliantApplicable: 0 };
  }

  const applicableIds = new Set(applicableReqs.map((r) => r.id));
  const compliantApplicable = items.filter(
    (i) => i.status === "COMPLIANT" && applicableIds.has(i.requirementId),
  ).length;
  const score = Math.round((compliantApplicable / totalApplicable) * 100);
  return { score, totalApplicable, compliantApplicable };
}
