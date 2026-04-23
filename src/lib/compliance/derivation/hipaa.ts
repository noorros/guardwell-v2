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
 * HIPAA §164.530(d). Composite rule: the breach-response policy must be
 * adopted AND every breach incident (isBreach=true) must be resolved.
 * Any unresolved breach drops the requirement to GAP regardless of
 * policy state — you can't claim a working breach-response program while
 * a breach is mid-flight.
 */
export async function hipaaBreachResponseRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const policyAdopted = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "HIPAA_BREACH_RESPONSE_POLICY",
      retiredAt: null,
    },
  });
  if (policyAdopted === 0) return "GAP";

  const unresolvedBreaches = await tx.incident.count({
    where: { practiceId, isBreach: true, resolvedAt: null },
  });
  if (unresolvedBreaches > 0) return "GAP";

  return "COMPLIANT";
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

/**
 * Generic state breach-notification rule factory. Used for every state
 * overlay where the obligation is "notify affected individuals within
 * X days of discovery for any breach scoped to that state."
 *
 * Derivation logic:
 *   - No state-scoped breaches yet → COMPLIANT (vacuously satisfied).
 *   - Every state-scoped breach has affectedIndividualsNotifiedAt within
 *     the window → COMPLIANT.
 *   - Any state-scoped breach has no notification yet → GAP (drives
 *     action regardless of whether the window has elapsed).
 *   - Any state-scoped breach has notification recorded AFTER the
 *     window (when windowDays is non-null) → GAP.
 *
 * "State-scoped breach" = isBreach=true AND (patientState=stateCode OR
 * patientState=null AND practice.primaryState=stateCode).
 *
 * windowDays=null means "most expedient time possible" — courts read
 * this strictly but there's no fixed numeric deadline. We treat presence
 * of a notification as compliance and absence as a gap. The user
 * judges whether their notice was timely; we surface the obligation.
 *
 * useBusinessDays=true skips weekends when computing the deadline (CA's
 * 15-business-day rule). Federal holidays aren't tracked, so the
 * computation is a slight overestimate of the real deadline — conservative
 * for the practice in the borderline case.
 */
function stateBreachNotificationRule(
  stateCode: string,
  windowDays: number | null,
  useBusinessDays: boolean = false,
): DerivationRule {
  return async (tx, practiceId) => {
    const practice = await tx.practice.findUnique({
      where: { id: practiceId },
      select: { primaryState: true },
    });
    const stateBreaches = await tx.incident.findMany({
      where: {
        practiceId,
        isBreach: true,
        OR: [
          { patientState: stateCode },
          ...(practice?.primaryState === stateCode
            ? [{ patientState: null }]
            : []),
        ],
      },
      select: {
        discoveredAt: true,
        affectedIndividualsNotifiedAt: true,
      },
    });
    if (stateBreaches.length === 0) return "COMPLIANT";

    for (const b of stateBreaches) {
      if (!b.affectedIndividualsNotifiedAt) return "GAP";
      if (windowDays !== null) {
        const deadline = useBusinessDays
          ? addBusinessDays(b.discoveredAt, windowDays)
          : addCalendarDays(b.discoveredAt, windowDays);
        if (b.affectedIndividualsNotifiedAt > deadline) return "GAP";
      }
    }
    return "COMPLIANT";
  };
}

/**
 * California overlay (Cal. Civil Code §56.36 · Health & Safety Code §1280.15).
 * Backwards-compatible alias kept as an exported name so the original
 * tests + any external callers continue to work.
 */
export const hipaaCaBreachNotification15BizDaysRule: DerivationRule =
  stateBreachNotificationRule("CA", 15, true);

/** Pure helper. Adds n calendar days to `from`. */
function addCalendarDays(from: Date, n: number): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + n);
  return result;
}

/**
 * Pure helper. Returns the date that is `n` business days after `from`
 * (skipping weekends only — federal holiday calendar isn't tracked yet,
 * so the result is a slight overestimate of the actual statutory deadline.
 * Conservative for the practice: a true holiday-aware computation would
 * push the deadline LATER, never sooner).
 */
function addBusinessDays(from: Date, n: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) added += 1;
  }
  return result;
}

import { hipaaSraRule } from "./hipaaSra";

export const HIPAA_DERIVATION_RULES: Record<string, DerivationRule> = {
  HIPAA_PRIVACY_OFFICER: hipaaPrivacyOfficerRule,
  HIPAA_SECURITY_OFFICER: hipaaSecurityOfficerRule,
  HIPAA_POLICIES_PROCEDURES: hipaaPoliciesProceduresRule,
  HIPAA_MINIMUM_NECESSARY: singlePolicyRule("HIPAA_MINIMUM_NECESSARY_POLICY"),
  HIPAA_NPP: singlePolicyRule("HIPAA_NPP_POLICY"),
  HIPAA_BREACH_RESPONSE: hipaaBreachResponseRule,
  HIPAA_WORKSTATION_USE: singlePolicyRule("HIPAA_WORKSTATION_POLICY"),
  HIPAA_WORKFORCE_TRAINING: hipaaWorkforceTrainingRule,
  HIPAA_BAAS: hipaaBaaRule,
  HIPAA_SRA: hipaaSraRule,
  // State breach-notification overlays. Each rule shares the same shape:
  // any state-scoped breach must have affected-individual notice recorded
  // within the statutory window. See stateBreachNotificationRule for the
  // GAP/COMPLIANT decision logic and "state-scoped" definition.
  // Fixed-window states:
  HIPAA_CA_BREACH_NOTIFICATION_72HR: hipaaCaBreachNotification15BizDaysRule,
  HIPAA_TX_BREACH_60DAY: stateBreachNotificationRule("TX", 60),
  HIPAA_FL_FIPA_30DAY: stateBreachNotificationRule("FL", 30),
  HIPAA_WA_BREACH_30DAY: stateBreachNotificationRule("WA", 30),
  HIPAA_CO_BREACH_30DAY: stateBreachNotificationRule("CO", 30),
  HIPAA_OR_BREACH_45DAY: stateBreachNotificationRule("OR", 45),
  HIPAA_OH_BREACH_45DAY: stateBreachNotificationRule("OH", 45),
  HIPAA_MD_PIPA_45DAY: stateBreachNotificationRule("MD", 45),
  // "Most expedient time possible" states — no fixed numeric deadline.
  // Presence of a notification = COMPLIANT; absence = GAP.
  HIPAA_NY_BREACH_EXPEDIENT: stateBreachNotificationRule("NY", null),
  HIPAA_IL_PIPA_BREACH: stateBreachNotificationRule("IL", null),
  HIPAA_MA_BREACH_ASAP: stateBreachNotificationRule("MA", null),
  HIPAA_NJ_BREACH_EXPEDIENT: stateBreachNotificationRule("NJ", null),
  HIPAA_NV_BREACH_EXPEDIENT: stateBreachNotificationRule("NV", null),
  HIPAA_UT_BREACH_EXPEDIENT: stateBreachNotificationRule("UT", null),
  HIPAA_GA_BREACH_EXPEDIENT: stateBreachNotificationRule("GA", null),
  HIPAA_NC_BREACH_EXPEDIENT: stateBreachNotificationRule("NC", null),
  HIPAA_MI_BREACH_EXPEDIENT: stateBreachNotificationRule("MI", null),
  HIPAA_PA_BREACH_EXPEDIENT: stateBreachNotificationRule("PA", null),
  HIPAA_MN_BREACH_EXPEDIENT: stateBreachNotificationRule("MN", null),
};
