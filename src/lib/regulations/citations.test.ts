// src/lib/regulations/citations.test.ts
//
// Audit #11: regression guard for the citation registry shape so a
// future "let me drop the title field" or "let me empty out a stale
// citation" PR doesn't silently break every page that renders it.

import { describe, it, expect } from "vitest";
import { CITATIONS, getCitationForCredentialType } from "./citations";

describe("CITATIONS registry", () => {
  it("every entry has non-empty code, display, title", () => {
    for (const [key, c] of Object.entries(CITATIONS)) {
      expect(c.code, `${key}.code should be non-empty`).toMatch(/\S/);
      expect(c.display, `${key}.display should be non-empty`).toMatch(/\S/);
      expect(c.title, `${key}.title should be non-empty`).toMatch(/\S/);
    }
  });

  it("display always contains the bare code", () => {
    for (const [key, c] of Object.entries(CITATIONS)) {
      expect(
        c.display.includes(c.code),
        `${key}.display "${c.display}" should contain code "${c.code}"`,
      ).toBe(true);
    }
  });

  it("HIPAA breach + SRA citations point at the audit-defense paragraphs", () => {
    // Spot-checks for the most-referenced citations — drift in these
    // would silently re-introduce the cross-page mismatch this registry
    // exists to prevent.
    expect(CITATIONS.HIPAA_BREACH_DEFINITION.code).toBe("§164.402");
    expect(CITATIONS.HIPAA_SRA.code).toBe("§164.308(a)(1)(ii)(A)");
    expect(CITATIONS.HIPAA_SECURITY_OFFICER.code).toBe("§164.308(a)(2)");
    expect(CITATIONS.HIPAA_PRIVACY_OFFICER.code).toBe("§164.530(a)(1)(i)");
    expect(CITATIONS.HIPAA_DOC_RETENTION.code).toBe("§164.530(j)");
    expect(CITATIONS.OSHA_RECORDKEEPING.code).toBe("29 CFR §1904");
    expect(CITATIONS.OSHA_BLOODBORNE_PATHOGENS.code).toBe("§1910.1030");
    expect(CITATIONS.USP_797_21.code).toBe("USP 797 §21");
  });

  // Audit #21 HIPAA M-9 (2026-04-30): the breach-notification clocks
  // were previously rendered as one citation under the §164.408 code,
  // which silently dropped §164.404 (patient notice). Guard the split.
  it("federal HHS-notification (§164.408) and individual-notification (§164.404) are separate citations", () => {
    expect(CITATIONS.HIPAA_BREACH_HHS_NOTIFICATION.code).toBe("§164.408");
    expect(CITATIONS.HIPAA_BREACH_INDIVIDUAL_NOTIFICATION.code).toBe(
      "§164.404",
    );
    // Sanity-check: distinct codes. A future "let me consolidate these"
    // refactor would silently re-introduce the conflation.
    expect(
      CITATIONS.HIPAA_BREACH_HHS_NOTIFICATION.code,
    ).not.toBe(CITATIONS.HIPAA_BREACH_INDIVIDUAL_NOTIFICATION.code);
    // Both must be HIPAA-framework displays (federal), not state-overlay.
    expect(CITATIONS.HIPAA_BREACH_HHS_NOTIFICATION.display).toContain("HIPAA");
    expect(CITATIONS.HIPAA_BREACH_INDIVIDUAL_NOTIFICATION.display).toContain(
      "HIPAA",
    );
  });

  // Audit #21 IM-8 (PR-C6).
  describe("DEA / state-board / CMS expansion", () => {
    it("DEA term + renewal cycle resolves to 21 CFR §1301.13", () => {
      expect(CITATIONS.DEA_TERM_RENEWAL.code).toBe("21 CFR §1301.13");
      expect(CITATIONS.DEA_TERM_RENEWAL.display).toBe(
        "DEA 21 CFR §1301.13",
      );
    });

    it("DEA initial registration resolves to 21 CFR §1301.11", () => {
      expect(CITATIONS.DEA_INITIAL_REGISTRATION.code).toBe("21 CFR §1301.11");
    });

    it("DEA registration changes resolves to 21 CFR §1301.51", () => {
      expect(CITATIONS.DEA_REGISTRATION_CHANGES.code).toBe("21 CFR §1301.51");
    });

    it("State medical licensure baseline points at the state practice act", () => {
      expect(CITATIONS.STATE_MEDICAL_LICENSURE.code).toBe(
        "State medical practice act",
      );
      // Display should render under the "State board" framework so a
      // tooltip / aria string reads "State board State medical
      // practice act" — verify both halves are present.
      expect(CITATIONS.STATE_MEDICAL_LICENSURE.display).toContain("State board");
      expect(CITATIONS.STATE_MEDICAL_LICENSURE.display).toContain(
        "State medical practice act",
      );
    });

    it("CMS revalidation cycle resolves to 42 CFR §424.515", () => {
      expect(CITATIONS.CMS_REVALIDATION_CYCLE.code).toBe("42 CFR §424.515");
      expect(CITATIONS.CMS_REVALIDATION_CYCLE.display).toBe(
        "CMS 42 CFR §424.515",
      );
    });
  });
});

// Audit #21 IM-8 (PR-C6): credential-type → citation lookup wired into
// Concierge `list_credentials`. These tests guard the mapping table so
// a future "let me rename CredentialType.code DEA_CONTROLLED…" PR
// doesn't silently strip the regulation column from Concierge output.
describe("getCitationForCredentialType()", () => {
  it("DEA controlled-substance registration → 21 CFR §1301.13", () => {
    const c = getCitationForCredentialType(
      "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
      "DEA_REGISTRATION",
    );
    expect(c).not.toBeNull();
    expect(c?.code).toBe("21 CFR §1301.13");
  });

  it("Medicare PECOS enrollment → 42 CFR §424.515", () => {
    const c = getCitationForCredentialType(
      "MEDICARE_PECOS_ENROLLMENT",
      "MEDICARE_MEDICAID",
    );
    expect(c?.code).toBe("42 CFR §424.515");
  });

  it("NPI registration → 42 CFR §424.515", () => {
    const c = getCitationForCredentialType(
      "NPI_REGISTRATION",
      "MEDICARE_MEDICAID",
    );
    expect(c?.code).toBe("42 CFR §424.515");
  });

  it("MD state license falls back to STATE_MEDICAL_LICENSURE via CLINICAL_LICENSE category", () => {
    const c = getCitationForCredentialType("MD_STATE_LICENSE", "CLINICAL_LICENSE");
    expect(c).not.toBeNull();
    expect(c?.code).toBe("State medical practice act");
  });

  it("DO state license + NP state license + RN license all resolve to state board baseline via category", () => {
    // Spot-check the long tail — these codes aren't enumerated in the
    // by-code map, but CLINICAL_LICENSE category is. The point of the
    // category fall-through is that adding a new state license code
    // doesn't require touching the registry.
    for (const code of [
      "DO_STATE_LICENSE",
      "NURSE_PRACTITIONER_NP_LICENSE",
      "REGISTERED_NURSE_RN_LICENSE",
      "DDS_DMD_LICENSE",
      "LVN_LPN_LICENSE",
    ]) {
      const c = getCitationForCredentialType(code, "CLINICAL_LICENSE");
      expect(c?.code, `${code} should resolve via CLINICAL_LICENSE`).toBe(
        "State medical practice act",
      );
    }
  });

  it("Insurance + non-regulatory credentials return null (no specific federal/state cite)", () => {
    expect(
      getCitationForCredentialType(
        "PROFESSIONAL_LIABILITY_INSURANCE",
        "MALPRACTICE_INSURANCE",
      ),
    ).toBeNull();
    expect(getCitationForCredentialType("BLS_CERTIFICATION_AHA", "CPR_BLS_ACLS")).toBeNull();
  });

  it("returns null for null/undefined inputs without throwing", () => {
    expect(getCitationForCredentialType(null, null)).toBeNull();
    expect(getCitationForCredentialType(undefined, undefined)).toBeNull();
    expect(getCitationForCredentialType("", "")).toBeNull();
  });

  it("returns null for an unknown code with no recognised category", () => {
    expect(
      getCitationForCredentialType("SOME_FUTURE_CODE", "SOME_FUTURE_CATEGORY"),
    ).toBeNull();
  });
});
