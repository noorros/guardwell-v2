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
  // Audit #21 HIPAA M-9 (2026-04-30): split federal HHS-notification
  // (§164.408) from federal patient-notification (§164.404) so each
  // citation reads cleanly when surfaced standalone (e.g., on the breach
  // memo PDF or in Concierge answers). The two clocks are *both* 60-day
  // for major breaches but live in separate paragraphs of Subpart D —
  // §164.408 governs notification to the Secretary (HHS), §164.404
  // governs notification to affected individuals. Rendering them as one
  // entry hid the §164.404 citation entirely, which auditors flag.
  //
  // State-level breach-notification overlays (state AG / state residents
  // / state-specific 30/45/60-day clocks) live in `STATE_*` entries
  // below, kept distinct from federal so multi-state UI can render them
  // as a labelled second list rather than a flat blend.
  HIPAA_BREACH_HHS_NOTIFICATION: citation(
    "§164.408",
    "HIPAA",
    "Notification to the Secretary (HHS) — 60 days for major breaches; annual log for <500",
  ),
  HIPAA_BREACH_INDIVIDUAL_NOTIFICATION: citation(
    "§164.404",
    "HIPAA",
    "Notification to affected individuals — 60 days from discovery",
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
  DEA_INITIAL_REGISTRATION: citation(
    "21 CFR §1301.11",
    "DEA",
    "Persons required to register (initial DEA registration)",
  ),
  DEA_TERM_RENEWAL: citation(
    "21 CFR §1301.13",
    "DEA",
    "Application for registration; term + renewal cycle",
  ),
  DEA_REGISTRATION_CHANGES: citation(
    "21 CFR §1301.51",
    "DEA",
    "Modification, transfer, or termination of registration",
  ),

  // ── State medical board licensure ─────────────────────────────────
  // Generic FSMB-pointer baseline. Per-state code (e.g., a NY-overlay
  // page) can render this entry alongside its own state-specific
  // citation — the registry currently has no per-state overlays, but
  // the title intentionally says "see state board" so a future per-
  // state specialization (e.g., STATE_MEDICAL_LICENSURE_CA) reads as
  // a refinement, not a replacement.
  STATE_MEDICAL_LICENSURE: citation(
    "State medical practice act",
    "State board",
    "State medical board licensure (renewal cycle varies by state — see FSMB)",
  ),

  // ── CMS / Medicare ────────────────────────────────────────────────
  CMS_REVALIDATION_CYCLE: citation(
    "42 CFR §424.515",
    "CMS",
    "5-year provider revalidation cycle (3-year for DMEPOS suppliers)",
  ),

  // ── USP 797 §21 (Allergy compounding) ─────────────────────────────
  USP_797_21: citation(
    "USP 797 §21",
    "USP",
    "Allergen extract compounding carve-out",
  ),
} as const satisfies Record<string, Citation>;

export type CitationKey = keyof typeof CITATIONS;

// ── Credential-type → citation lookup ────────────────────────────────
//
// Audit #21 IM-8 (PR-C6): so the Concierge `list_credentials` tool can
// surface the underlying regulation alongside each credential row, map
// known CredentialType.code values to their primary citation. Falls
// back to category for the long tail of state-licensure codes
// (MD_STATE_LICENSE, DO_STATE_LICENSE, NP_STATE_LICENSE, …) so adding
// a new state license code doesn't require touching this file.
//
// `null` means "no specific federal/state citation worth surfacing"
// (e.g., insurance, internal training cards) — the lookup is
// intentionally explicit-null rather than omitted, so a future audit
// of "what's covered" can grep for `null` and decide.

const CITATIONS_BY_CREDENTIAL_TYPE_CODE: Record<string, Citation | null> = {
  // DEA
  DEA_CONTROLLED_SUBSTANCE_REGISTRATION: CITATIONS.DEA_TERM_RENEWAL,
  // CMS
  NPI_REGISTRATION: CITATIONS.CMS_REVALIDATION_CYCLE,
  MEDICARE_PECOS_ENROLLMENT: CITATIONS.CMS_REVALIDATION_CYCLE,
  MEDICARE_PROVIDER_ENROLLMENT: CITATIONS.CMS_REVALIDATION_CYCLE,
  MEDICARE_ADVANTAGE_CREDENTIALING: CITATIONS.CMS_REVALIDATION_CYCLE,
  MEDICAID_PROVIDER_ENROLLMENT: CITATIONS.CMS_REVALIDATION_CYCLE,
};

const CITATIONS_BY_CREDENTIAL_TYPE_CATEGORY: Record<
  string,
  Citation | null
> = {
  CLINICAL_LICENSE: CITATIONS.STATE_MEDICAL_LICENSURE,
  DEA_REGISTRATION: CITATIONS.DEA_TERM_RENEWAL,
  MEDICARE_MEDICAID: CITATIONS.CMS_REVALIDATION_CYCLE,
};

/**
 * Resolve the most-applicable citation for a credential type. Looks up
 * by exact `CredentialType.code` first (so DEA + CMS get their precise
 * federal citation); falls back to `CredentialType.category` for the
 * long tail of state licensure codes; returns null when no
 * federal/state citation is meaningfully attached (insurance,
 * internal CPR cards, etc.).
 *
 * Audit #21 IM-8 (PR-C6).
 */
export function getCitationForCredentialType(
  code: string | null | undefined,
  category?: string | null | undefined,
): Citation | null {
  if (code && code in CITATIONS_BY_CREDENTIAL_TYPE_CODE) {
    return CITATIONS_BY_CREDENTIAL_TYPE_CODE[code] ?? null;
  }
  if (category && category in CITATIONS_BY_CREDENTIAL_TYPE_CATEGORY) {
    return CITATIONS_BY_CREDENTIAL_TYPE_CATEGORY[category] ?? null;
  }
  return null;
}
