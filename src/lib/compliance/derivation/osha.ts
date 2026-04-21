// src/lib/compliance/derivation/osha.ts
//
// OSHA derivation rules. Each function receives a Prisma transaction
// client + the practiceId and returns the derived status, or null if
// the rule doesn't apply.
//
// Rules stay thin — the real work is matching acceptedEvidenceTypes on
// the requirement to the evidence types this rule knows how to check.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";
import type { OshaPolicyCode } from "@/lib/compliance/policies";

/**
 * Generic: is the given OSHA policy code currently adopted (not retired)?
 */
function oshaPolicyRule(required: OshaPolicyCode): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const count = await tx.practicePolicy.count({
      where: { practiceId, policyCode: required, retiredAt: null },
    });
    return count >= 1 ? "COMPLIANT" : "GAP";
  };
}

export const OSHA_DERIVATION_RULES: Record<string, DerivationRule> = {
  // §1910.1030(c) — Exposure Control Plan is the core written document.
  OSHA_BBP_EXPOSURE_CONTROL: oshaPolicyRule("OSHA_BBP_EXPOSURE_CONTROL_PLAN"),
  // §1910.1200 — HazCom Program covers SDS + chemical inventory + training.
  OSHA_HAZCOM: oshaPolicyRule("OSHA_HAZCOM_PROGRAM"),
  // §1910.38 — Written Emergency Action Plan.
  OSHA_EMERGENCY_ACTION_PLAN: oshaPolicyRule("OSHA_EMERGENCY_ACTION_PLAN"),
};
