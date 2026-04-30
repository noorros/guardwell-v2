// src/lib/regulations/citations.test.ts
//
// Audit #11: regression guard for the citation registry shape so a
// future "let me drop the title field" or "let me empty out a stale
// citation" PR doesn't silently break every page that renders it.

import { describe, it, expect } from "vitest";
import { CITATIONS } from "./citations";

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
});
