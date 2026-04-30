// tests/integration/pdf-breach-memo-unicode.test.ts
//
// Audit #17 (HIPAA B-4): the breach memo PDF uses Helvetica, whose
// Latin-1 glyph set does NOT include U+2265 (≥). @react-pdf renders
// missing glyphs as a placeholder, so "≥500" came out as "e500" in
// the rendered audit-defense PDF.
//
// Regression: assert the source file uses ASCII ">=500" (not Unicode
// "≥500") in the JSX text content. Comments are exempt — the audit
// note + this test reference U+2265 by name, which is fine because
// comments never render.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Audit #17 — breach memo PDF avoids unrenderable Unicode", () => {
  it("incident-breach-memo-pdf.tsx contains no U+2265 outside comments", async () => {
    const path = join(
      process.cwd(),
      "src",
      "lib",
      "audit",
      "incident-breach-memo-pdf.tsx",
    );
    const src = await readFile(path, "utf8");
    // Strip block comments + line comments before scanning so the
    // audit note (which intentionally mentions ≥) doesn't trip the
    // regression guard.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/≥/);
  });

  it("incident-breach-memo-pdf.tsx uses ASCII >=500 in the major-breach badges", async () => {
    const path = join(
      process.cwd(),
      "src",
      "lib",
      "audit",
      "incident-breach-memo-pdf.tsx",
    );
    const src = await readFile(path, "utf8");
    expect(src).toMatch(/>=500/);
    expect(src).toMatch(/Major breach — >=500/);
    expect(src).toMatch(/Media \(>=500 affected\)/);
  });
});
