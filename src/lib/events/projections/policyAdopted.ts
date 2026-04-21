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
import type { HipaaPolicyCode } from "@/lib/compliance/policies";

type AdoptedPayload = PayloadFor<"POLICY_ADOPTED", 1>;
type RetiredPayload = PayloadFor<"POLICY_RETIRED", 1>;

export async function projectPolicyAdopted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: AdoptedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practicePolicy.upsert({
    where: { id: payload.practicePolicyId },
    update: {
      policyCode: payload.policyCode,
      version: payload.version,
      retiredAt: null,
      adoptedAt: new Date(),
    },
    create: {
      id: payload.practicePolicyId,
      practiceId,
      policyCode: payload.policyCode,
      version: payload.version,
    },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    evidenceCodeForPolicy(payload.policyCode as HipaaPolicyCode),
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
    evidenceCodeForPolicy(payload.policyCode as HipaaPolicyCode),
  );
}
