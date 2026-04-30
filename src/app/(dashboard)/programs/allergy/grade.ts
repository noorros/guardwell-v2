// src/app/(dashboard)/programs/allergy/grade.ts
//
// Pure grading helper for the allergy competency quiz. Extracted from
// the server action so:
//   1. The action stays slim (just auth + event emission).
//   2. Tests can grade without the auth context.
//   3. The single source of truth for "correctId never reaches the
//      client BEFORE submission" lives here — the helper fetches the
//      answer key inside the request, never lets it onto the wire to
//      the page render path.
//
// Audit item #1 (2026-04-29): the previous implementation rendered
// `correctId` and `explanation` directly into the RSC payload, leaking
// the entire answer key to anyone who could View Source.

import type { Prisma, PrismaClient } from "@prisma/client";

type QuizOption = { id: string; text: string };

export interface QuizAnswerInput {
  questionId: string;
  selectedId: string;
}

export interface QuizReviewItem {
  questionId: string;
  selectedId: string;
  isCorrect: boolean;
  correctOption: QuizOption | null;
  explanation: string | null;
}

export interface AnnotatedAnswer {
  questionId: string;
  selectedId: string;
  isCorrect: boolean;
}

export interface GradeAllergyQuizAttemptResult {
  score: number;
  passed: boolean;
  correctAnswers: number;
  totalQuestions: number;
  /** Compact event-log payload — no answer-key text, just booleans. */
  annotated: AnnotatedAnswer[];
  /** Rich response for the post-submit review panel. */
  reviewItems: QuizReviewItem[];
}

const PASSING_SCORE = 80;

export async function gradeAllergyQuizAttempt(
  client: PrismaClient | Prisma.TransactionClient,
  input: { answers: QuizAnswerInput[] },
): Promise<GradeAllergyQuizAttemptResult> {
  const ids = input.answers.map((a) => a.questionId);
  const questions = await client.allergyQuizQuestion.findMany({
    where: { id: { in: ids } },
    select: { id: true, options: true, correctId: true, explanation: true },
  });

  const byId = new Map(questions.map((q) => [q.id, q]));

  let correctAnswers = 0;
  const annotated: AnnotatedAnswer[] = [];
  const reviewItems: QuizReviewItem[] = [];

  for (const a of input.answers) {
    const q = byId.get(a.questionId);
    const isCorrect = q?.correctId === a.selectedId;
    if (isCorrect) correctAnswers += 1;
    annotated.push({
      questionId: a.questionId,
      selectedId: a.selectedId,
      isCorrect,
    });
    const correctOption = q
      ? ((q.options as QuizOption[]).find((o) => o.id === q.correctId) ?? null)
      : null;
    reviewItems.push({
      questionId: a.questionId,
      selectedId: a.selectedId,
      isCorrect,
      correctOption,
      explanation: q?.explanation ?? null,
    });
  }

  const totalQuestions = input.answers.length;
  const score = totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 100);
  const passed = score >= PASSING_SCORE;

  return {
    score,
    passed,
    correctAnswers,
    totalQuestions,
    annotated,
    reviewItems,
  };
}
