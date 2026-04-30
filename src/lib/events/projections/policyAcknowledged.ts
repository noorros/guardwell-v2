// src/lib/events/projections/policyAcknowledged.ts
//
// Projects POLICY_ACKNOWLEDGED events: writes a PolicyAcknowledgment
// row keyed on (practicePolicyId, userId, policyVersion). Re-acks of
// the same version are deduped by the unique constraint — the action
// layer should check before emitting if it wants to be silent.
//
// Triggers rederive of the cross-policy acknowledgment-coverage rule
// (HIPAA_POLICY_ACKNOWLEDGMENT_COVERAGE) so practice-wide compliance
// scoring updates immediately.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type Payload = PayloadFor<"POLICY_ACKNOWLEDGED", 1>;

export async function projectPolicyAcknowledged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse a forged POLICY_ACKNOWLEDGED carrying another
  // practice's practicePolicyId — without this guard, an acknowledgment
  // row would be created against Practice B's policy under our practice
  // (FK invariant break) AND poison Practice B's
  // HIPAA_POLICY_ACKNOWLEDGMENT_COVERAGE rederive on a future trigger.
  const existing = await tx.practicePolicy.findUnique({
    where: { id: payload.practicePolicyId },
    select: { practiceId: true },
  });
  if (!existing) {
    throw new Error(
      `POLICY_ACKNOWLEDGED refused: policy ${payload.practicePolicyId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "practicePolicy",
    id: payload.practicePolicyId,
  });

  await tx.policyAcknowledgment.create({
    data: {
      practicePolicyId: payload.practicePolicyId,
      userId: payload.acknowledgingUserId,
      policyVersion: payload.policyVersion,
      signatureText: payload.signatureText,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "POLICY_ACK:COVERED");
}
