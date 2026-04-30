// @vitest-environment jsdom
//
// Audit #21 / Allergy MIN-6 (2026-04-30): the OverdueBanner now escalates
// color by how overdue the drill is — caution (amber) at 0–30 days past
// the §21.6 annual, warning (orange) at 30–90 days, critical (destructive
// red) at >90 days. Pure helper covered by classifyOverdueSeverity.

import { describe, it, expect } from "vitest";
import { classifyOverdueSeverity } from "./DrillTab";

describe("classifyOverdueSeverity (audit #21 Allergy MIN-6)", () => {
  it("returns 'caution' for 0 days overdue (just rolled over the year)", () => {
    expect(classifyOverdueSeverity(0)).toBe("caution");
  });

  it("returns 'caution' through 30 days overdue", () => {
    expect(classifyOverdueSeverity(30)).toBe("caution");
  });

  it("returns 'warning' just past 30 days overdue", () => {
    expect(classifyOverdueSeverity(31)).toBe("warning");
  });

  it("returns 'warning' through 90 days overdue", () => {
    expect(classifyOverdueSeverity(90)).toBe("warning");
  });

  it("returns 'critical' just past 90 days overdue", () => {
    expect(classifyOverdueSeverity(91)).toBe("critical");
  });

  it("returns 'critical' for an extreme overdue value (>1 year past due)", () => {
    expect(classifyOverdueSeverity(500)).toBe("critical");
  });
});
