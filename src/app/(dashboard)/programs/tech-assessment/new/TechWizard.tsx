// src/app/(dashboard)/programs/tech-assessment/new/TechWizard.tsx
//
// Phase 5 PR 4 — 35q Technical Security Assessment wizard. Per-category
// Tabs + per-question card with 800ms debounced autosave that fires on
// every radio change AND every notes onChange (debounced).
//
// Structurally a sibling of SraWizard (PR 3) but simpler:
//   - 6 categories instead of 3 (no Accordion grouping needed)
//   - 35 questions instead of 80
//   - TechAssessmentQuestion has no `subcategory` field
//   - Reuses the SraAnswer enum (YES/NO/PARTIAL/NA) and computeSraScore
//
// Polish carried over from PR 3 (apply from start, not after review):
//   C1 — answer state is `Answer | null` so a notes-only edit can never
//        leak a phantom YES into the answers map / submit gate / payload.
//   C2 — assessmentId is pre-allocated synchronously on mount via
//        crypto.randomUUID() so two overlapping per-question saves both
//        target the SAME draft (no orphan drafts from a TOCTOU race).
//   I3 — pendingSavesCount (counter) replaces a boolean isSaving so the
//        submit button stays disabled while ANY save is in flight.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  answerTechQuestionAction,
  completeTechAssessmentAction,
} from "../actions";
import { computeSraScore } from "@/lib/sra/scoring";
import {
  ALL_TECH_CATEGORIES,
  type RiskWeight,
  type TechCategory,
} from "@/lib/risk/types";

type Answer = "YES" | "NO" | "PARTIAL" | "NA";

const ANSWER_VALUES = ["YES", "NO", "PARTIAL", "NA"] as const satisfies readonly Answer[];

const ANSWER_LABEL: Record<Answer, string> = {
  YES: "Yes",
  NO: "No",
  PARTIAL: "Partial",
  NA: "N/A",
};

const CATEGORY_LABEL: Record<TechCategory, string> = {
  NETWORK: "Network",
  ENDPOINT: "Endpoint",
  CLOUD: "Cloud",
  ACCESS: "Access",
  MONITORING: "Monitoring",
  BACKUP: "Backup",
};

// 800ms — same value as the SRA wizard. Long enough to coalesce rapid
// radio clicks / keystrokes, short enough that a user who walks away
// with one answer entered loses at most a second.
const DEBOUNCE_MS = 800;

export interface TechWizardQuestion {
  id: string;
  code: string;
  category: TechCategory;
  sortOrder: number;
  riskWeight: RiskWeight;
  title: string;
  description: string;
  guidance: string | null;
  sraQuestionCode: string | null;
}

export interface TechWizardInitialState {
  assessmentId?: string;
  answers: Record<string, { answer: Answer; notes: string | null }>;
}

export interface TechWizardProps {
  questions: TechWizardQuestion[];
  /** When provided, hydrate from an existing draft (resume flow). */
  initialState?: TechWizardInitialState;
}

// Internal state shape: answer can be null when the user has typed
// notes but not yet picked a radio. Readers (submit gate, score,
// payload) MUST gate on truthy answer to avoid phantom-YES leakage.
type AnswerState = { answer: Answer | null; notes: string | null };

export function TechWizard({ questions, initialState }: TechWizardProps) {
  // Group questions by category for the Tabs render. Stable sort by
  // sortOrder within each category (TechAssessmentQuestion has no
  // subcategory, so we don't need the SRA's two-level sort).
  const grouped = useMemo<Record<TechCategory, TechWizardQuestion[]>>(() => {
    const acc: Record<TechCategory, TechWizardQuestion[]> = {
      NETWORK: [],
      ENDPOINT: [],
      CLOUD: [],
      ACCESS: [],
      MONITORING: [],
      BACKUP: [],
    };
    const sorted = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const q of sorted) {
      acc[q.category].push(q);
    }
    return acc;
  }, [questions]);

  // C2 fix — pre-allocate the assessmentId synchronously on mount so
  // two overlapping per-question saves both target the same draft.
  const [assessmentId] = useState<string>(
    () => initialState?.assessmentId ?? crypto.randomUUID(),
  );

  const [answers, setAnswers] = useState<Record<string, AnswerState>>(
    initialState?.answers ?? {},
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // I3 fix — counter, not boolean, so concurrent saves are tracked
  // correctly. isSaving === pendingSavesCount > 0.
  const [pendingSavesCount, setPendingSavesCount] = useState(0);
  const isSaving = pendingSavesCount > 0;
  const [tab, setTab] = useState<TechCategory>("NETWORK");
  const router = useRouter();

  // Pending autosave timer per question code so each row has its own
  // independent debounce window.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Cleanup on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const debouncedSave = useCallback(
    (questionCode: string, payload: { answer: Answer; notes: string | null }) => {
      const existing = timersRef.current.get(questionCode);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        questionCode,
        setTimeout(() => {
          timersRef.current.delete(questionCode);
          setPendingSavesCount((n) => n + 1);
          void (async () => {
            try {
              const result = await answerTechQuestionAction({
                assessmentId,
                questionCode,
                answer: payload.answer,
                notes: payload.notes,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Save failed");
            } finally {
              setPendingSavesCount((n) => n - 1);
            }
          })();
        }, DEBOUNCE_MS),
      );
    },
    [assessmentId],
  );

  const setAnswer = useCallback(
    (
      code: string,
      patch: Partial<{ answer: Answer; notes: string | null }>,
    ) => {
      setAnswers((prev) => {
        const existing = prev[code];
        const merged: AnswerState = {
          answer: patch.answer ?? existing?.answer ?? null,
          notes: patch.notes !== undefined ? patch.notes : existing?.notes ?? null,
        };
        // Only autosave once an answer has been picked. A bare notes
        // edit before the first radio click is unusual but we still
        // queue a save so the typed text isn't lost on tab close.
        if (merged.answer) {
          debouncedSave(code, {
            answer: merged.answer,
            notes: merged.notes,
          });
        }
        // C1 fix — preserve the merged answer (which may be null). Do
        // NOT fall back to "YES" here.
        return {
          ...prev,
          [code]: merged,
        };
      });
    },
    [debouncedSave],
  );

  // Track only fully-answered questions (a row with notes but no
  // selected radio still counts as zero so progress + score don't lie).
  const answeredQuestions = useMemo(() => {
    return questions
      .map((q) => {
        const a = answers[q.code];
        if (!a?.answer) return null;
        return {
          questionCode: q.code,
          answer: a.answer,
          riskWeight: q.riskWeight,
        };
      })
      .filter(
        (x): x is { questionCode: string; answer: Answer; riskWeight: RiskWeight } =>
          x !== null,
      );
  }, [answers, questions]);

  const score = useMemo(() => computeSraScore(answeredQuestions), [
    answeredQuestions,
  ]);
  const allAnswered = score.totalCount === questions.length;

  const handleSubmit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        // Flush any in-flight debounced timers so the answers we ship
        // match what the user sees on screen.
        timersRef.current.forEach((t) => clearTimeout(t));
        timersRef.current.clear();

        // C1 fix — gate the payload on truthy answer. The submit button
        // is disabled until allAnswered, so this filter should never
        // drop anything; treat a null-leak as a programmer error rather
        // than fabricating a YES.
        const completedAnswers = questions.map((q) => {
          const a = answers[q.code];
          if (!a?.answer) {
            throw new Error(
              `Cannot submit: question ${q.code} has no answer. (Submit should have been disabled.)`,
            );
          }
          return {
            questionCode: q.code,
            answer: a.answer,
            notes: a.notes ?? null,
          };
        });

        const result = await completeTechAssessmentAction({
          assessmentId,
          answers: completedAnswers,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/programs/tech-assessment/${result.assessmentId}` as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submission failed");
      }
    });
  }, [answers, questions, router, assessmentId]);

  return (
    <Card>
      <CardContent className="space-y-4 pt-0">
        <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-4">
          <div>
            <h2 className="text-sm font-semibold">Technical Security Assessment</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Answer all {questions.length} controls. Drafts save automatically.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {score.totalCount}/{questions.length} answered • Score{" "}
            {score.overallScore}
          </Badge>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TechCategory)}>
          <TabsList>
            {ALL_TECH_CATEGORIES.map((cat) => {
              const total = grouped[cat].length;
              const answered = grouped[cat].filter(
                (q) => answers[q.code]?.answer,
              ).length;
              return (
                <TabsTrigger key={cat} value={cat}>
                  {CATEGORY_LABEL[cat]} ({answered}/{total})
                </TabsTrigger>
              );
            })}
          </TabsList>
          {ALL_TECH_CATEGORIES.map((cat) => (
            <TabsContent key={cat} value={cat} className="space-y-3">
              <CategoryQuestions
                questions={grouped[cat]}
                answers={answers}
                onAnswer={setAnswer}
              />
            </TabsContent>
          ))}
        </Tabs>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-[11px] text-muted-foreground">
            {`Draft id ${assessmentId.slice(0, 8)}…`}
            {isSaving ? " — saving…" : ""}
          </p>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allAnswered || isPending || isSaving}
          >
            {isPending ? "Submitting…" : "Submit assessment"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────

interface CategoryQuestionsProps {
  questions: TechWizardQuestion[];
  answers: Record<string, AnswerState>;
  onAnswer: (
    code: string,
    patch: Partial<{ answer: Answer; notes: string | null }>,
  ) => void;
}

function CategoryQuestions({
  questions,
  answers,
  onAnswer,
}: CategoryQuestionsProps) {
  if (questions.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        No questions in this category.
      </p>
    );
  }
  // Flat list — TechAssessmentQuestion has no `subcategory` so we don't
  // need an Accordion. Stack QuestionCards vertically.
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <QuestionCard
          key={q.code}
          question={q}
          value={answers[q.code]}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

interface QuestionCardProps {
  question: TechWizardQuestion;
  value: AnswerState | undefined;
  onAnswer: (
    code: string,
    patch: Partial<{ answer: Answer; notes: string | null }>,
  ) => void;
}

function QuestionCard({ question, value, onAnswer }: QuestionCardProps) {
  const titleId = `q-${question.code}-title`;
  const descId = `q-${question.code}-desc`;
  const notesId = `q-${question.code}-notes`;
  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p id={titleId} className="text-sm font-medium">
              {question.title}
            </p>
            {question.sraQuestionCode && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                Feeds {question.sraQuestionCode}
              </span>
            )}
          </div>
          <p id={descId} className="text-xs text-muted-foreground">
            {question.description}
          </p>
          {question.guidance && (
            <p className="text-[11px] italic text-muted-foreground">
              {question.guidance}
            </p>
          )}
        </div>

        <div
          role="radiogroup"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="flex flex-wrap gap-2"
        >
          {ANSWER_VALUES.map((a) => {
            const inputId = `q-${question.code}-${a}`;
            const selected = value?.answer === a;
            return (
              <label
                key={a}
                htmlFor={inputId}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  selected
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`q-${question.code}`}
                  value={a}
                  checked={selected}
                  onChange={() => onAnswer(question.code, { answer: a })}
                  className="h-3.5 w-3.5"
                />
                <span>{ANSWER_LABEL[a]}</span>
              </label>
            );
          })}
        </div>

        <div className="space-y-1">
          <label htmlFor={notesId} className="sr-only">
            Notes for {question.title}
          </label>
          <textarea
            id={notesId}
            rows={2}
            placeholder="Optional notes (vendor name, last review date, exceptions, remediation plan)"
            value={value?.notes ?? ""}
            onChange={(e) =>
              onAnswer(question.code, { notes: e.target.value })
            }
            aria-describedby={`${notesId}-phi-hint`}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <p
            id={`${notesId}-phi-hint`}
            className="text-[10px] text-muted-foreground"
          >
            Do not include patient names, MRNs, DOBs, or other PHI. Notes are
            stored in the immutable audit log.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
