// src/lib/compliance/derivation/tcpa.ts
//
// TCPA (Telephone Consumer Protection Act) derivation rules. Three
// policy-driven rules + four manual-only stubs.
//
// PR 6 wires:
//   TCPA_WRITTEN_CONSENT_POLICY   TCPA_CONSENT_POLICY adopted
//   TCPA_OPT_OUT_MECHANISM        TCPA_OPT_OUT_POLICY adopted
//   TCPA_DNC_COMPLIANCE           TCPA_DNC_COMPLIANCE_POLICY adopted
//   TCPA_MARKETING_CONSENT        STUB (Phase 9 — PatientConsentRecord)
//   TCPA_INFORMATIONAL_CONSENT    STUB (Phase 9 — PatientConsentRecord)
//   TCPA_CONSENT_RECORDS          STUB (Phase 9 — PatientConsentRecord)
//   TCPA_CALLING_HOURS            STUB (Phase 9 — outbound dialer integration)
//
// Per the policy-driven factory pattern established in osha.ts /
// cms.ts / oig.ts: a single function builds the rule from the policy code.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";
import type { TcpaPolicyCode } from "@/lib/compliance/policies";

// ─── Factory for single-policy TCPA rules ──────────────────────────────────

/**
 * Generic: is the given TCPA policy code currently adopted (not retired)?
 * Mirrors oshaPolicyRule / cmsPolicyRule / oigPolicyRule.
 */
function tcpaPolicyRule(required: TcpaPolicyCode): DerivationRule {
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

// ─── Manual-only stubs ────────────────────────────────────────────────────
// Four TCPA requirements derive from operational surfaces that are
// deferred to Phase 9: PatientConsentRecord (marketing + informational
// consent + 5-year retention), DncEntry queue (opt-outs), and outbound
// dialer time-zone enforcement (calling hours). Returning null tells
// rederive to skip — the requirements stay at the user-set status.

async function tcpaMarketingConsentStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9): wire to PatientConsentRecord (consentType=MARKETING).
}

async function tcpaInformationalConsentStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9): wire to PatientConsentRecord (consentType=INFORMATIONAL).
}

async function tcpaConsentRecordsStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9): wire to PatientConsentRecord retention check (5 years).
}

async function tcpaCallingHoursStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9): wire to outbound dialer time-zone enforcement attestation.
}

// ─── Rule registry ────────────────────────────────────────────────────────

export const TCPA_DERIVATION_RULES: Record<string, DerivationRule> = {
  // 47 USC §227 / 47 CFR §64.1200 — Written consent policy adopted.
  TCPA_WRITTEN_CONSENT_POLICY: tcpaPolicyRule("TCPA_CONSENT_POLICY"),
  // 47 CFR §64.1200(a)(2) — Marketing consent (Phase 9 stub).
  TCPA_MARKETING_CONSENT: tcpaMarketingConsentStub,
  // 47 CFR §64.1200(a)(1) — Informational consent (Phase 9 stub).
  TCPA_INFORMATIONAL_CONSENT: tcpaInformationalConsentStub,
  // 47 CFR §64.1200(a)(10) — Opt-out mechanism (policy-driven).
  TCPA_OPT_OUT_MECHANISM: tcpaPolicyRule("TCPA_OPT_OUT_POLICY"),
  // 47 CFR §64.1200(c) — DNC Registry compliance (policy-driven).
  TCPA_DNC_COMPLIANCE: tcpaPolicyRule("TCPA_DNC_COMPLIANCE_POLICY"),
  // 47 CFR §64.1200(a)(2) — Consent record retention (Phase 9 stub).
  TCPA_CONSENT_RECORDS: tcpaConsentRecordsStub,
  // 47 CFR §64.1200(c)(1) — Calling hours 8am-9pm local (Phase 9 stub).
  TCPA_CALLING_HOURS: tcpaCallingHoursStub,
};
