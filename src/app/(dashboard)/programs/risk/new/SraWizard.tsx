// src/app/(dashboard)/programs/risk/new/SraWizard.tsx
"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeSraAction, saveSraDraftAction } from "../actions";

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

export interface SraWizardInitialState {
  assessmentId: string;
  currentStep: number;
  answers: Record<string, Answer>;
  notes: Record<string, string>;
}

export interface SraWizardProps {
  questions: SraWizardQuestion[];
  /** If provided, the wizard resumes from this draft instead of starting fresh. */
  initialState?: SraWizardInitialState;
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

export function SraWizard({ questions, initialState }: SraWizardProps) {
  const steps: Category[] = ["ADMINISTRATIVE", "PHYSICAL", "TECHNICAL"];
  const [stepIdx, setStepIdx] = useState(initialState?.currentStep ?? 0);
  const [answers, setAnswers] = useState<Record<string, Answer>>(
    initialState?.answers ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    initialState?.notes ?? {},
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    initialState ? new Date() : null,
  );
  const assessmentIdRef = useRef<string | null>(initialState?.assessmentId ?? null);
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

  // Build the minimal answer payload — only questions the user has answered.
  const buildAnswerPayload = () =>
    questions
      .filter((q) => answers[q.code])
      .map((q) => ({
        questionCode: q.code,
        answer: answers[q.code]!,
        notes: notes[q.code]?.trim() || null,
      }));

  const persistDraft = async (nextStepIdx: number): Promise<boolean> => {
    // Nothing answered yet? No point burning a draft event.
    if (Object.keys(answers).length === 0) return true;
    setIsSavingDraft(true);
    try {
      const res = await saveSraDraftAction({
        assessmentId: assessmentIdRef.current ?? undefined,
        currentStep: nextStepIdx,
        answers: buildAnswerPayload(),
      });
      assessmentIdRef.current = res.assessmentId;
      setLastSavedAt(new Date());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-save failed");
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleNext = () => {
    setError(null);
    if (!allAnsweredOnStep) {
      setError("Answer every question in this step before moving on.");
      return;
    }
    const nextIdx = Math.min(stepIdx + 1, steps.length - 1);
    // Optimistically advance; draft-save happens in background. Any save
    // failure surfaces via setError but doesn't block navigation — the
    // user can click Next again to retry.
    setStepIdx(nextIdx);
    void persistDraft(nextIdx);
  };

  const handleBack = () => {
    setError(null);
    const prevIdx = Math.max(stepIdx - 1, 0);
    setStepIdx(prevIdx);
    void persistDraft(prevIdx);
  };

  const handleSaveAndExit = () => {
    setError(null);
    startTransition(async () => {
      const ok = await persistDraft(stepIdx);
      if (ok) {
        router.push("/programs/risk" as Route);
      }
    });
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
          assessmentId: assessmentIdRef.current ?? undefined,
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBack}
            disabled={stepIdx === 0 || isPending || isSavingDraft}
          >
            Back
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSaveAndExit}
            disabled={isPending || isSavingDraft || totalAnswered === 0}
          >
            Save and exit
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {isSavingDraft ? (
            <span className="text-[11px] text-muted-foreground">Saving draft…</span>
          ) : lastSavedAt ? (
            <span className="text-[11px] text-muted-foreground">
              Draft saved {formatDistance(lastSavedAt)}
            </span>
          ) : null}
          {isLastStep ? (
            <Button size="sm" onClick={handleSubmit} disabled={isPending || isSavingDraft}>
              {isPending ? "Submitting…" : "Submit SRA"}
            </Button>
          ) : (
            <Button size="sm" onClick={handleNext} disabled={isPending || isSavingDraft}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDistance(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 30_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}
