// src/lib/regulations/citations.ts
//
// Audit #11: single source of truth for regulatory citations rendered in
// user-facing UI. When OSHA / USP / HIPAA / DEA revise (USP 797 last
// revised 2023; the 2024 HIPAA NPRM is in flight), every citation here
// is one edit instead of grep-and-replace across N pages.
//
// Each entry exports both the bare paragraph reference (`code`) and the
// human-readable display string (`display`) — the bare code stays
// citation-only for tight contexts (table cells, badges), the display
// includes the framework name for descriptions and tooltips.
//
// Comments + JSDoc + commit messages can keep the literal citation;
// only user-rendered strings should pull from this registry.

export interface Citation {
  /** Bare paragraph reference, e.g. "§164.402". */
  code: string;
  /** Display string with framework name, e.g. "HIPAA §164.402". */
  display: string;
  /** Plain-English title for tooltips / aria-describedby. */
  title: string;
}

function citation(code: string, framework: string, title: string): Citation {
  return { code, display: `${framework} ${code}`, title };
}

export const CITATIONS = {
  // ── HIPAA Privacy + Breach ────────────────────────────────────────
  HIPAA_BREACH_DEFINITION: citation(
    "§164.402",
    "HIPAA",
    "Definition of breach + four-factor risk-of-compromise analysis",
  ),
  HIPAA_BREACH_DISCOVERY_CLOCK: citation(
    "§164.408(b)",
    "HIPAA",
    "60-day breach discovery + HHS notification window",
  ),
  HIPAA_PRIVACY_OFFICER: citation(
    "§164.530(a)(1)(i)",
    "HIPAA",
    "Privacy Officer designation",
  ),
  HIPAA_WORKFORCE_ACK: citation(
    "§164.530(b)(1)",
    "HIPAA",
    "Workforce training + policy acknowledgment",
  ),
  HIPAA_WORKFORCE_ACK_PER_MEMBER: citation(
    "§164.530(b)(2)",
    "HIPAA",
    "Per-workforce-member attestation",
  ),
  HIPAA_DOC_RETENTION: citation(
    "§164.530(j)",
    "HIPAA",
    "6-year documentation retention",
  ),
  HIPAA_POLICY_REVIEW: citation(
    "§164.316(b)(2)(iii)",
    "HIPAA",
    "Policy review clock",
  ),
  HIPAA_BAA: citation(
    "§164.504(e)",
    "HIPAA",
    "Business Associate Agreements",
  ),
  HIPAA_BA_CONTRACTS: citation(
    "§164.502(e)",
    "HIPAA",
    "Business Associate contracts evidence",
  ),
  HIPAA_ANNUAL_POLICY_REVIEW: citation(
    "§164.530(i)(2)",
    "HIPAA",
    "Annual policy review",
  ),

  // ── HIPAA Security Rule ───────────────────────────────────────────
  HIPAA_SRA: citation(
    "§164.308(a)(1)(ii)(A)",
    "HIPAA",
    "Security Risk Assessment requirement",
  ),
  HIPAA_SECURITY_OFFICER: citation(
    "§164.308(a)(2)",
    "HIPAA",
    "Security Officer designation",
  ),
  HIPAA_ADMIN_SAFEGUARDS: citation(
    "§164.308",
    "HIPAA",
    "Administrative safeguards",
  ),
  HIPAA_PHYSICAL_SAFEGUARDS: citation(
    "§164.310",
    "HIPAA",
    "Physical safeguards",
  ),
  HIPAA_TECHNICAL_SAFEGUARDS: citation(
    "§164.312",
    "HIPAA",
    "Technical safeguards",
  ),

  // ── OSHA ──────────────────────────────────────────────────────────
  OSHA_RECORDKEEPING: citation(
    "29 CFR §1904",
    "OSHA",
    "Injury + illness recordkeeping",
  ),
  OSHA_FATALITY_REPORTING: citation(
    "§1904.39",
    "OSHA",
    "8-hour fatality / 24-hour hospitalization reporting",
  ),
  OSHA_BLOODBORNE_PATHOGENS: citation(
    "§1910.1030",
    "OSHA",
    "Bloodborne Pathogens standard (sharps injury log)",
  ),

  // ── DEA ───────────────────────────────────────────────────────────
  DEA_REGISTRATION: citation(
    "21 CFR Parts 1304 + 1311",
    "DEA",
    "Registrant recordkeeping",
  ),
  DEA_FORM_106_REQUIREMENT: citation(
    "21 CFR §1301.74(c)",
    "DEA",
    "Theft / significant loss reporting",
  ),

  // ── USP 797 §21 (Allergy compounding) ─────────────────────────────
  USP_797_21: citation(
    "USP 797 §21",
    "USP",
    "Allergen extract compounding carve-out",
  ),
} as const satisfies Record<string, Citation>;

export type CitationKey = keyof typeof CITATIONS;
