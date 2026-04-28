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
import { credentialTypePresentRule } from "./shared";

// 60-day overpayment refund window (42 USC §1320a-7k(d)).
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

// ─── CMS_EMERGENCY_PREPAREDNESS ───────────────────────────────────────────
// 42 CFR §482.15 / §485.68 — written emergency preparedness plan.
// COMPLIANT when CMS_EMERGENCY_PREPAREDNESS_POLICY is adopted (retiredAt null).
// Evidence code: "POLICY:CMS_EMERGENCY_PREPAREDNESS_POLICY".

async function cmsEmergencyPreparednessRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "CMS_EMERGENCY_PREPAREDNESS_POLICY",
      retiredAt: null,
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── CMS_STARK_AKS_COMPLIANCE ─────────────────────────────────────────────
// 42 USC §1395nn / §1320a-7b — Stark Law + Anti-Kickback Statute.
// COMPLIANT when CMS_STARK_AKS_COMPLIANCE_POLICY is adopted (retiredAt null).
// Evidence code: "POLICY:CMS_STARK_AKS_COMPLIANCE_POLICY".

async function cmsStarkAksComplianceRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "CMS_STARK_AKS_COMPLIANCE_POLICY",
      retiredAt: null,
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── CMS_BILLING_COMPLIANCE (stub → policy-driven) ────────────────────────
// 42 USC §1320a-7a — billing accuracy + documentation sufficiency.
// Cross-reference with OIG annual review deferred to a later phase; for
// now this is policy-driven (same pattern as OSHA/DEA policy rules).
// COMPLIANT when CMS_BILLING_COMPLIANCE_POLICY is adopted (retiredAt null).
// Evidence code: "POLICY:CMS_BILLING_COMPLIANCE_POLICY".

async function cmsBillingComplianceRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "CMS_BILLING_COMPLIANCE_POLICY",
      retiredAt: null,
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── CMS_OVERPAYMENT_REFUND ───────────────────────────────────────────────
// 42 USC §1320a-7k(d) — 60-day overpayment refund.
// Logic:
//   1. Find all OVERPAYMENT_REPORTED EventLog rows where identifiedAt is
//      within the last 60 days ("recent" = still within the refund window).
//   2. If none → COMPLIANT (no active overpayments to refund).
//   3. For any recent overpayment: if reportedAt is within 60 days of
//      identifiedAt → on-time. If reportedAt > identifiedAt + 60 days → overdue.
//   COMPLIANT if all recent overpayments are on-time; GAP if any are overdue.
// Evidence code: "OVERPAYMENT:REPORTED".

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
  CMS_EMERGENCY_PREPAREDNESS: cmsEmergencyPreparednessRule,
  // 42 USC §1395nn / §1320a-7b — Stark Law + AKS compliance (policy-driven).
  CMS_STARK_AKS_COMPLIANCE: cmsStarkAksComplianceRule,
  // 42 USC §1320a-7a — Billing compliance (policy-driven stub).
  CMS_BILLING_COMPLIANCE: cmsBillingComplianceRule,
  // 42 USC §1320a-7k(d) — 60-day overpayment refund (event-driven).
  CMS_OVERPAYMENT_REFUND: cmsOverpaymentRefundRule,
};
