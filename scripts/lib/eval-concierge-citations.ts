// scripts/lib/eval-concierge-citations.ts
//
// Citation extraction + allow-list for the Concierge eval harness.
//
// Factored out of scripts/eval-concierge.ts so the regex + extractor can
// be unit-tested without invoking the full harness (which has DB +
// Anthropic side effects on import).
//
// KNOWN_CITATIONS is a curated allow-list of CFR / USC sections the
// Concierge is allowed to emit. Citations OUTSIDE this set are flagged
// as a possible hallucination (warning, not a fail). Add new known
// sections here as Concierge legitimately surfaces them — hallucinated
// citations should NEVER end up in this set.

export const KNOWN_CITATIONS: ReadonlySet<string> = new Set([
  // HIPAA — 45 CFR Parts 160 + 164
  "45 CFR §160.103",
  "45 CFR §164.302",
  "45 CFR §164.308",
  "45 CFR §164.310",
  "45 CFR §164.312",
  "45 CFR §164.314",
  "45 CFR §164.316",
  "45 CFR §164.402",
  "45 CFR §164.404",
  "45 CFR §164.406",
  "45 CFR §164.408",
  "45 CFR §164.410",
  "45 CFR §164.412",
  "45 CFR §164.500",
  "45 CFR §164.502",
  "45 CFR §164.504",
  "45 CFR §164.508",
  "45 CFR §164.512",
  "45 CFR §164.514",
  "45 CFR §164.520",
  "45 CFR §164.524",
  "45 CFR §164.526",
  "45 CFR §164.528",
  "45 CFR §164.530",
  // OSHA — 29 CFR Part 1910 (+ 1904 recordkeeping)
  "29 CFR §1904.32",
  "29 CFR §1910.1030",
  "29 CFR §1910.132",
  "29 CFR §1910.134",
  // DEA — 21 CFR
  "21 CFR §1300.01",
  "21 CFR §1304.04",
  "21 CFR §1304.21",
  "21 CFR §1306.04",
  "21 CFR §1306.11",
  "21 CFR §1306.12",
  // CLIA — 42 CFR
  "42 CFR §493.1100",
  "42 CFR §493.1200",
  "42 CFR §493.1281",
  // MACRA / OIG / CMS Stark
  "42 USC §1320a-7b",
  "42 CFR §1001.952",
  "42 CFR §411.357",
]);

// Regexes for citation extraction. We accept the common formats:
//   "45 CFR §164.402"  "45 CFR § 164.402"  "45 CFR  § 164.402"
//   "42 USC §1320a-7b"  "42 U.S.C. § 1320a-7b"
// Whitespace inside the run is normalized to a single space before
// allow-list lookup.
//
// The USC section pattern accepts:
//   - bare digits           1320
//   - digit + letter        1320a
//   - digit + letter-digit  1320a-7
//   - digit + letter-digit-letter  1320a-7b   (canonical OIG anti-kickback)
// The trailing `[a-z]?` after `-\d+` covers the multi-letter suffix case
// that the original regex missed. Group 1 = title, group 2 = section.
export const CFR_CITATION_RE = /\b(\d+)\s*CFR\s*§\s*(\d+(?:\.\d+)?)\b/gi;
export const USC_CITATION_RE = /\b(\d+)\s*U\.?\s*S\.?\s*C\.?\s*§\s*(\d+(?:[a-z](?:-\d+[a-z]?)?)?)\b/gi;

export function normalizeCitation(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*§\s*/g, " §")
    .replace(/U\.?S\.?C\.?/i, "USC")
    .trim();
}

/**
 * Extract every CFR / USC citation from `text` and return them in
 * normalized "<title> CFR §<section>" / "<title> USC §<section>" form.
 *
 * Uses `matchAll` (not `exec`) so the module-level regex objects' stateful
 * `lastIndex` does not leak across calls — `matchAll` starts a fresh
 * iteration each invocation, which makes this function safely
 * re-entrant.
 */
export function extractCitations(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CFR_CITATION_RE)) {
    out.push(`${m[1]} CFR §${m[2]}`);
  }
  for (const m of text.matchAll(USC_CITATION_RE)) {
    out.push(`${m[1]} USC §${m[2]}`);
  }
  return out;
}
