import { describe, it, expect } from "vitest";
import { isValidNpi } from "@/lib/npi";

describe("isValidNpi", () => {
  it("accepts valid 10-digit NPIs", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1245319599")).toBe(true);
  });
  it("rejects 10-digit numbers that fail Luhn", () => {
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("0000000000")).toBe(false);
  });
  it("rejects non-10-digit inputs", () => {
    expect(isValidNpi("123")).toBe(false);
    expect(isValidNpi("12345678901")).toBe(false);
    expect(isValidNpi("abcdefghij")).toBe(false);
  });
  it("rejects empty / null / undefined", () => {
    expect(isValidNpi("")).toBe(false);
    expect(isValidNpi(null)).toBe(false);
    expect(isValidNpi(undefined)).toBe(false);
  });
  it("trims whitespace before validating", () => {
    expect(isValidNpi(" 1234567893 ")).toBe(true);
  });
});
