// src/lib/events/projections/frameworkScore.ts
//
// Shared helper: recompute PracticeFramework.scoreCache/scoreLabel from
// current ComplianceItem rows. Called by every projection that mutates a
// ComplianceItem (currently: REQUIREMENT_STATUS_UPDATED + any
// derivation-driven projection like OFFICER_DESIGNATED). Lives in
// src/lib/events/ so the no-direct-projection-mutation lint rule allows
// its PracticeFramework upsert.
//
// Jurisdiction-aware: totals and compliant counts are scoped to
// requirements that apply to the practice (federal OR overlap any of
// the practice's operatingStates + primaryState). CA-only requirements
// don't drag down an AZ practice's score.

import type { Prisma } from "@prisma/client";
import { scoreToLabel } from "@/lib/utils";
import {
  getPracticeJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";

export async function recomputeFrameworkScore(
  tx: Prisma.TransactionClient,
  practiceId: string,
  frameworkId: string,
): Promise<void> {
  const practice = await tx.practice.findUnique({
    where: { id: practiceId },
    select: { primaryState: true, operatingStates: true },
  });
  if (!practice) return;
  const jurisdictions = getPracticeJurisdictions(practice);
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const totalCount = await tx.regulatoryRequirement.count({
    where: { frameworkId, ...jurisdictionClause },
  });
  if (totalCount === 0) return;

  const compliantCount = await tx.complianceItem.count({
    where: {
      practiceId,
      status: "COMPLIANT",
      requirement: { frameworkId, ...jurisdictionClause },
    },
  });

  const score = Math.round((compliantCount / totalCount) * 100);
  const label = scoreToLabel(score);
  const now = new Date();

  await tx.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId,
        frameworkId,
      },
    },
    update: {
      scoreCache: score,
      scoreLabel: label,
      lastScoredAt: now,
    },
    create: {
      practiceId,
      frameworkId,
      enabled: true,
      enabledAt: now,
      scoreCache: score,
      scoreLabel: label,
      lastScoredAt: now,
    },
  });
}
