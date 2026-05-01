// @vitest-environment node
import { describe, it, expect } from "vitest";
import { groupSraQuestions, type SraQuestionLite } from "./grouping";

const SAMPLE: SraQuestionLite[] = [
  { id: "1", code: "ADMIN_A", category: "ADMINISTRATIVE", subcategory: "Security Management Process", sortOrder: 10, riskWeight: "HIGH" },
  { id: "2", code: "ADMIN_B", category: "ADMINISTRATIVE", subcategory: "Security Management Process", sortOrder: 20, riskWeight: "HIGH" },
  { id: "3", code: "ADMIN_C", category: "ADMINISTRATIVE", subcategory: "Workforce Security", sortOrder: 30, riskWeight: "MEDIUM" },
  { id: "4", code: "PHYS_A", category: "PHYSICAL", subcategory: "Facility Access", sortOrder: 10, riskWeight: "MEDIUM" },
  { id: "5", code: "TECH_A", category: "TECHNICAL", subcategory: "Access Control", sortOrder: 10, riskWeight: "HIGH" },
];

describe("groupSraQuestions", () => {
  it("groups by category preserving sortOrder within subcategory", () => {
    const grouped = groupSraQuestions(SAMPLE);
    expect(grouped.ADMINISTRATIVE.length).toBe(3);
    expect(grouped.PHYSICAL.length).toBe(1);
    expect(grouped.TECHNICAL.length).toBe(1);
  });

  it("sorts ADMIN questions first by subcategory then sortOrder", () => {
    const grouped = groupSraQuestions(SAMPLE);
    const admin = grouped.ADMINISTRATIVE;
    expect(admin[0]!.code).toBe("ADMIN_A");
    expect(admin[1]!.code).toBe("ADMIN_B");
    expect(admin[2]!.code).toBe("ADMIN_C");
  });

  it("returns empty arrays for sections with no questions", () => {
    const grouped = groupSraQuestions([]);
    expect(grouped.ADMINISTRATIVE).toEqual([]);
    expect(grouped.PHYSICAL).toEqual([]);
    expect(grouped.TECHNICAL).toEqual([]);
  });
});
