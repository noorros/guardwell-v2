// src/app/(dashboard)/programs/risk/new/SraWizard.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeSraAction } from "../actions";

type Answer = "YES" | "NO" | "PARTIAL" | "NA";
type Category = "ADMINISTRATIVE" | "PHYSICAL" | "TECHNICAL";

export interface SraWizardQuestion {
  code: string;
  category: Category;
  subcategory: string;
  title: string;
  description: string;
  guidance: string | null;
  lookFor: string[];
}

export interface SraWizardProps {
  questions: SraWizardQuestion[];
}

const STEP_LABEL: Record<Category, string> = {
  ADMINISTRATIVE: "Administrative safeguards (§164.308)",
  PHYSICAL: "Physical safeguards (§164.310)",
  TECHNICAL: "Technical safeguards (§164.312)",
};

const ANSWER_OPTIONS: { value: Answer; label: string }[] = [
  { value: "YES", label: "Yes — addressed" },
  { value: "PARTIAL", label: "Partial" },
  { value: "NO", label: "No — gap" },
  { value: "NA", label: "N/A" },
];

export function SraWizard({ questions }: SraWizardProps) {
  const steps: Category[] = ["ADMINISTRATIVE", "PHYSICAL", "TECHNICAL"];
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const currentCategory = steps[stepIdx]!;
  const stepQuestions = useMemo(
    () => questions.filter((q) => q.category === currentCategory),
    [questions, currentCategory],
  );

  const setAnswer = (code: string, val: Answer) =>
    setAnswers((p) => ({ ...p, [code]: val }));
  const setNote = (code: string, val: string) =>
    setNotes((p) => ({ ...p, [code]: val }));

  const allAnsweredOnStep = stepQuestions.every((q) => answers[q.code]);
  const totalAnswered = Object.keys(answers).length;

  const handleNext = () => {
    setError(null);
    if (!allAnsweredOnStep) {
      setError("Answer every question in this step before moving on.");
      return;
    }
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  };

  const handleBack = () => {
    setError(null);
    setStepIdx((i) => Math.max(i - 1, 0));
  };

  const handleSubmit = () => {
    setError(null);
    if (!allAnsweredOnStep) {
      setError("Answer every question in this step before submitting.");
      return;
    }
    if (totalAnswered < questions.length) {
      setError(
        `${questions.length - totalAnswered} questions still need answers in earlier steps.`,
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await completeSraAction({
          answers: questions.map((q) => ({
            questionCode: q.code,
            answer: answers[q.code]!,
            notes: notes[q.code]?.trim() || null,
          })),
        });
        router.push(`/programs/risk/${res.assessmentId}` as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submission failed");
      }
    });
  };

  const isLastStep = stepIdx === steps.length - 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Step {stepIdx + 1} of {steps.length}: {STEP_LABEL[currentCategory]}
            </h2>
            <Badge variant="secondary" className="text-[10px]">
              {totalAnswered} / {questions.length} answered
            </Badge>
          </div>
          <ol className="space-y-6">
            {stepQuestions.map((q, i) => (
              <li key={q.code} className="space-y-2 border-l-2 border-border pl-4">
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {q.subcategory}
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {i + 1}. {q.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{q.description}</p>
                </div>
                {q.lookFor.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      What auditors look for ({q.lookFor.length})
                    </summary>
                    <ul className="ml-5 mt-1 list-disc space-y-0.5 text-muted-foreground">
                      {q.lookFor.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  {ANSWER_OPTIONS.map((opt) => {
                    const selected = answers[q.code] === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                          selected
                            ? "border-primary bg-accent"
                            : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q-${q.code}`}
                          value={opt.value}
                          checked={selected}
                          onChange={() => setAnswer(q.code, opt.value)}
                          className="h-3.5 w-3.5"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
                <textarea
                  rows={2}
                  placeholder="Optional notes (evidence location, exceptions, remediation plan)"
                  value={notes[q.code] ?? ""}
                  onChange={(e) => setNote(q.code, e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                />
              </li>
            ))}
          </ol>
          {error && (
            <p className="mt-4 text-xs text-[color:var(--gw-color-at-risk)]">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="outline"
          onClick={handleBack}
          disabled={stepIdx === 0 || isPending}
        >
          Back
        </Button>
        {isLastStep ? (
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Submitting…" : "Submit SRA"}
          </Button>
        ) : (
          <Button size="sm" onClick={handleNext} disabled={isPending}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
