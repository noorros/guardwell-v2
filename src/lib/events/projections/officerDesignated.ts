// src/lib/events/projections/officerDesignated.ts
//
// Projects OFFICER_DESIGNATED events into:
//   1. The PracticeUser boolean flag for the specified officerRole
//      (isPrivacyOfficer / isSecurityOfficer / isComplianceOfficer /
//       isSafetyOfficer).
//   2. Any derived ComplianceItem rows via rederiveRequirementStatus.
//
// PracticeUser is NOT in the no-direct-projection-mutation
// PROJECTION_TABLES set, so updating it here is allowed. The
// ComplianceItem + PracticeFramework writes happen inside the derivation
// helper (src/lib/compliance/derivation/), which is explicitly allowed
// via the lint rule's ALLOWED_PATHS.

import type { Prisma } from "@prisma/client";
import type { PayloadFor, OfficerRole } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"OFFICER_DESIGNATED", 1>;

const OFFICER_FLAG_FIELD: Record<
  OfficerRole,
  "isPrivacyOfficer" | "isSecurityOfficer" | "isComplianceOfficer" | "isSafetyOfficer"
> = {
  PRIVACY: "isPrivacyOfficer",
  SECURITY: "isSecurityOfficer",
  COMPLIANCE: "isComplianceOfficer",
  SAFETY: "isSafetyOfficer",
};

export async function projectOfficerDesignated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  const flagField = OFFICER_FLAG_FIELD[payload.officerRole];

  await tx.practiceUser.update({
    where: { id: payload.practiceUserId },
    data: { [flagField]: payload.designated },
  });

  const evidenceTypeCode = `OFFICER_DESIGNATION:${payload.officerRole}`;
  await rederiveRequirementStatus(tx, practiceId, evidenceTypeCode);
}
