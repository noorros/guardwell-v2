import { describe, it, expect } from "vitest";
import {
  SPECIALTIES,
  deriveSpecialtyCategory,
  type SpecialtyCategory,
} from "@/lib/specialties";

describe("SPECIALTIES", () => {
  it("contains exactly 31 entries (30 specifics + Other)", () => {
    expect(SPECIALTIES).toHaveLength(31);
  });
  it("each entry has unique value", () => {
    const values = SPECIALTIES.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });
  it("includes Family Medicine, Dental — General, Other", () => {
    const values = SPECIALTIES.map((s) => s.value);
    expect(values).toContain("Family Medicine");
    expect(values).toContain("Dental — General");
    expect(values).toContain("Other");
  });
  it("each entry has a known bucket category", () => {
    const validBuckets: SpecialtyCategory[] = [
      "PRIMARY_CARE",
      "SPECIALTY",
      "DENTAL",
      "BEHAVIORAL",
      "ALLIED",
      "OTHER",
    ];
    for (const s of SPECIALTIES) {
      expect(validBuckets).toContain(s.bucket);
    }
  });
});

describe("deriveSpecialtyCategory", () => {
  it("returns the bucket for a known specialty", () => {
    expect(deriveSpecialtyCategory("Family Medicine")).toBe("PRIMARY_CARE");
    expect(deriveSpecialtyCategory("Cardiology")).toBe("SPECIALTY");
    expect(deriveSpecialtyCategory("Physical Therapy")).toBe("ALLIED");
    expect(deriveSpecialtyCategory("Behavioral Health")).toBe("BEHAVIORAL");
    expect(deriveSpecialtyCategory("Dental — General")).toBe("DENTAL");
  });
  it("returns OTHER for unknown specialty", () => {
    expect(deriveSpecialtyCategory("Time Travel Medicine")).toBe("OTHER");
  });
  it("returns OTHER for empty/null/undefined", () => {
    expect(deriveSpecialtyCategory("")).toBe("OTHER");
    expect(deriveSpecialtyCategory(null)).toBe("OTHER");
    expect(deriveSpecialtyCategory(undefined)).toBe("OTHER");
  });
});
