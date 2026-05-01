// @vitest-environment node
//
// src/lib/risk/autoGenerate.test.ts
//
// Phase 5 PR 5 — pure-function coverage for the SRA/TA -> RiskItem
// proposal mapping. No DB I/O; just verifies the severity matrix and
// the YES/NA filter.

import { describe, it, expect } from "vitest";
import {
  generateRiskItemsFromAnswers,
  type AnswerWithMeta,
} from "./autoGenerate";

function answer(
  partial: Partial<AnswerWithMeta> & {
    answer: AnswerWithMeta["answer"];
    riskWeight: AnswerWithMeta["riskWeight"];
  },
): AnswerWithMeta {
  return {
    questionCode: partial.questionCode ?? "Q1",
    answer: partial.answer,
    riskWeight: partial.riskWeight,
    title: partial.title ?? "Sample question",
    description: partial.description ?? "Sample description",
    category: partial.category ?? "ADMINISTRATIVE",
  };
}

describe("generateRiskItemsFromAnswers", () => {
  it("NO + HIGH weight → 1 proposal severity HIGH", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({ answer: "NO", riskWeight: "HIGH" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("HIGH");
    expect(out[0]!.source).toBe("SRA");
    expect(out[0]!.practiceId).toBe("p1");
    expect(out[0]!.sourceRefId).toBe("a1");
  });

  it("PARTIAL + HIGH weight → 1 proposal severity MEDIUM (downgraded)", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({ answer: "PARTIAL", riskWeight: "HIGH" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("MEDIUM");
  });

  it("PARTIAL + LOW weight → 1 proposal severity INFO", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({ answer: "PARTIAL", riskWeight: "LOW" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("INFO");
  });

  it("YES + NA produce no proposals", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({ answer: "YES", riskWeight: "HIGH" }),
      answer({ answer: "NA", riskWeight: "HIGH", questionCode: "Q2" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("mixed answer set: only NO + PARTIAL produce proposals", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({ answer: "YES", riskWeight: "HIGH", questionCode: "QY" }),
      answer({ answer: "NO", riskWeight: "MEDIUM", questionCode: "QN" }),
      answer({ answer: "PARTIAL", riskWeight: "MEDIUM", questionCode: "QP" }),
      answer({ answer: "NA", riskWeight: "HIGH", questionCode: "QA" }),
    ]);
    expect(out).toHaveLength(2);
    const codes = out.map((p) => p.sourceCode).sort();
    expect(codes).toEqual(["QN", "QP"]);
  });

  it("severity matrix: every (answer, weight) cell maps correctly", () => {
    const cases = [
      { answer: "NO", riskWeight: "HIGH", expected: "HIGH" },
      { answer: "NO", riskWeight: "MEDIUM", expected: "MEDIUM" },
      { answer: "NO", riskWeight: "LOW", expected: "LOW" },
      { answer: "PARTIAL", riskWeight: "HIGH", expected: "MEDIUM" },
      { answer: "PARTIAL", riskWeight: "MEDIUM", expected: "LOW" },
      { answer: "PARTIAL", riskWeight: "LOW", expected: "INFO" },
    ] as const;

    for (const c of cases) {
      const out = generateRiskItemsFromAnswers("p1", "a1", [
        answer({ answer: c.answer, riskWeight: c.riskWeight }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.severity).toBe(c.expected);
    }
  });

  it("source defaults to SRA but TECHNICAL_ASSESSMENT can be passed", () => {
    const taOut = generateRiskItemsFromAnswers(
      "p1",
      "a1",
      [answer({ answer: "NO", riskWeight: "HIGH" })],
      "TECHNICAL_ASSESSMENT",
    );
    expect(taOut[0]!.source).toBe("TECHNICAL_ASSESSMENT");
  });

  it("preserves question metadata (title, description, category, sourceCode)", () => {
    const out = generateRiskItemsFromAnswers("p1", "a1", [
      answer({
        answer: "NO",
        riskWeight: "HIGH",
        questionCode: "ADMIN_RA_1",
        title: "Conduct risk analysis",
        description: "A thorough analysis of risks to ePHI",
        category: "ADMINISTRATIVE",
      }),
    ]);
    expect(out[0]!.sourceCode).toBe("ADMIN_RA_1");
    expect(out[0]!.title).toBe("Conduct risk analysis");
    expect(out[0]!.description).toBe(
      "A thorough analysis of risks to ePHI",
    );
    expect(out[0]!.category).toBe("ADMINISTRATIVE");
  });
});
