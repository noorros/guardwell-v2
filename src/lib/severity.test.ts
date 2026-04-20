// src/lib/severity.test.ts
import { describe, it, expect } from "vitest";
import { daysUntilToSeverity, severityToColorToken } from "./severity";

describe("daysUntilToSeverity", () => {
  it.each([
    [-5, "risk"],
    [0, "risk"],
    [3, "risk"],
    [4, "needs"],
    [14, "needs"],
    [15, "good"],
    [30, "good"],
    [31, "compliant"],
    [365, "compliant"],
  ] as const)("days=%i -> %s", (days, severity) => {
    expect(daysUntilToSeverity(days)).toBe(severity);
  });
});

describe("severityToColorToken", () => {
  it.each([
    ["compliant", "var(--gw-color-compliant)"],
    ["good", "var(--gw-color-good)"],
    ["needs", "var(--gw-color-needs)"],
    ["risk", "var(--gw-color-risk)"],
  ] as const)("%s -> %s", (sev, token) => {
    expect(severityToColorToken(sev)).toBe(token);
  });
});
