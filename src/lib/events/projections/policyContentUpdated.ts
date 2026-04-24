// src/lib/events/projections/policyContentUpdated.ts
//
// Projects POLICY_CONTENT_UPDATED events. Updates PracticePolicy.content
// + bumps version + sets lastReviewedAt = now (save IS review).
// Re-rederives POLICY_REVIEW:CURRENT since lastReviewedAt changed.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"POLICY_CONTENT_UPDATED", 1>;

interface ProjectArgs {
  practiceId: string;
  payload: Payload;
  // Action layer passes the full content string in here so we don't
  // bloat the EventLog payload with the entire policy body. The event
  // payload only carries metadata (length, editor, version).
  content: string;
}

export async function projectPolicyContentUpdated(
  tx: Prisma.TransactionClient,
  args: ProjectArgs,
): Promise<void> {
  const { practiceId, payload, content } = args;
  const now = new Date();
  await tx.practicePolicy.update({
    where: { id: payload.practicePolicyId },
    data: {
      content,
      version: payload.newVersion,
      lastReviewedAt: now,
    },
  });
  // Save = review, so the cross-policy review-current rule re-evaluates.
  await rederiveRequirementStatus(tx, practiceId, "POLICY_REVIEW:CURRENT");
}
