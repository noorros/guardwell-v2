// src/lib/compliance/derivation/hipaa.ts
//
// Pure derivation rules for HIPAA requirements. One function per
// RegulatoryRequirement.code whose acceptedEvidenceTypes intersect an
// emitted evidence. Each rule receives a Prisma transaction client + the
// practiceId and returns the derived status ("COMPLIANT" | "GAP" |
// "NOT_STARTED"), or null to signal "this rule doesn't apply — skip".
//
// Rules must be idempotent and side-effect-free. The rederive helper
// wraps the result into an event + projection.

import type { Prisma } from "@prisma/client";
import { HIPAA_PP_POLICY_SET, type HipaaPolicyCode } from "@/lib/compliance/policies";
import { courseCompletionThresholdRule } from "./shared";

export type DerivedStatus = "COMPLIANT" | "GAP" | "NOT_STARTED";
export type DerivationRule = (
  tx: Prisma.TransactionClient,
  practiceId: string,
) => Promise<DerivedStatus | null>;

/**
 * HIPAA §164.530(a)(1)(i). Satisfied when at least one active PracticeUser
 * has isPrivacyOfficer=true (removedAt is null).
 */
export async function hipaaPrivacyOfficerRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practiceUser.count({
    where: { practiceId, isPrivacyOfficer: true, removedAt: null },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

/**
 * HIPAA §164.308(a)(2). Same shape as Privacy Officer but for Security.
 */
export async function hipaaSecurityOfficerRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practiceUser.count({
    where: { practiceId, isSecurityOfficer: true, removedAt: null },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

/**
 * Generic single-policy rule factory: requires one adopted-and-not-retired
 * PracticePolicy with the given policyCode.
 */
function singlePolicyRule(required: HipaaPolicyCode): DerivationRule {
  return async (tx, practiceId) => {
    const count = await tx.practicePolicy.count({
      where: { practiceId, policyCode: required, retiredAt: null },
    });
    return count >= 1 ? "COMPLIANT" : "GAP";
  };
}

/**
 * HIPAA §164.530(i)(1). Satisfied only when ALL three core P&P policies —
 * Privacy, Security, and Breach Response — are adopted and not retired.
 */
export async function hipaaPoliciesProceduresRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const adopted = await tx.practicePolicy.findMany({
    where: {
      practiceId,
      retiredAt: null,
      policyCode: { in: [...HIPAA_PP_POLICY_SET] },
    },
    select: { policyCode: true },
  });
  const hasAll = HIPAA_PP_POLICY_SET.every((c) =>
    adopted.some((a) => a.policyCode === c),
  );
  return hasAll ? "COMPLIANT" : "GAP";
}

/**
 * HIPAA §164.530(b)(1). Satisfied when ≥95% of active workforce has a
 * passed, non-expired TrainingCompletion for the HIPAA_BASICS course.
 * Single-owner practices hit 100% after one completion.
 */
export const hipaaWorkforceTrainingRule: DerivationRule =
  courseCompletionThresholdRule("HIPAA_BASICS", 0.95);

/**
 * HIPAA §164.308(b)(1). Satisfied when EVERY active, PHI-processing
 * Vendor has a non-expired BAA on file. Practices with zero PHI
 * vendors stay GAP ("list your vendors or mark N/A"); the explicit
 * NOT_APPLICABLE override via the module page is the escape hatch
 * for the rare practice that genuinely has none.
 */
export async function hipaaBaaRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const phiVendors = await tx.vendor.findMany({
    where: { practiceId, retiredAt: null, processesPhi: true },
    select: { baaExecutedAt: true, baaExpiresAt: true },
  });
  if (phiVendors.length === 0) return "GAP";
  const now = new Date();
  const allCovered = phiVendors.every(
    (v) =>
      v.baaExecutedAt !== null &&
      (v.baaExpiresAt === null || v.baaExpiresAt > now),
  );
  return allCovered ? "COMPLIANT" : "GAP";
}

export const HIPAA_DERIVATION_RULES: Record<string, DerivationRule> = {
  HIPAA_PRIVACY_OFFICER: hipaaPrivacyOfficerRule,
  HIPAA_SECURITY_OFFICER: hipaaSecurityOfficerRule,
  HIPAA_POLICIES_PROCEDURES: hipaaPoliciesProceduresRule,
  HIPAA_MINIMUM_NECESSARY: singlePolicyRule("HIPAA_MINIMUM_NECESSARY_POLICY"),
  HIPAA_NPP: singlePolicyRule("HIPAA_NPP_POLICY"),
  HIPAA_BREACH_RESPONSE: singlePolicyRule("HIPAA_BREACH_RESPONSE_POLICY"),
  HIPAA_WORKSTATION_USE: singlePolicyRule("HIPAA_WORKSTATION_POLICY"),
  HIPAA_WORKFORCE_TRAINING: hipaaWorkforceTrainingRule,
  HIPAA_BAAS: hipaaBaaRule,
};
