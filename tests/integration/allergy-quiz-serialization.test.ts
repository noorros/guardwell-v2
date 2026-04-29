// tests/integration/allergy-quiz-serialization.test.ts
//
// Security: the quiz page must NOT ship `correctId` or `explanation`
// to the client. These fields would let any authenticated user read
// the answer key via View Source / DevTools and fake competency.
// Code review C-3 (2026-04-29 audit). Live-validated: 44 occurrences
// of `correctId` were embedded in the inline RSC payload at
// /programs/allergy/quiz before this fix.

import { describe, it, expect } from "vitest";
import { buildClientQuizQuestions } from "@/lib/allergy/quiz-client";

describe("buildClientQuizQuestions", () => {
  const dbQuestion = {
    id: "q-aseptic-1",
    questionText: "What is the correct hand hygiene procedure?",
    options: [
      { id: "a", text: "Quick rinse" },
      { id: "b", text: "Soap + alcohol" },
      { id: "c", text: "Gloves alone" },
    ],
    correctId: "b",
    explanation: "USP 797 requires both soap-and-water + alcohol-based sanitizer.",
    category: "ASEPTIC_TECHNIQUE",
    displayOrder: 1,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  it("strips correctId and explanation from each question", () => {
    const result = buildClientQuizQuestions([dbQuestion]);
    expect(result).toHaveLength(1);
    const client = result[0]!;
    expect(client).not.toHaveProperty("correctId");
    expect(client).not.toHaveProperty("explanation");
  });

  it("preserves the fields the client needs to render", () => {
    const result = buildClientQuizQuestions([dbQuestion]);
    expect(result).toHaveLength(1);
    const client = result[0]!;
    expect(client.id).toBe("q-aseptic-1");
    expect(client.questionText).toBe("What is the correct hand hygiene procedure?");
    expect(client.category).toBe("ASEPTIC_TECHNIQUE");
    expect(client.options).toEqual([
      { id: "a", text: "Quick rinse" },
      { id: "b", text: "Soap + alcohol" },
      { id: "c", text: "Gloves alone" },
    ]);
  });

  it("JSON-serialized output contains no correctId or explanation strings", () => {
    // Stronger guarantee: a future regression that re-adds the fields would
    // pass the property check above (if .toHaveProperty matches a different
    // field) but would fail this whole-payload string match.
    const dbQuestions = [dbQuestion, { ...dbQuestion, id: "q-aseptic-2", correctId: "a" }];
    const json = JSON.stringify(buildClientQuizQuestions(dbQuestions));
    expect(json).not.toMatch(/correctId/);
    expect(json).not.toMatch(/explanation/);
  });

  it("handles empty input", () => {
    expect(buildClientQuizQuestions([])).toEqual([]);
  });
});
