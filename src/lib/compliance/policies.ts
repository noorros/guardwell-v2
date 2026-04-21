// src/lib/compliance/policies.ts
//
// Canonical list of HIPAA policies the platform knows about. Used by:
//   - scripts/seed-hipaa.ts to populate acceptedEvidenceTypes
//   - src/lib/compliance/derivation/hipaa.ts to implement derivation
//   - src/app/(dashboard)/programs/policies/* for UI
//
// Adding a new policy is a single edit here plus a derivation rule if the
// policy satisfies a requirement. Policy codes are namespaced as evidence
// via the "POLICY:" prefix so the rederive helper can match them.

export const HIPAA_POLICY_CODES = [
  "HIPAA_PRIVACY_POLICY",
  "HIPAA_SECURITY_POLICY",
  "HIPAA_BREACH_RESPONSE_POLICY",
  "HIPAA_MINIMUM_NECESSARY_POLICY",
  "HIPAA_NPP_POLICY",
  "HIPAA_WORKSTATION_POLICY",
] as const;

export type HipaaPolicyCode = (typeof HIPAA_POLICY_CODES)[number];

export interface PolicyMetadata {
  code: HipaaPolicyCode;
  title: string;
  description: string;
}

export const HIPAA_POLICY_METADATA: Record<HipaaPolicyCode, PolicyMetadata> = {
  HIPAA_PRIVACY_POLICY: {
    code: "HIPAA_PRIVACY_POLICY",
    title: "HIPAA Privacy Policy",
    description: "Governs how the practice uses and discloses PHI. Part of the core P&P set.",
  },
  HIPAA_SECURITY_POLICY: {
    code: "HIPAA_SECURITY_POLICY",
    title: "HIPAA Security Policy",
    description: "Administrative, physical, and technical safeguards for ePHI. Part of the core P&P set.",
  },
  HIPAA_BREACH_RESPONSE_POLICY: {
    code: "HIPAA_BREACH_RESPONSE_POLICY",
    title: "Breach Response Policy",
    description: "Procedure for investigating, assessing, and notifying affected individuals. Satisfies HIPAA_BREACH_RESPONSE.",
  },
  HIPAA_MINIMUM_NECESSARY_POLICY: {
    code: "HIPAA_MINIMUM_NECESSARY_POLICY",
    title: "Minimum-Necessary Policy",
    description: "Limits PHI use, disclosure, and requests to the minimum necessary.",
  },
  HIPAA_NPP_POLICY: {
    code: "HIPAA_NPP_POLICY",
    title: "Notice of Privacy Practices",
    description: "Patient-facing NPP describing how PHI is used and patient rights.",
  },
  HIPAA_WORKSTATION_POLICY: {
    code: "HIPAA_WORKSTATION_POLICY",
    title: "Workstation Use & Security Policy",
    description: "Rules for workstation use and physical safeguards for endpoints accessing ePHI.",
  },
};

/** All requirements in HIPAA_POLICIES_PROCEDURES — the core P&P set. */
export const HIPAA_PP_POLICY_SET: readonly HipaaPolicyCode[] = [
  "HIPAA_PRIVACY_POLICY",
  "HIPAA_SECURITY_POLICY",
  "HIPAA_BREACH_RESPONSE_POLICY",
];

export const evidenceCodeForPolicy = (code: HipaaPolicyCode) => `POLICY:${code}` as const;
