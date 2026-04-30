"use client";

import { useState, useTransition, useRef } from "react";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { submitQuizAttemptAction } from "./actions";
import type { QuizReviewItem } from "./grade";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuizOption = { id: string; text: string };

/**
 * The shape of a question safe to ship to the client BEFORE submission.
 * Notably absent: `correctId` and `explanation` — those live only in
 * the DB and the server action's response (audit item #1, 2026-04-29).
 */
export interface ClientQuizQuestion {
  id: string;
  questionText: string;
  options: QuizOption[];
  category: string;
}

export interface QuizRunnerProps {
  attemptId: string;
  questions: ClientQuizQuestion[];
}

// ── Result types (from action) ────────────────────────────────────────────────

interface QuizResult {
  score: number;
  passed: boolean;
  /** Server-returned review entries — correct option text + explanation
   *  arrive only AFTER the user submits. */
  reviewItems: QuizReviewItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function categoryLabel(category: string): string {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Group questions by category
function groupByCategory(questions: ClientQuizQuestion[]): Array<{
  category: string;
  questions: ClientQuizQuestion[];
}> {
  const map = new Map<string, ClientQuizQuestion[]>();
  for (const q of questions) {
    const existing = map.get(q.category);
    if (existing) existing.push(q);
    else map.set(q.category, [q]);
  }
  return Array.from(map.entries()).map(([category, questions]) => ({
    category,
    questions,
  }));
}

// ── ResultPanel ───────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  questionsById,
  totalQuestions,
}: {
  result: QuizResult;
  questionsById: Map<string, ClientQuizQuestion>;
  totalQuestions: number;
}) {
  const correct = result.reviewItems.filter((r) => r.isCorrect).length;
  const incorrect = result.reviewItems.filter((r) => !r.isCorrect);

  return (
    <div className="space-y-6">
      {/* Score card */}
      <div className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-5xl font-bold tabular-nums">{result.score}%</p>
        <p className="text-sm text-muted-foreground">
          {correct} of {totalQuestions} correct
        </p>
        {result.passed ? (
          <Badge className="text-sm px-3 py-1 bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_15%,transparent)] text-[color:var(--gw-color-compliant)] border-[color:var(--gw-color-compliant)]">
            <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Passed
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-sm px-3 py-1">
            <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Not passed — retake required
          </Badge>
        )}
        {!result.passed && (
          <p className="text-xs text-muted-foreground">Passing score is 80%.</p>
        )}
      </div>

      {/* Take quiz again */}
      <div className="text-center">
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Take quiz again
        </Button>
      </div>

      {/* Incorrect answers review */}
      {incorrect.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            Review incorrect answers ({incorrect.length})
          </h2>
          <ul className="space-y-4">
            {incorrect.map((item) => {
              const question = questionsById.get(item.questionId);
              const yourAnswer = question?.options.find(
                (o) => o.id === item.selectedId,
              );
              return (
                <li
                  key={item.questionId}
                  className="rounded-lg border bg-card p-4 space-y-2"
                >
                  <p className="text-sm font-medium">
                    {question?.questionText ?? ""}
                  </p>
                  <div className="space-y-1">
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <XCircle
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        <span className="font-medium">Your answer:</span>{" "}
                        {yourAnswer?.text ?? "—"}
                      </span>
                    </p>
                    <p className="flex items-start gap-2 text-sm text-[color:var(--gw-color-compliant)]">
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        <span className="font-medium">Correct answer:</span>{" "}
                        {item.correctOption?.text ?? "—"}
                      </span>
                    </p>
                  </div>
                  {item.explanation && (
                    <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
                      {item.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {incorrect.length === 0 && result.passed && (
        <p className="text-center text-sm text-[color:var(--gw-color-compliant)]">
          <CheckCircle2 className="inline mr-1 h-4 w-4" aria-hidden="true" />
          Perfect score — every answer correct!
        </p>
      )}
    </div>
  );
}

// ── QuizRunner ────────────────────────────────────────────────────────────────

export function QuizRunner({ attemptId, questions }: QuizRunnerProps) {
  // answers: questionId → selectedOptionId
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const grouped = groupByCategory(questions);
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === questions.length;

  function handleSelect(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  function handleSubmit() {
    // Validate all answered
    const unanswered = questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) {
      setError(
        `Please answer all questions before submitting. ${unanswered.length} question${unanswered.length !== 1 ? "s" : ""} unanswered.`,
      );
      // Scroll to first unanswered
      const firstUnanswered = unanswered[0];
      const el = firstUnanswered
        ? document.getElementById(`question-${firstUnanswered.id}`)
        : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setError(null);

    const submittedAnswers = Object.entries(answers).map(([questionId, selectedId]) => ({
      questionId,
      selectedId,
    }));

    startTransition(async () => {
      try {
        const { score, passed, reviewItems } = await submitQuizAttemptAction({
          attemptId,
          answers: submittedAnswers,
        });
        setResult({ score, passed, reviewItems });
        // Scroll to top of page
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  // Show result panel after submission
  if (result) {
    const questionsById = new Map(questions.map((q) => [q.id, q]));
    return (
      <ResultPanel
        result={result}
        questionsById={questionsById}
        totalQuestions={questions.length}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {answeredCount} of {questions.length} answered
        </span>
        <span>{Math.round((answeredCount / questions.length) * 100)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-[color:var(--gw-color-compliant)] transition-all"
          style={{ width: `${(answeredCount / questions.length) * 100}%` }}
          aria-hidden="true"
        />
      </div>

      {/* Question form */}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-8"
      >
        {grouped.map(({ category, questions: groupQuestions }) => (
          <section key={category} className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
              {categoryLabel(category)}
            </h2>
            <div className="space-y-4">
              {groupQuestions.map((q, qIdx) => {
                const globalIdx = questions.findIndex((gq) => gq.id === q.id);
                const selected = answers[q.id];
                return (
                  <div
                    key={q.id}
                    id={`question-${q.id}`}
                    className={cn(
                      "rounded-lg border bg-card p-4 space-y-3 scroll-mt-4",
                      !selected && error ? "border-destructive/60" : "",
                    )}
                  >
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground font-normal mr-2">
                        {globalIdx + 1}.
                      </span>
                      {q.questionText}
                    </p>
                    <div className="space-y-2" role="radiogroup" aria-label={q.questionText}>
                      {q.options.map((opt) => {
                        const isSelected = selected === opt.id;
                        const inputId = `q-${q.id}-opt-${opt.id}`;
                        return (
                          <label
                            key={opt.id}
                            htmlFor={inputId}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "hover:bg-accent",
                            )}
                          >
                            <input
                              id={inputId}
                              type="radio"
                              name={`question-${q.id}`}
                              value={opt.id}
                              checked={isSelected}
                              onChange={() => handleSelect(q.id, opt.id)}
                              disabled={isPending}
                              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-primary"
                            />
                            <span>{opt.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Sticky submit footer */}
        <div className="sticky bottom-0 -mx-6 border-t bg-background/95 backdrop-blur px-6 py-4 space-y-2">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">
              {allAnswered
                ? "All questions answered — ready to submit."
                : `${questions.length - answeredCount} question${questions.length - answeredCount !== 1 ? "s" : ""} remaining`}
            </span>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Submitting…" : "Submit quiz"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
