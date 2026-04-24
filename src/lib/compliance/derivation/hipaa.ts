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
import {
  courseCompletionThresholdRule,
  multipleCoursesCompletionThresholdRule,
} from "./shared";

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
 * HIPAA §164.530(i)(2) — periodic review of policies and procedures.
 * Annual review is the de-facto standard. Scoped to the 3 core HIPAA
 * P&P policies (HIPAA_PP_POLICY_SET): Privacy, Security, Breach Response.
 *
 * - 0 of those 3 adopted → null (rule doesn't apply yet — the parent
 *   HIPAA_POLICIES_PROCEDURES rule already covers "go adopt them"; we
 *   don't want to spawn a stale-review GAP row before there's anything
 *   to review)
 * - All adopted-and-not-retired HIPAA P&P policies have lastReviewedAt
 *   within 365 days → COMPLIANT
 * - Any one is past 365 days OR never reviewed → GAP
 *
 * Adopting a non-HIPAA policy (e.g. OSHA HAZCOM) is a no-op here — the
 * rule still sees 0 HIPAA P&P adopted and returns null.
 */
const REVIEW_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export async function hipaaPoliciesReviewCurrentRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const adopted = await tx.practicePolicy.findMany({
    where: {
      practiceId,
      retiredAt: null,
      policyCode: { in: [...HIPAA_PP_POLICY_SET] },
    },
    select: { lastReviewedAt: true },
  });
  if (adopted.length === 0) return null;
  const cutoff = new Date(Date.now() - REVIEW_WINDOW_MS);
  const allCurrent = adopted.every(
    (p) => p.lastReviewedAt !== null && p.lastReviewedAt >= cutoff,
  );
  return allCurrent ? "COMPLIANT" : "GAP";
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

/**
 * HIPAA §164.308(a)(5) — workforce trained on ALL four cybersecurity
 * topics. Wraps multipleCoursesCompletionThresholdRule with the canonical
 * cyber course set. Threshold is 80% (lower than HIPAA_BASICS' 95% — the
 * cyber catalog is broader and we want practices to make meaningful
 * progress, not be punished for one staff member behind on one course).
 */
export const hipaaCyberTrainingCompleteRule: DerivationRule =
  multipleCoursesCompletionThresholdRule(
    [
      "PHISHING_RECOGNITION_RESPONSE",
      "MFA_AUTHENTICATION_HYGIENE",
      "RANSOMWARE_DEFENSE_PLAYBOOK",
      "CYBERSECURITY_MEDICAL_OFFICES",
    ],
    0.8,
  );

/**
 * HIPAA §164.308(a)(5)(ii)(D) — MFA coverage. Counts active practice
 * users with mfaEnrolledAt set vs total active. ≥80% → COMPLIANT.
 *
 * Returns null when there are zero active users (vacuously true; no
 * one to enroll yet) so we don't flash a GAP on brand-new practices.
 */
const MFA_COVERAGE_THRESHOLD = 0.8;

export async function hipaaMfaCoverageRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const total = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  if (total === 0) return null;
  const enrolled = await tx.practiceUser.count({
    where: { practiceId, removedAt: null, mfaEnrolledAt: { not: null } },
  });
  return enrolled / total >= MFA_COVERAGE_THRESHOLD ? "COMPLIANT" : "GAP";
}

/**
 * HIPAA §164.308(a)(5)(ii)(B) — recent phishing simulation. ≥1 PhishingDrill
 * row with conductedAt within the last 6 months → COMPLIANT.
 *
 * Returns null when there are ZERO phishing drills ever logged, so the
 * requirement defaults to NOT_STARTED in the UI rather than GAP — gives
 * a new practice a beat to set up their drill cadence before the score
 * starts pushing back.
 */
const PHISHING_WINDOW_MS = 183 * 24 * 60 * 60 * 1000; // ~6 months

export async function hipaaPhishingDrillRecentRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const totalCount = await tx.phishingDrill.count({
    where: { practiceId },
  });
  if (totalCount === 0) return null;
  const cutoff = new Date(Date.now() - PHISHING_WINDOW_MS);
  const recentCount = await tx.phishingDrill.count({
    where: { practiceId, conductedAt: { gte: cutoff } },
  });
  return recentCount > 0 ? "COMPLIANT" : "GAP";
}

/**
 * HIPAA §164.308(a)(7) — backup verified within 90 days. ≥1
 * BackupVerification row with success=true and verifiedAt within window
 * → COMPLIANT.
 */
const BACKUP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function hipaaBackupVerifiedRecentRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const totalCount = await tx.backupVerification.count({
    where: { practiceId },
  });
  if (totalCount === 0) return null;
  const cutoff = new Date(Date.now() - BACKUP_WINDOW_MS);
  const recentCount = await tx.backupVerification.count({
    where: {
      practiceId,
      success: true,
      verifiedAt: { gte: cutoff },
    },
  });
  return recentCount > 0 ? "COMPLIANT" : "GAP";
}

/**
 * HIPAA documentation-retention practice (§164.530(j)). The practice must
 * retain required documentation (policies, authorizations, access
 * records) for ≥6 years and destroy securely when the retention period
 * expires. This rule operationalizes "you actually run a destruction
 * cadence" by requiring at least one DestructionLog entry within the
 * last 365 days.
 *
 * - 0 destruction-log entries ever → null (rule doesn't fire yet — new
 *   practices have nothing to destroy in their first year)
 * - At least one entry in the last 365 days → COMPLIANT
 * - Entries exist but none in the last 365 days → GAP (cadence lapsed)
 *
 * Practices with no PHI to destroy in a year can mark NOT_APPLICABLE
 * via the requirement checklist on /modules/hipaa.
 */
export async function hipaaDocumentationRetentionRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const totalCount = await tx.destructionLog.count({
    where: { practiceId },
  });
  if (totalCount === 0) return null;
  const cutoff = new Date(Date.now() - REVIEW_WINDOW_MS);
  const recentCount = await tx.destructionLog.count({
    where: { practiceId, destroyedAt: { gte: cutoff } },
  });
  return recentCount > 0 ? "COMPLIANT" : "GAP";
}

import { hipaaSraRule } from "./hipaaSra";

export const HIPAA_DERIVATION_RULES: Record<string, DerivationRule> = {
  HIPAA_PRIVACY_OFFICER: hipaaPrivacyOfficerRule,
  HIPAA_SECURITY_OFFICER: hipaaSecurityOfficerRule,
  HIPAA_POLICIES_PROCEDURES: hipaaPoliciesProceduresRule,
  HIPAA_POLICIES_REVIEW_CURRENT: hipaaPoliciesReviewCurrentRule,
  HIPAA_DOCUMENTATION_RETENTION: hipaaDocumentationRetentionRule,
  HIPAA_MINIMUM_NECESSARY: singlePolicyRule("HIPAA_MINIMUM_NECESSARY_POLICY"),
  HIPAA_NPP: singlePolicyRule("HIPAA_NPP_POLICY"),
  HIPAA_BREACH_RESPONSE: hipaaBreachResponseRule,
  HIPAA_WORKSTATION_USE: singlePolicyRule("HIPAA_WORKSTATION_POLICY"),
  HIPAA_WORKFORCE_TRAINING: hipaaWorkforceTrainingRule,
  HIPAA_BAAS: hipaaBaaRule,
  HIPAA_SRA: hipaaSraRule,
  // Cybersecurity emphasis (2026-04-23) — see comments on each rule.
  HIPAA_CYBER_TRAINING_COMPLETE: hipaaCyberTrainingCompleteRule,
  HIPAA_MFA_COVERAGE_GE_80: hipaaMfaCoverageRule,
  HIPAA_PHISHING_DRILL_RECENT: hipaaPhishingDrillRecentRule,
  HIPAA_BACKUP_VERIFIED_RECENT: hipaaBackupVerifiedRecentRule,
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
  // Batch 3 (2026-04-24) — additional state breach overlays
  HIPAA_AZ_BREACH_45DAY: stateBreachNotificationRule("AZ", 45),
  HIPAA_CT_BREACH_60DAY_AG: stateBreachNotificationRule("CT", 60),
  HIPAA_TN_BREACH_45DAY: stateBreachNotificationRule("TN", 45),
  HIPAA_IN_BREACH_EXPEDIENT: stateBreachNotificationRule("IN", null),
  HIPAA_WI_BREACH_45DAY: stateBreachNotificationRule("WI", 45),
  HIPAA_KY_BREACH_EXPEDIENT: stateBreachNotificationRule("KY", null),
  HIPAA_LA_BREACH_60DAY: stateBreachNotificationRule("LA", 60),
  HIPAA_IA_BREACH_EXPEDIENT: stateBreachNotificationRule("IA", null),
  HIPAA_MO_BREACH_EXPEDIENT: stateBreachNotificationRule("MO", null),
  HIPAA_AL_BREACH_45DAY: stateBreachNotificationRule("AL", 45),
};
