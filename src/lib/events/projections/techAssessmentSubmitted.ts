// src/lib/events/projections/techAssessmentSubmitted.ts
//
// Phase 5 PR 4 — flips the Tech Assessment draft to completed and
// stamps the score. PR 5 will extend this projection to also auto-
// create RiskItem rows for every NO/PARTIAL answer; for now we just
// promote the draft.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"TECH_ASSESSMENT_SUBMITTED", 1>;

export async function projectTechAssessmentSubmitted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1 cross-tenant guard — a forged event referencing another
  // practice's draft must be refused.
  const existing = await tx.techAssessment.findUnique({
    where: { id: payload.assessmentId },
    select: { practiceId: true, isDraft: true, completedAt: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "techAssessment",
    id: payload.assessmentId,
  });
  if (!existing) {
    throw new Error(
      `TECH_ASSESSMENT_SUBMITTED refused: assessment ${payload.assessmentId} not found`,
    );
  }
  if (!existing.isDraft || existing.completedAt !== null) {
    throw new Error(
      `TECH_ASSESSMENT_SUBMITTED refused: assessment ${payload.assessmentId} is already completed`,
    );
  }

  await tx.techAssessment.update({
    where: { id: payload.assessmentId },
    data: {
      isDraft: false,
      completedAt: new Date(),
      overallScore: payload.overallScore,
      addressedCount: payload.addressedCount,
      totalCount: payload.totalCount,
    },
  });
}
