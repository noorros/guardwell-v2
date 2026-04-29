import { describe, it, expect } from "vitest";
import { US_STATES, isValidStateCode, stateName } from "@/lib/states";

describe("US_STATES", () => {
  it("has exactly 51 entries (50 states + DC)", () => {
    expect(US_STATES).toHaveLength(51);
  });
  it("each entry has 2-letter uppercase code + non-empty name", () => {
    for (const s of US_STATES) {
      expect(s.code).toMatch(/^[A-Z]{2}$/);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });
  it("contains AZ Arizona, CA California, DC District of Columbia", () => {
    const codes = US_STATES.map((s) => s.code);
    expect(codes).toContain("AZ");
    expect(codes).toContain("CA");
    expect(codes).toContain("DC");
  });
  it("has unique codes", () => {
    const codes = US_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("isValidStateCode", () => {
  it("accepts known codes (case insensitive)", () => {
    expect(isValidStateCode("AZ")).toBe(true);
    expect(isValidStateCode("az")).toBe(true);
    expect(isValidStateCode("Ca")).toBe(true);
  });
  it("rejects unknown codes", () => {
    expect(isValidStateCode("XX")).toBe(false);
    expect(isValidStateCode("")).toBe(false);
    expect(isValidStateCode("USA")).toBe(false);
  });
});

describe("stateName", () => {
  it("returns full name for valid code", () => {
    expect(stateName("AZ")).toBe("Arizona");
    expect(stateName("dc")).toBe("District of Columbia");
  });
  it("returns the code itself for unknown", () => {
    expect(stateName("XX")).toBe("XX");
  });
});
