// src/lib/events/projections/policyAdopted.ts
//
// Projects POLICY_ADOPTED and POLICY_RETIRED events. The projection
// upserts/updates the PracticePolicy row, then rederives any
// RegulatoryRequirement that lists "POLICY:<policyCode>" in its
// acceptedEvidenceTypes.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { evidenceCodeForPolicy } from "@/lib/compliance/policies";
import type { PolicyCode } from "@/lib/compliance/policies";

type AdoptedPayload = PayloadFor<"POLICY_ADOPTED", 1>;
type RetiredPayload = PayloadFor<"POLICY_RETIRED", 1>;
type ReviewedPayload = PayloadFor<"POLICY_REVIEWED", 1>;

export async function projectPolicyAdopted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: AdoptedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const now = new Date();
  await tx.practicePolicy.upsert({
    where: { id: payload.practicePolicyId },
    update: {
      policyCode: payload.policyCode,
      version: payload.version,
      retiredAt: null,
      adoptedAt: now,
      // Initial adoption resets the review clock — adoption IS the most
      // recent review.
      lastReviewedAt: now,
    },
    create: {
      id: payload.practicePolicyId,
      practiceId,
      policyCode: payload.policyCode,
      version: payload.version,
      lastReviewedAt: now,
    },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    evidenceCodeForPolicy(payload.policyCode as PolicyCode),
  );
  // Adoption may also satisfy the cross-policy review-current requirement
  // (e.g. if this is the last unrenewed policy).
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY_REVIEW:CURRENT",
  );
}

export async function projectPolicyRetired(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RetiredPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practicePolicy.update({
    where: { id: payload.practicePolicyId },
    data: { retiredAt: new Date() },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    evidenceCodeForPolicy(payload.policyCode as PolicyCode),
  );
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY_REVIEW:CURRENT",
  );
}

export async function projectPolicyReviewed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ReviewedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practicePolicy.update({
    where: { id: payload.practicePolicyId },
    data: { lastReviewedAt: new Date() },
  });
  // The cross-policy review-current rule recomputes from the new
  // lastReviewedAt.
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY_REVIEW:CURRENT",
  );
}
