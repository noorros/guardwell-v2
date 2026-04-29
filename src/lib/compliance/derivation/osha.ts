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
  // §1904.7(b)(5) — first-aid-only injuries are NOT recordable on Form 300.
  // `{ not: "FIRST_AID" }` in Prisma also excludes NULL outcomes, which
  // matches the audit B-5 finding (incomplete rows should not pad the log).
  const count = await tx.incident.count({
    where: {
      practiceId,
      type: "OSHA_RECORDABLE",
      discoveredAt: { gt: cutoff },
      oshaOutcome: { not: "FIRST_AID" },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

/**
 * 29 CFR §1903.2 — Required workplace posters.
 * COMPLIANT when at least one POSTER_ATTESTATION EventLog row exists for
 * this practice with createdAt >= Jan 1 of the current calendar year.
 * Officers must re-attest each year to confirm posters are still displayed.
 */
export async function oshaRequiredPostersRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  // Cloud Run prod runs in UTC, so getFullYear() + new Date(year, 0, 1)
  // resolves to YYYY-01-01T00:00:00Z by design. Local-dev runs in the
  // developer's TZ — internally consistent with the year extraction, so
  // the cutoff still falls on local Jan 1, just translated to UTC at
  // query time. Acceptable drift; OSHA posting is calendar-year scoped.
  const jan1 = new Date(new Date().getFullYear(), 0, 1);
  const count = await tx.eventLog.count({
    where: {
      practiceId,
      type: "POSTER_ATTESTATION",
      createdAt: { gte: jan1 },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

/**
 * 29 CFR §1910.132 — Personal Protective Equipment program.
 * COMPLIANT when at least one PPE_ASSESSMENT_COMPLETED EventLog row exists
 * for this practice within the last 365 days.
 */
export async function oshaPpeRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff = new Date(Date.now() - YEAR_MS);
  const count = await tx.eventLog.count({
    where: {
      practiceId,
      type: "PPE_ASSESSMENT_COMPLETED",
      createdAt: { gte: cutoff },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

/**
 * OSH Act §5(a)(1) — General Duty Clause.
 * Composite rule: satisfied when (a) all three core hazard-control policies
 * are adopted (BBP ECP + HazCom + EAP) AND (b) at least one risk assessment
 * has been completed (completedAt IS NOT NULL, isDraft=false).
 *
 * Rationale: the General Duty Clause is satisfied by demonstrating that
 * recognized hazards were identified (SRA) and core control programs are
 * in place (the three policies). The SRA check reuses PracticeSraAssessment
 * directly — no new event type needed.
 */
export async function oshaGeneralDutyRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  // Step 1: all three core hazard-control policies must be adopted.
  const policiesOk =
    (await tx.practicePolicy.count({
      where: {
        practiceId,
        policyCode: { in: ["OSHA_BBP_EXPOSURE_CONTROL_PLAN", "OSHA_HAZCOM_PROGRAM", "OSHA_EMERGENCY_ACTION_PLAN"] },
        retiredAt: null,
      },
    })) === 3;

  if (!policiesOk) return "GAP";

  // Step 2: at least one completed risk assessment.
  const hasSra =
    (await tx.practiceSraAssessment.count({
      where: {
        practiceId,
        completedAt: { not: null },
        isDraft: false,
      },
    })) > 0;

  return hasSra ? "COMPLIANT" : "GAP";
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
  // §1903.2 — Required workplace posters (annual attestation).
  OSHA_REQUIRED_POSTERS: oshaRequiredPostersRule,
  // §1910.132 — PPE hazard assessment (within last 365 days).
  OSHA_PPE: oshaPpeRule,
  // OSH Act §5(a)(1) — General Duty Clause composite.
  OSHA_GENERAL_DUTY: oshaGeneralDutyRule,
};
