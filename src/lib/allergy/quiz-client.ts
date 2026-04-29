// src/lib/allergy/quiz-client.ts
//
// Server-side serialization of allergy quiz questions for the client.
// Strips `correctId` + `explanation` so the answer key is not shipped
// to the browser. Without this gate, anyone could read the answers via
// View Source / DevTools and pass the USP §21.3 annual competency
// assessment with score=100. Code review C-3 (2026-04-29 audit).
//
// The result panel after submission relies on the server action's
// returned `reviewItems`, which DO include correctOptionId + explanation
// — those are safe to ship AFTER the user has locked in their answers.

export type QuizOption = { id: string; text: string };

export type ClientQuizQuestion = {
  id: string;
  questionText: string;
  options: QuizOption[];
  category: string;
};

type DbQuizQuestion = {
  id: string;
  questionText: string;
  options: unknown; // Prisma Json column
  category: string;
  // correctId, explanation, displayOrder, isActive, etc. — server-only
};

/**
 * Map DB-shaped quiz questions to the safe client-facing shape.
 * Explicitly enumerates the 4 client-safe fields so any future schema
 * additions to AllergyQuizQuestion default to server-only.
 */
export function buildClientQuizQuestions(
  dbQuestions: DbQuizQuestion[],
): ClientQuizQuestion[] {
  return dbQuestions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    options: q.options as QuizOption[],
    category: q.category,
  }));
}
