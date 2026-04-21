// src/app/(dashboard)/programs/training/[courseId]/QuizRunner.tsx
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { submitQuizAction, type QuizResult } from "../actions";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  order: number;
}

export interface QuizRunnerProps {
  courseId: string;
  passingScore: number;
  questions: QuizQuestion[];
}

export function QuizRunner({ courseId, passingScore, questions }: QuizRunnerProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allAnswered = questions.every((q) => answers[q.order] !== undefined);

  const handleSubmit = () => {
    setError(null);
    const sorted = [...questions].sort((a, b) => a.order - b.order);
    const answerArray = sorted.map((q) => answers[q.order] ?? -1);
    startTransition(async () => {
      try {
        const r = await submitQuizAction({ courseId, answers: answerArray });
        setResult(r);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Submission failed";
        setError(msg);
      }
    });
  };

  const handleRetake = () => {
    setResult(null);
    setAnswers({});
    setError(null);
  };

  if (result) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {result.passed ? "Passed" : "Not passed"}
            </h2>
            <Badge
              variant="secondary"
              style={{
                color: result.passed
                  ? "var(--gw-color-compliant)"
                  : "var(--gw-color-at-risk)",
                borderColor: result.passed
                  ? "var(--gw-color-compliant)"
                  : "var(--gw-color-at-risk)",
              }}
            >
              {result.score}%
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {result.correctCount} of {result.totalCount} correct. Passing score
            is {result.passingScore}%.
            {result.passed
              ? " Your HIPAA module score will update automatically."
              : " Review the lesson and retake when ready."}
          </p>
          <div className="flex gap-2">
            {!result.passed && (
              <Button size="sm" onClick={handleRetake}>
                Retake quiz
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...questions].sort((a, b) => a.order - b.order);
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quiz</h2>
          <p className="text-xs text-muted-foreground">
            {Object.keys(answers).length} of {questions.length} answered · pass {passingScore}%
          </p>
        </div>
        <ol className="space-y-5">
          {sorted.map((q, idx) => (
            <li key={q.id} className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {idx + 1}. {q.question}
              </p>
              <ul className="space-y-1">
                {q.options.map((opt, optIdx) => {
                  const selected = answers[q.order] === optIdx;
                  const inputId = `q-${q.order}-opt-${optIdx}`;
                  return (
                    <li key={optIdx}>
                      <label
                        htmlFor={inputId}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition-colors ${
                          selected
                            ? "border-primary bg-accent"
                            : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name={`q-${q.order}`}
                          value={optIdx}
                          checked={selected}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [q.order]: optIdx }))
                          }
                          className="mt-0.5"
                        />
                        <span className="flex-1">{opt}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
        {error && (
          <p className="text-sm text-[color:var(--gw-color-at-risk)]">{error}</p>
        )}
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!allAnswered || isPending}>
            {isPending ? "Submitting…" : "Submit quiz"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
