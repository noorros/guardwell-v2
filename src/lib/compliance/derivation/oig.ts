// src/lib/compliance/derivation/oig.ts
//
// OIG derivation rules — seven elements of an effective compliance program
// per HHS OIG Compliance Program Guidance (65 FR 59434, 2000).
//
// PR 5 wires 5 new rules + 1 Phase-11 stub (OIG_ENFORCEMENT_DISCIPLINE),
// extending from 1 → 7 rules total:
//
//   OIG_WRITTEN_POLICIES        — ≥2 of 3 OIG policy codes adopted
//   OIG_COMPLIANCE_OFFICER      — compliance officer designated (pre-existing)
//   OIG_TRAINING_EDUCATION      — ≥95% workforce OIG_COMPLIANCE_TRAINING (new)
//   OIG_COMMUNICATION_LINES     — anonymous reporting policy adopted (new)
//   OIG_AUDITING_MONITORING     — OIG_ANNUAL_REVIEW_SUBMITTED in last 12 mo (new)
//   OIG_ENFORCEMENT_DISCIPLINE  — discipline policy adopted; Phase 11 extends (new stub)
//   OIG_RESPONSE_VIOLATIONS     — OIG_CORRECTIVE_ACTION_RESOLVED event exists (new)

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";
import type { OigPolicyCode } from "@/lib/compliance/policies";
import { courseCompletionThresholdRule } from "./shared";

// 12-month window for auditing / monitoring.
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// The three OIG policy codes that together satisfy Element 1. At least 2 of
// these must be adopted (not retired) for OIG_WRITTEN_POLICIES to be COMPLIANT.
const OIG_POLICY_SET: readonly OigPolicyCode[] = [
  "OIG_STANDARDS_OF_CONDUCT_POLICY",
  "OIG_ANONYMOUS_REPORTING_POLICY",
  "OIG_DISCIPLINE_POLICY",
] as const;

// ─── Factory for single-policy OIG rules ────────────────────────────────────

/**
 * Generic: is the given OIG policy code currently adopted (not retired)?
 * Mirrors oshaPolicyRule / cmsPolicyRule for a consistent factory pattern.
 */
function oigPolicyRule(required: OigPolicyCode): DerivationRule {
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

// ─── OIG Element 1 ─ Written policies, procedures, standards of conduct ─────

/**
 * 65 FR 59434 Element 1 — Written policies and standards of conduct.
 * COMPLIANT if ≥2 of the 3 OIG policy codes are currently adopted.
 * Evidence codes: POLICY:OIG_STANDARDS_OF_CONDUCT_POLICY,
 *                 POLICY:OIG_ANONYMOUS_REPORTING_POLICY,
 *                 POLICY:OIG_DISCIPLINE_POLICY
 */
export async function oigWrittenPoliciesRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: { in: OIG_POLICY_SET as unknown as string[] },
      retiredAt: null,
    },
  });
  return count >= 2 ? "COMPLIANT" : "GAP";
}

// ─── OIG Element 2 ─ Compliance officer ──────────────────────────────────────

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

// ─── OIG Element 3 ─ Training and education ──────────────────────────────────
// TODO(Phase 4): seed OIG_COMPLIANCE_TRAINING course before this rule fires.
// Until the course is seeded, courseCompletionThresholdRule returns null
// (requirement stays at user-set status).

const oigTrainingEducationRule = courseCompletionThresholdRule(
  "OIG_COMPLIANCE_TRAINING",
  0.95,
);

// ─── OIG Element 4 ─ Open lines of communication ─────────────────────────────

/**
 * 65 FR 59434 Element 4 — Anonymous reporting mechanism.
 * COMPLIANT if OIG_ANONYMOUS_REPORTING_POLICY is currently adopted.
 * Evidence code: POLICY:OIG_ANONYMOUS_REPORTING_POLICY
 */
const oigCommunicationLinesRule = oigPolicyRule("OIG_ANONYMOUS_REPORTING_POLICY");

// ─── OIG Element 5 ─ Auditing and monitoring ──────────────────────────────────

/**
 * 65 FR 59434 Element 5 — Internal auditing and monitoring.
 * COMPLIANT if at least one OIG_ANNUAL_REVIEW_SUBMITTED EventLog row exists
 * for this practice within the last 12 months.
 * Evidence code: EVENT:OIG_ANNUAL_REVIEW_SUBMITTED
 */
export async function oigAuditingMonitoringRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff = new Date(Date.now() - YEAR_MS);
  const count = await tx.eventLog.count({
    where: {
      practiceId,
      type: "OIG_ANNUAL_REVIEW_SUBMITTED",
      createdAt: { gte: cutoff },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── OIG Element 6 ─ Enforcement through disciplinary standards ──────────────

/**
 * 65 FR 59434 Element 6 — Enforcement of standards through disciplinary guidelines.
 * Phase 1: derives from discipline policy adoption alone (partial credit).
 * COMPLIANT if OIG_DISCIPLINE_POLICY is currently adopted.
 * Evidence code: POLICY:OIG_DISCIPLINE_POLICY
 *
 * TODO(Phase 11): Extend to also verify LeieScreening cadence is maintained.
 * Full rule will be: discipline policy adopted AND LeieScreening checks
 * completed at required frequency (excluded individuals cannot be employed).
 */
export async function oigEnforcementDisciplineRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: { practiceId, policyCode: "OIG_DISCIPLINE_POLICY", retiredAt: null },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── OIG Element 7 ─ Response to violations and corrective action ─────────────

/**
 * 65 FR 59434 Element 7 — Prompt response to detected violations.
 * COMPLIANT if at least one OIG_CORRECTIVE_ACTION_RESOLVED EventLog row exists
 * for this practice (any resolved corrective action demonstrates an active
 * response program is in place).
 * Evidence code: EVENT:OIG_CORRECTIVE_ACTION_RESOLVED
 * Note: OigCorrectiveAction model deferred to Phase 9 (OQ-1). The EventLog
 * row IS the evidence for now.
 */
export async function oigResponseViolationsRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.eventLog.count({
    where: {
      practiceId,
      type: "OIG_CORRECTIVE_ACTION_RESOLVED",
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── Rule registry ────────────────────────────────────────────────────────────

export const OIG_DERIVATION_RULES: Record<string, DerivationRule> = {
  // Element 1: written policies (≥2 of 3 OIG policy codes adopted).
  OIG_WRITTEN_POLICIES: oigWrittenPoliciesRule,
  // Element 2: compliance officer designated.
  OIG_COMPLIANCE_OFFICER: oigComplianceOfficerRule,
  // Element 3: ≥95% workforce OIG compliance training (returns null until course seeded).
  OIG_TRAINING_EDUCATION: oigTrainingEducationRule,
  // Element 4: anonymous reporting policy adopted.
  OIG_COMMUNICATION_LINES: oigCommunicationLinesRule,
  // Element 5: annual review submitted in last 12 months.
  OIG_AUDITING_MONITORING: oigAuditingMonitoringRule,
  // Element 6: discipline policy adopted (Phase 11 extends with LeieScreening).
  OIG_ENFORCEMENT_DISCIPLINE: oigEnforcementDisciplineRule,
  // Element 7: corrective action resolved (event-only, no model row).
  OIG_RESPONSE_VIOLATIONS: oigResponseViolationsRule,
};
