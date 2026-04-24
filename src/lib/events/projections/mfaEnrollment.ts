// src/lib/events/projections/mfaEnrollment.ts
//
// Projects MFA_ENROLLMENT_RECORDED events: sets / clears
// PracticeUser.mfaEnrolledAt and rederives HIPAA_MFA_COVERAGE_GE_80.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"MFA_ENROLLMENT_RECORDED", 1>;

export async function projectMfaEnrollmentRecorded(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practiceUser.update({
    where: { id: payload.practiceUserId },
    data: {
      mfaEnrolledAt: payload.enrolled ? new Date() : null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "MFA:ENROLLED");
}
