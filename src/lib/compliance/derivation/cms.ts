// src/lib/compliance/derivation/cms.ts
//
// CMS (Medicare/Medicaid) derivation rules.
//
// PR 4 adds 3 new rules + 1 policy-driven stub for CMS_BILLING_COMPLIANCE:
//   CMS_EMERGENCY_PREPAREDNESS   — policy-driven
//   CMS_STARK_AKS_COMPLIANCE     — policy-driven
//   CMS_BILLING_COMPLIANCE       — policy-driven stub (cross-reference with OIG deferred)
//   CMS_OVERPAYMENT_REFUND       — event-driven (queries EventLog directly)
//
// Pre-existing credential-backed rules (3/7) are unchanged:
//   CMS_PECOS_ENROLLMENT
//   CMS_NPI_REGISTRATION
//   CMS_MEDICARE_PROVIDER_ENROLLMENT

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";
import type { CmsPolicyCode } from "@/lib/compliance/policies";
import { credentialTypePresentRule } from "./shared";

// 60-day overpayment refund window (42 USC §1320a-7k(d)).
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

// ─── Policy-driven rules (factory) ───────────────────────────────────────
// Mirrors oshaPolicyRule(code) in osha.ts. All three CMS policy rules are
// structurally identical — the factory removes the duplication.

/**
 * Generic: is the given CMS policy code currently adopted (not retired)?
 */
function cmsPolicyRule(required: CmsPolicyCode): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const count = await tx.practicePolicy.count({
      where: { practiceId, policyCode: required, retiredAt: null },
    });
    return count > 0 ? "COMPLIANT" : "GAP";
  };
}

// ─── CMS_OVERPAYMENT_REFUND ───────────────────────────────────────────────

/**
 * 42 USC §1320a-7k(d) — 60-day overpayment refund.
 * Logic:
 *   1. Find all OVERPAYMENT_REPORTED EventLog rows where identifiedAt is
 *      within the last 60 days ("recent" = still within the refund window).
 *   2. If none → COMPLIANT (no active overpayments to refund).
 *   3. For any recent overpayment: if reportedAt is within 60 days of
 *      identifiedAt → on-time. If reportedAt > identifiedAt + 60 days → overdue.
 *   COMPLIANT if all recent overpayments are on-time; GAP if any are overdue.
 * Evidence code: "EVENT:OVERPAYMENT_REPORTED".
 *
 * LIMITATION: this rule cannot detect overpayments identified but never
 * emitted as OVERPAYMENT_REPORTED events. The practice's UI is responsible
 * for prompting users to log; if they don't, the rule reports vacuous
 * COMPLIANT and the manual radio override is the auditor's escape hatch.
 * A future phase may add an `Overpayment` model row + a "stale identification"
 * detector to close this gap.
 */
async function cmsOverpaymentRefundRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff60 = new Date(Date.now() - SIXTY_DAYS_MS);

  // Fetch all OVERPAYMENT_REPORTED events where identifiedAt is within 60 days.
  const events = await tx.eventLog.findMany({
    where: {
      practiceId,
      type: "OVERPAYMENT_REPORTED",
    },
    orderBy: { createdAt: "desc" },
  });

  // Filter to events where identifiedAt is within the last 60 days.
  // Parse payload JSON (stored as Prisma.JsonValue).
  type OPPayload = {
    identifiedAt: string;
    reportedAt: string;
  };

  const recentEvents = events.filter((e) => {
    const payload = e.payload as OPPayload | null;
    if (!payload?.identifiedAt) return false;
    const identifiedAt = new Date(payload.identifiedAt);
    return identifiedAt >= cutoff60;
  });

  // No recent overpayments → vacuously COMPLIANT.
  if (recentEvents.length === 0) return "COMPLIANT";

  // All recent overpayments must be reported within 60 days of identification.
  for (const e of recentEvents) {
    const payload = e.payload as OPPayload;
    const identifiedAt = new Date(payload.identifiedAt);
    const reportedAt = new Date(payload.reportedAt);
    const daysToReport = reportedAt.getTime() - identifiedAt.getTime();
    if (daysToReport > SIXTY_DAYS_MS) {
      // Overpayment reported more than 60 days after identification → GAP.
      return "GAP";
    }
  }

  return "COMPLIANT";
}

// ─── Rule registry ────────────────────────────────────────────────────────

export const CMS_DERIVATION_RULES: Record<string, DerivationRule> = {
  // §424.500-545 — PECOS enrollment (credential-backed).
  CMS_PECOS_ENROLLMENT: credentialTypePresentRule("MEDICARE_PECOS_ENROLLMENT"),
  // §162.406 — National Provider Identifier (credential-backed).
  CMS_NPI_REGISTRATION: credentialTypePresentRule("NPI_REGISTRATION"),
  // §424.510 — Active Medicare billing privileges (credential-backed).
  CMS_MEDICARE_PROVIDER_ENROLLMENT: credentialTypePresentRule(
    "MEDICARE_PROVIDER_ENROLLMENT",
  ),
  // §482.15 / §485.68 — Emergency preparedness plan (policy-driven).
  CMS_EMERGENCY_PREPAREDNESS: cmsPolicyRule("CMS_EMERGENCY_PREPAREDNESS_POLICY"),
  // 42 USC §1395nn / §1320a-7b — Stark Law + AKS compliance (policy-driven).
  CMS_STARK_AKS_COMPLIANCE: cmsPolicyRule("CMS_STARK_AKS_COMPLIANCE_POLICY"),
  // 42 USC §1320a-7a — Billing compliance (policy-driven stub).
  // TODO(phase-11): Add OIG cross-reference — AND no LeieScreening hits in
  // the last 90 days. Currently policy-driven only.
  CMS_BILLING_COMPLIANCE: cmsPolicyRule("CMS_BILLING_COMPLIANCE_POLICY"),
  // 42 USC §1320a-7k(d) — 60-day overpayment refund (event-driven).
  CMS_OVERPAYMENT_REFUND: cmsOverpaymentRefundRule,
};
