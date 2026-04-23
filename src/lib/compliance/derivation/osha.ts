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
import { courseCompletionThresholdRule } from "./shared";

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

/**
 * 29 CFR §1904.7 — OSHA 300/300A recordkeeping. Launch interpretation:
 * a practice that has logged at least one OSHA_RECORDABLE incident in
 * the last 365 days is actively using the Log 300 workflow (every such
 * incident gets captured via the incident detail page, which the
 * compliance PDF pulls from). Practices with zero recordable incidents
 * in the last year stay GAP and manual-override to NOT_APPLICABLE or
 * COMPLIANT via the module radios — the escape hatch preserves the
 * "no injuries = still need log in place" reality without forcing
 * everyone to report a no-op.
 *
 * Sharpened versions (annual 300A posting attestation, 7-day record
 * deadline) come in follow-up PRs once those events exist.
 */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

async function osha300LogRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff = new Date(Date.now() - YEAR_MS);
  const count = await tx.incident.count({
    where: {
      practiceId,
      type: "OSHA_RECORDABLE",
      discoveredAt: { gt: cutoff },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

export const OSHA_DERIVATION_RULES: Record<string, DerivationRule> = {
  // §1910.1030(c) — Exposure Control Plan is the core written document.
  OSHA_BBP_EXPOSURE_CONTROL: oshaPolicyRule("OSHA_BBP_EXPOSURE_CONTROL_PLAN"),
  // §1910.1030(g)(2) — annual BBP training for workforce with exposure.
  // Same ≥95% threshold pattern as HIPAA_WORKFORCE_TRAINING.
  OSHA_BBP_TRAINING: courseCompletionThresholdRule(
    "BLOODBORNE_PATHOGEN_TRAINING",
    0.95,
  ),
  // §1910.1200 — HazCom Program covers SDS + chemical inventory + training.
  OSHA_HAZCOM: oshaPolicyRule("OSHA_HAZCOM_PROGRAM"),
  // §1910.38 — Written Emergency Action Plan.
  OSHA_EMERGENCY_ACTION_PLAN: oshaPolicyRule("OSHA_EMERGENCY_ACTION_PLAN"),
  // §1904.7 — OSHA 300 Log + 300A Summary.
  OSHA_300_LOG: osha300LogRule,
};
