// src/lib/track/applicability.test.ts
import { describe, it, expect } from "vitest";
import { pickTemplateForProfile } from "./applicability";

describe("pickTemplateForProfile", () => {
  it("returns GENERAL_PRIMARY_CARE for primary care", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "PRIMARY_CARE" })).toBe(
      "GENERAL_PRIMARY_CARE",
    );
  });
  it("returns DENTAL for dental", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "DENTAL" })).toBe(
      "DENTAL",
    );
  });
  it("returns BEHAVIORAL for behavioral", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "BEHAVIORAL" })).toBe(
      "BEHAVIORAL",
    );
  });
  it("returns GENERIC for SPECIALTY/ALLIED/OTHER/null", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "SPECIALTY" })).toBe(
      "GENERIC",
    );
    expect(pickTemplateForProfile({ specialtyCategory: "ALLIED" })).toBe(
      "GENERIC",
    );
    expect(pickTemplateForProfile({ specialtyCategory: "OTHER" })).toBe(
      "GENERIC",
    );
    expect(pickTemplateForProfile({ specialtyCategory: null })).toBe("GENERIC");
  });
});
