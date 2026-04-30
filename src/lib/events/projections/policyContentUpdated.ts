// src/lib/events/projections/policyContentUpdated.ts
//
// Projects POLICY_CONTENT_UPDATED events. Updates PracticePolicy.content
// + bumps version + sets lastReviewedAt = now (save IS review).
// Re-rederives POLICY_REVIEW:CURRENT since lastReviewedAt changed.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

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

  // Audit C-1: refuse a forged POLICY_CONTENT_UPDATED carrying another
  // practice's practicePolicyId — without this guard, content / version
  // / lastReviewedAt on Practice B's policy could be overwritten AND a
  // PolicyVersion row could be appended to Practice B's history.
  const existing = await tx.practicePolicy.findUnique({
    where: { id: payload.practicePolicyId },
    select: { practiceId: true },
  });
  if (!existing) {
    throw new Error(
      `POLICY_CONTENT_UPDATED refused: policy ${payload.practicePolicyId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "practicePolicy",
    id: payload.practicePolicyId,
  });

  const now = new Date();
  // Snapshot the NEW content as a PolicyVersion row keyed by the new
  // version number. Combined with the v1 baseline created on adoption,
  // this gives us a full append-only history for diffing.
  await tx.policyVersion.create({
    data: {
      practicePolicyId: payload.practicePolicyId,
      version: payload.newVersion,
      content,
      savedByUserId: payload.editedByUserId,
      changeNote: null, // could be passed through later if we add a UI field
    },
  });
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
