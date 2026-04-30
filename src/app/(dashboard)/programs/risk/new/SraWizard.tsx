// src/app/(dashboard)/programs/risk/new/SraWizard.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeSraAction, saveSraDraftAction } from "../actions";
import { CITATIONS } from "@/lib/regulations/citations";

// Auto-save debounce. Long enough to coalesce rapid radio clicks /
// keystrokes in the notes textarea, short enough that a user who walks
// away with one answer entered loses at most a second of work.
const AUTOSAVE_DEBOUNCE_MS = 800;

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
  ADMINISTRATIVE: `Administrative safeguards (${CITATIONS.HIPAA_ADMIN_SAFEGUARDS.code})`,
  PHYSICAL: `Physical safeguards (${CITATIONS.HIPAA_PHYSICAL_SAFEGUARDS.code})`,
  TECHNICAL: `Technical safeguards (${CITATIONS.HIPAA_TECHNICAL_SAFEGUARDS.code})`,
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

  // Refs that the debounced auto-save effect closes over. Using refs
  // (instead of including stepIdx in the effect's dep array) avoids
  // re-firing the timer on every step transition — handleNext/Back
  // already persist synchronously, and we don't want a stale closure
  // saving the prior step after the user has moved on.
  const stepIdxRef = useRef(stepIdx);
  useEffect(() => {
    stepIdxRef.current = stepIdx;
  }, [stepIdx]);

  // Tracks whether the user has actually edited an answer or note.
  // Initial-state hydration also writes to state (via useState
  // initializer); without this guard, the very first render would
  // queue a draft-save burning an SRA_DRAFT_SAVED event for nothing.
  const hasUserEditedRef = useRef(false);

  // Pending autosave timer — also used by step-transition handlers to
  // cancel any queued save before they fire their own synchronous one.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentCategory = steps[stepIdx]!;
  const stepQuestions = useMemo(
    () => questions.filter((q) => q.category === currentCategory),
    [questions, currentCategory],
  );

  const setAnswer = (code: string, val: Answer) => {
    hasUserEditedRef.current = true;
    setAnswers((p) => ({ ...p, [code]: val }));
  };
  const setNote = (code: string, val: string) => {
    hasUserEditedRef.current = true;
    setNotes((p) => ({ ...p, [code]: val }));
  };

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

  // Debounced auto-save — fires AUTOSAVE_DEBOUNCE_MS after the user
  // stops changing answers/notes. Audit item #4 (2026-04-29): without
  // this, a user who answers Q1 + types a note + closes the tab loses
  // both because the previous implementation only saved on step
  // transition. Step-transition handlers below cancel any pending
  // timer so we don't double-save.
  const cancelPendingAutoSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!hasUserEditedRef.current) return;
    if (Object.keys(answers).length === 0) return;
    cancelPendingAutoSave();
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistDraft(stepIdxRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
    return cancelPendingAutoSave;
    // The effect intentionally watches answers + notes only. stepIdx
    // is read via stepIdxRef (always current) and persistDraft closes
    // over the latest answers/notes via React's render-time scoping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, notes]);

  const handleNext = () => {
    setError(null);
    if (!allAnsweredOnStep) {
      setError("Answer every question in this step before moving on.");
      return;
    }
    cancelPendingAutoSave();
    const nextIdx = Math.min(stepIdx + 1, steps.length - 1);
    // Optimistically advance; draft-save happens in background. Any save
    // failure surfaces via setError but doesn't block navigation — the
    // user can click Next again to retry.
    setStepIdx(nextIdx);
    void persistDraft(nextIdx);
  };

  const handleBack = () => {
    setError(null);
    cancelPendingAutoSave();
    const prevIdx = Math.max(stepIdx - 1, 0);
    setStepIdx(prevIdx);
    void persistDraft(prevIdx);
  };

  const handleSaveAndExit = () => {
    setError(null);
    cancelPendingAutoSave();
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
    cancelPendingAutoSave();
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
            {stepQuestions.map((q, i) => {
              const descId = `q-${q.code}-desc`;
              const notesId = `q-${q.code}-notes`;
              return (
                <li key={q.code} className="space-y-2 border-l-2 border-border pl-4">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {q.subcategory}
                    </p>
                    <p id={`q-${q.code}-title`} className="text-sm font-medium text-foreground">
                      {i + 1}. {q.title}
                    </p>
                    <p id={descId} className="text-xs text-muted-foreground">
                      {q.description}
                    </p>
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
                  <div
                    role="radiogroup"
                    aria-labelledby={`q-${q.code}-title`}
                    aria-describedby={descId}
                    className="flex flex-wrap gap-2"
                  >
                    {ANSWER_OPTIONS.map((opt) => {
                      const selected = answers[q.code] === opt.value;
                      const inputId = `q-${q.code}-${opt.value}`;
                      return (
                        <label
                          key={opt.value}
                          htmlFor={inputId}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-accent"
                              : "border-border hover:bg-accent/50"
                          }`}
                        >
                          <input
                            id={inputId}
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
                  <label htmlFor={notesId} className="sr-only">
                    Notes for question {i + 1}: {q.title}
                  </label>
                  <textarea
                    id={notesId}
                    rows={2}
                    placeholder="Optional notes (evidence location, exceptions, remediation plan)"
                    value={notes[q.code] ?? ""}
                    onChange={(e) => setNote(q.code, e.target.value)}
                    aria-describedby={`${notesId}-phi-hint`}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                  />
                  {/*
                    Audit #21 HIPAA M-8 (2026-04-30): SRA notes flow
                    into the immutable EventLog via 800ms autosave —
                    once written, the row cannot be redacted. Warn
                    against PHI here so users describe evidence
                    *locations* rather than paste patient identifiers.
                  */}
                  <p
                    id={`${notesId}-phi-hint`}
                    className="text-[11px] text-muted-foreground"
                  >
                    Do not include patient names, MRNs, DOBs, or other PHI.
                    Notes are stored in the immutable audit log.
                  </p>
                </li>
              );
            })}
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
