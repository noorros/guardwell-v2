// tests/integration/allergy-quiz-grading.test.ts
//
// Verifies the quiz-grading helper:
//   - never lets a client see the correct answer key BEFORE submission
//     (the QuizQuestion shape exposed to the client must not include
//     `correctId` or `explanation`)
//   - returns review items AFTER submission so the result panel can
//     render correct-vs-selected with explanation text
//
// Audit item #1 — Allergy quiz answer-key leak (live-validated exploit).

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { gradeAllergyQuizAttempt } from "@/app/(dashboard)/programs/allergy/grade";
import type { ClientQuizQuestion } from "@/app/(dashboard)/programs/allergy/QuizRunner";

describe("allergy quiz grading", () => {
  beforeEach(async () => {
    await db.allergyQuizQuestion.deleteMany();
  });

  async function seedQuestions() {
    const q1 = await db.allergyQuizQuestion.create({
      data: {
        questionText: "What is the minimum hand-washing duration before compounding?",
        options: [
          { id: "a", text: "10 seconds" },
          { id: "b", text: "20 seconds" },
          { id: "c", text: "30 seconds" },
        ],
        correctId: "c",
        explanation: "USP 797 requires thorough handwashing for at least 30 seconds.",
        category: "ASEPTIC_TECHNIQUE",
        displayOrder: 1,
        isActive: true,
      },
    });
    const q2 = await db.allergyQuizQuestion.create({
      data: {
        questionText: "How often must skin-test antigen vials be replaced?",
        options: [
          { id: "a", text: "Every 30 days" },
          { id: "b", text: "Per manufacturer beyond-use-date" },
          { id: "c", text: "Annually" },
        ],
        correctId: "b",
        explanation: "BUDs are vendor-specified; do not extrapolate.",
        category: "STORAGE_STABILITY",
        displayOrder: 1,
        isActive: true,
      },
    });
    return { q1, q2 };
  }

  it("returns review items with correct option text + explanation per question", async () => {
    const { q1, q2 } = await seedQuestions();

    const result = await gradeAllergyQuizAttempt(db, {
      answers: [
        { questionId: q1.id, selectedId: "c" }, // correct
        { questionId: q2.id, selectedId: "a" }, // wrong (correct is b)
      ],
    });

    expect(result.score).toBe(50);
    expect(result.passed).toBe(false);
    expect(result.correctAnswers).toBe(1);
    expect(result.totalQuestions).toBe(2);
    expect(result.reviewItems).toHaveLength(2);

    const r1 = result.reviewItems.find((r) => r.questionId === q1.id);
    expect(r1).toBeDefined();
    expect(r1?.isCorrect).toBe(true);
    expect(r1?.correctOption).toEqual({ id: "c", text: "30 seconds" });
    expect(r1?.explanation).toBe(
      "USP 797 requires thorough handwashing for at least 30 seconds.",
    );

    const r2 = result.reviewItems.find((r) => r.questionId === q2.id);
    expect(r2?.isCorrect).toBe(false);
    expect(r2?.correctOption).toEqual({
      id: "b",
      text: "Per manufacturer beyond-use-date",
    });
  });

  it("flips passed=true at >=80%", async () => {
    const { q1, q2 } = await seedQuestions();
    const result = await gradeAllergyQuizAttempt(db, {
      answers: [
        { questionId: q1.id, selectedId: "c" }, // correct
        { questionId: q2.id, selectedId: "b" }, // correct
      ],
    });
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("annotated payload field strips review-only fields (audit-event payload stays compact)", async () => {
    const { q1 } = await seedQuestions();
    const result = await gradeAllergyQuizAttempt(db, {
      answers: [{ questionId: q1.id, selectedId: "a" }],
    });
    // The audit-event payload (stored in EventLog) only needs the
    // boolean isCorrect for replay; correct option text + explanation
    // are response-only fields used by the result panel.
    expect(result.annotated).toEqual([
      { questionId: q1.id, selectedId: "a", isCorrect: false },
    ]);
  });

  // Type-level guards — these don't execute meaningful runtime code; they
  // fail the test file at COMPILE time if the ClientQuizQuestion type ever
  // re-introduces correct-answer-leaking fields. Treat as a contract test.
  it("ClientQuizQuestion does not expose correctId or explanation", () => {
    type _CorrectIdNotExposed =
      "correctId" extends keyof ClientQuizQuestion ? never : "ok";
    type _ExplanationNotExposed =
      "explanation" extends keyof ClientQuizQuestion ? never : "ok";
    const _a: _CorrectIdNotExposed = "ok";
    const _b: _ExplanationNotExposed = "ok";
    void _a;
    void _b;
    expect(true).toBe(true);
  });
});
