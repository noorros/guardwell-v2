// src/lib/compliance/policies.ts
//
// Canonical list of policies the platform knows about — across all
// regulatory frameworks. Used by:
//   - scripts/seed-<framework>.ts to populate acceptedEvidenceTypes
//   - src/lib/compliance/derivation/<framework>.ts to implement derivation
//   - src/app/(dashboard)/programs/policies/* for UI
//
// Adding a new policy is a single edit here plus a derivation rule in
// the relevant framework file. Policy codes are namespaced as evidence
// via the "POLICY:" prefix so the rederive helper can match them.

// ────────────────────────────────────────────────────────────────────────────
// HIPAA
// ────────────────────────────────────────────────────────────────────────────

export const HIPAA_POLICY_CODES = [
  "HIPAA_PRIVACY_POLICY",
  "HIPAA_SECURITY_POLICY",
  "HIPAA_BREACH_RESPONSE_POLICY",
  "HIPAA_MINIMUM_NECESSARY_POLICY",
  "HIPAA_NPP_POLICY",
  "HIPAA_WORKSTATION_POLICY",
] as const;

export type HipaaPolicyCode = (typeof HIPAA_POLICY_CODES)[number];

// ────────────────────────────────────────────────────────────────────────────
// OSHA
// ────────────────────────────────────────────────────────────────────────────

export const OSHA_POLICY_CODES = [
  "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
  "OSHA_HAZCOM_PROGRAM",
  "OSHA_EMERGENCY_ACTION_PLAN",
] as const;

export type OshaPolicyCode = (typeof OSHA_POLICY_CODES)[number];

// ────────────────────────────────────────────────────────────────────────────
// DEA
// ────────────────────────────────────────────────────────────────────────────

export const DEA_POLICY_CODES = [
  "DEA_SECURE_STORAGE_POLICY",
  "DEA_PRESCRIPTION_SECURITY_POLICY",
  "DEA_LOSS_REPORTING_POLICY",
] as const;

export type DeaPolicyCode = (typeof DEA_POLICY_CODES)[number];

// ────────────────────────────────────────────────────────────────────────────
// Union + metadata
// ────────────────────────────────────────────────────────────────────────────

export type PolicyCode = HipaaPolicyCode | OshaPolicyCode | DeaPolicyCode;

export type PolicyFramework = "HIPAA" | "OSHA" | "DEA";

export interface PolicyMetadata {
  code: PolicyCode;
  framework: PolicyFramework;
  title: string;
  description: string;
}

export const POLICY_METADATA: Record<PolicyCode, PolicyMetadata> = {
  // HIPAA
  HIPAA_PRIVACY_POLICY: {
    code: "HIPAA_PRIVACY_POLICY",
    framework: "HIPAA",
    title: "HIPAA Privacy Policy",
    description:
      "Governs how the practice uses and discloses PHI. Part of the core P&P set.",
  },
  HIPAA_SECURITY_POLICY: {
    code: "HIPAA_SECURITY_POLICY",
    framework: "HIPAA",
    title: "HIPAA Security Policy",
    description:
      "Administrative, physical, and technical safeguards for ePHI. Part of the core P&P set.",
  },
  HIPAA_BREACH_RESPONSE_POLICY: {
    code: "HIPAA_BREACH_RESPONSE_POLICY",
    framework: "HIPAA",
    title: "Breach Response Policy",
    description:
      "Procedure for investigating, assessing, and notifying affected individuals. Satisfies HIPAA_BREACH_RESPONSE.",
  },
  HIPAA_MINIMUM_NECESSARY_POLICY: {
    code: "HIPAA_MINIMUM_NECESSARY_POLICY",
    framework: "HIPAA",
    title: "Minimum-Necessary Policy",
    description:
      "Limits PHI use, disclosure, and requests to the minimum necessary.",
  },
  HIPAA_NPP_POLICY: {
    code: "HIPAA_NPP_POLICY",
    framework: "HIPAA",
    title: "Notice of Privacy Practices",
    description:
      "Patient-facing NPP describing how PHI is used and patient rights.",
  },
  HIPAA_WORKSTATION_POLICY: {
    code: "HIPAA_WORKSTATION_POLICY",
    framework: "HIPAA",
    title: "Workstation Use & Security Policy",
    description:
      "Rules for workstation use and physical safeguards for endpoints accessing ePHI.",
  },
  // OSHA
  OSHA_BBP_EXPOSURE_CONTROL_PLAN: {
    code: "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
    framework: "OSHA",
    title: "Bloodborne Pathogens Exposure Control Plan",
    description:
      "Written plan identifying job classifications with exposure risk, methods of compliance, HBV vaccination, post-exposure evaluation. Reviewed annually. Satisfies OSHA §1910.1030(c).",
  },
  OSHA_HAZCOM_PROGRAM: {
    code: "OSHA_HAZCOM_PROGRAM",
    framework: "OSHA",
    title: "Hazard Communication Program",
    description:
      "Written program covering SDS access, chemical labeling, inventory maintenance, and workforce HazCom training. Satisfies OSHA §1910.1200.",
  },
  OSHA_EMERGENCY_ACTION_PLAN: {
    code: "OSHA_EMERGENCY_ACTION_PLAN",
    framework: "OSHA",
    title: "Emergency Action Plan",
    description:
      "Written EAP covering evacuation, exit routes, fire prevention, reporting emergencies, and employee training. Satisfies OSHA §1910.38.",
  },
  // DEA
  DEA_SECURE_STORAGE_POLICY: {
    code: "DEA_SECURE_STORAGE_POLICY",
    framework: "DEA",
    title: "Controlled Substance Secure Storage Policy",
    description:
      "Written policy establishing locked, substantially constructed storage (safe or cabinet) for all Schedule II–V controlled substances per 21 CFR §1301.75. Satisfies DEA_STORAGE.",
  },
  DEA_PRESCRIPTION_SECURITY_POLICY: {
    code: "DEA_PRESCRIPTION_SECURITY_POLICY",
    framework: "DEA",
    title: "Prescription Security Policy",
    description:
      "Written policy covering tamper-resistant prescription pads and/or EPCS (Electronic Prescribing for Controlled Substances) with two-factor auth and audit trail per 21 CFR §1311. Satisfies the policy component of DEA_PRESCRIPTION_SECURITY.",
  },
  DEA_LOSS_REPORTING_POLICY: {
    code: "DEA_LOSS_REPORTING_POLICY",
    framework: "DEA",
    title: "Controlled Substance Theft/Loss Reporting Policy",
    description:
      "Written policy requiring DEA Form 106 filing within one business day of discovering a theft or significant loss, plus law enforcement notification. Satisfies the policy component of DEA_LOSS_REPORTING per 21 CFR §1301.76(b).",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Framework-specific helpers
// ────────────────────────────────────────────────────────────────────────────

/** All requirements in HIPAA_POLICIES_PROCEDURES — the core P&P set. */
export const HIPAA_PP_POLICY_SET: readonly HipaaPolicyCode[] = [
  "HIPAA_PRIVACY_POLICY",
  "HIPAA_SECURITY_POLICY",
  "HIPAA_BREACH_RESPONSE_POLICY",
];

export const evidenceCodeForPolicy = (code: PolicyCode) =>
  `POLICY:${code}` as const;

/** All policy codes across every framework, in display order. */
export const ALL_POLICY_CODES: readonly PolicyCode[] = [
  ...HIPAA_POLICY_CODES,
  ...OSHA_POLICY_CODES,
  ...DEA_POLICY_CODES,
];
