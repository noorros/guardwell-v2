// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeSraScore } from "./scoring";

describe("computeSraScore", () => {
  it("scores 100 when every answer is YES", () => {
    const result = computeSraScore([
      { questionCode: "Q1", answer: "YES", riskWeight: "HIGH" },
      { questionCode: "Q2", answer: "YES", riskWeight: "MEDIUM" },
    ]);
    expect(result.overallScore).toBe(100);
    expect(result.addressedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("counts NA as addressed (full credit)", () => {
    const result = computeSraScore([
      { questionCode: "Q1", answer: "YES", riskWeight: "HIGH" },
      { questionCode: "Q2", answer: "NA", riskWeight: "MEDIUM" },
    ]);
    expect(result.addressedCount).toBe(2);
    expect(result.overallScore).toBe(100);
  });

  it("PARTIAL counts as half-credit weighted, not in addressedCount", () => {
    const result = computeSraScore([
      { questionCode: "Q1", answer: "PARTIAL", riskWeight: "HIGH" },
    ]);
    expect(result.overallScore).toBe(50);
    expect(result.addressedCount).toBe(0);
  });

  it("NO scores zero", () => {
    const result = computeSraScore([
      { questionCode: "Q1", answer: "YES", riskWeight: "HIGH" },
      { questionCode: "Q2", answer: "NO", riskWeight: "HIGH" },
    ]);
    expect(result.overallScore).toBe(50);
    expect(result.addressedCount).toBe(1);
  });

  it("HIGH-weight NO depresses score more than LOW-weight NO", () => {
    const a = computeSraScore([
      { questionCode: "Q1", answer: "YES", riskWeight: "LOW" },
      { questionCode: "Q2", answer: "NO", riskWeight: "HIGH" },
    ]);
    const b = computeSraScore([
      { questionCode: "Q1", answer: "YES", riskWeight: "HIGH" },
      { questionCode: "Q2", answer: "NO", riskWeight: "LOW" },
    ]);
    expect(a.overallScore).toBeLessThan(b.overallScore);
  });

  it("returns 0 score for empty input", () => {
    expect(computeSraScore([])).toEqual({
      overallScore: 0,
      addressedCount: 0,
      totalCount: 0,
    });
  });
});
