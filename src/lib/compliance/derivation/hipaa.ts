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

export const HIPAA_DERIVATION_RULES: Record<string, DerivationRule> = {
  HIPAA_PRIVACY_OFFICER: hipaaPrivacyOfficerRule,
  HIPAA_SECURITY_OFFICER: hipaaSecurityOfficerRule,
};
