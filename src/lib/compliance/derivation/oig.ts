// src/lib/compliance/derivation/oig.ts
//
// OIG derivation rules. Only OIG_COMPLIANCE_OFFICER is wired at launch —
// the other six elements of the OIG 7-element framework stay manual
// until their corresponding operational surfaces ship (OIG Element 3
// maps to training completion, Element 5 maps to audit logs, etc.).

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

/**
 * OIG Element 2. Satisfied when at least one active PracticeUser has
 * isComplianceOfficer=true. Reuses the same OFFICER_DESIGNATION pattern
 * HIPAA uses for Privacy + Security Officers.
 */
export async function oigComplianceOfficerRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practiceUser.count({
    where: { practiceId, isComplianceOfficer: true, removedAt: null },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

export const OIG_DERIVATION_RULES: Record<string, DerivationRule> = {
  OIG_COMPLIANCE_OFFICER: oigComplianceOfficerRule,
};
