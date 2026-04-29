// tests/unit/concierge/eval-concierge-citations.test.ts
//
// Regression tests for the citation extractor used by the Concierge eval
// harness (scripts/lib/eval-concierge-citations.ts). The original USC
// regex missed multi-letter section suffixes (e.g. §1320a-7b, the
// canonical OIG anti-kickback citation in KNOWN_CITATIONS); these tests
// pin the corrected behavior so the regression doesn't recur.
import { describe, it, expect } from "vitest";
import {
  CFR_CITATION_RE,
  KNOWN_CITATIONS,
  USC_CITATION_RE,
  extractCitations,
  normalizeCitation,
} from "../../../scripts/lib/eval-concierge-citations";

describe("USC_CITATION_RE", () => {
  it("matches §1320 (bare digits)", () => {
    const text = "See 42 USC §1320.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["42 USC §1320"]);
  });

  it("matches §1320a (digit + single letter)", () => {
    const text = "See 42 USC §1320a.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["42 USC §1320a"]);
  });

  it("matches §1320a-7 (digit + letter-digit)", () => {
    const text = "See 42 USC §1320a-7.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["42 USC §1320a-7"]);
  });

  it("matches §1320a-7b (digit + letter-digit-letter — OIG anti-kickback)", () => {
    const text = "See 42 USC §1320a-7b.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["42 USC §1320a-7b"]);
  });

  it("matches all four section formats in one pass without losing any", () => {
    const text =
      "See 42 USC §1320a-7b and 42 USC §1320a-7 and 42 USC §1320a and 42 USC §1320.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual([
      "42 USC §1320a-7b",
      "42 USC §1320a-7",
      "42 USC §1320a",
      "42 USC §1320",
    ]);
  });

  it("matches the U.S.C. dotted form", () => {
    const text = "See 42 U.S.C. § 1320a-7b.";
    const matches = [...text.matchAll(USC_CITATION_RE)].map((m) => m[0]);
    expect(matches).toHaveLength(1);
  });
});

describe("CFR_CITATION_RE", () => {
  it("matches HIPAA §164.402 form", () => {
    const text = "See 45 CFR §164.402.";
    const matches = [...text.matchAll(CFR_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["45 CFR §164.402"]);
  });

  it("matches multiple CFR cites in one pass", () => {
    const text = "See 45 CFR §164.308 and 29 CFR §1910.1030.";
    const matches = [...text.matchAll(CFR_CITATION_RE)].map((m) => m[0]);
    expect(matches).toEqual(["45 CFR §164.308", "29 CFR §1910.1030"]);
  });
});

describe("extractCitations", () => {
  it("extracts the canonical OIG anti-kickback citation present in KNOWN_CITATIONS", () => {
    const text = "Anti-kickback statute is 42 USC §1320a-7b.";
    const cites = extractCitations(text);
    expect(cites).toContain("42 USC §1320a-7b");
    // The output is in the same form KNOWN_CITATIONS stores — confirm
    // the round-trip works for the real allow-list lookup.
    expect(KNOWN_CITATIONS.has("42 USC §1320a-7b")).toBe(true);
  });

  it("extracts a mix of CFR + USC cites in document order (CFR group first, USC after)", () => {
    const text =
      "Per 45 CFR §164.308 and 42 USC §1320a-7b, the Security Rule requires...";
    const cites = extractCitations(text);
    expect(cites).toEqual(["45 CFR §164.308", "42 USC §1320a-7b"]);
  });

  it("is re-entrant: repeated calls on the same text return the same result (regex.lastIndex doesn't leak)", () => {
    const text = "See 42 USC §1320a-7b and 45 CFR §164.402.";
    const a = extractCitations(text);
    const b = extractCitations(text);
    const c = extractCitations(text);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual(["45 CFR §164.402", "42 USC §1320a-7b"]);
  });

  it("returns empty array for text with no citations", () => {
    expect(extractCitations("Nothing relevant here.")).toEqual([]);
  });
});

describe("normalizeCitation", () => {
  it("collapses multi-space + 'U.S.C.' dotted form to canonical 'USC' form", () => {
    expect(normalizeCitation("42  U.S.C.  §  1320a-7b")).toBe("42 USC §1320a-7b");
  });

  it("normalizes raw match shape into KNOWN_CITATIONS lookup key", () => {
    expect(normalizeCitation("45 CFR §164.402")).toBe("45 CFR §164.402");
    expect(KNOWN_CITATIONS.has(normalizeCitation("45 CFR §164.402"))).toBe(true);
  });
});
