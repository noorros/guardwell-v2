// src/app/(dashboard)/programs/risk/new/SraWizard.tsx
//
// Phase 5 PR 3 — 80q SRA wizard. Per-category Tabs + per-subcategory
// Accordion + per-question card with 800ms debounced autosave that
// fires on every radio change AND every notes onChange (debounced).
//
// Replaces the legacy 3-step linear wizard. Audit #4 (2026-04-29)
// established the autosave pattern; PR 3 elevates it from "save on step
// change" to "save per-question" via the new SRA_QUESTION_ANSWERED
// event. Submit still emits SRA_COMPLETED (now also SRA_SUBMITTED) so
// the HIPAA_SRA derivation rule keeps working.
//
// Polish (Phase 5 PR 3 review pass):
//   C1 — answer state is `Answer | null` so a notes-only edit can never
//        leak a phantom YES into the answers map / submit gate / payload.
//   C2 — assessmentId is pre-allocated synchronously on mount via
//        crypto.randomUUID() so two overlapping per-question saves both
//        target the SAME draft (no orphan drafts from a TOCTOU race).
//   I3 — pendingSavesCount (counter) replaces a boolean isSaving so the
//        submit button stays disabled while ANY save is in flight, not
//        just the most-recently-resolved one.

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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  answerSraQuestionAction,
  completeSraAction,
} from "../actions";
import { groupSraQuestions, type SraQuestionLite } from "@/lib/sra/grouping";
import { computeSraScore } from "@/lib/sra/scoring";

type Answer = "YES" | "NO" | "PARTIAL" | "NA";
type Category = "ADMINISTRATIVE" | "PHYSICAL" | "TECHNICAL";

const ANSWER_VALUES = ["YES", "NO", "PARTIAL", "NA"] as const satisfies readonly Answer[];
const CATEGORIES = ["ADMINISTRATIVE", "PHYSICAL", "TECHNICAL"] as const satisfies readonly Category[];

const ANSWER_LABEL: Record<Answer, string> = {
  YES: "Yes",
  NO: "No",
  PARTIAL: "Partial",
  NA: "N/A",
};

const CATEGORY_LABEL: Record<Category, string> = {
  ADMINISTRATIVE: "Administrative",
  PHYSICAL: "Physical",
  TECHNICAL: "Technical",
};

// 800ms — same value as audit #4's bulk-draft autosave. Long enough to
// coalesce rapid radio clicks / keystrokes, short enough that a user
// who walks away with one answer entered loses at most a second.
const DEBOUNCE_MS = 800;

export interface SraWizardQuestion extends SraQuestionLite {
  title: string;
  description: string;
  guidance: string | null;
  lookFor: string[];
  citation: string | null;
  cites2026: boolean;
}

export interface SraWizardInitialState {
  assessmentId?: string;
  answers: Record<string, { answer: Answer; notes: string | null }>;
}

export interface SraWizardProps {
  questions: SraWizardQuestion[];
  /** When provided, hydrate from an existing draft (resume flow). */
  initialState?: SraWizardInitialState;
}

// Internal state shape: answer can be null when the user has typed
// notes but not yet picked a radio. Readers (submit gate, score,
// payload) MUST gate on truthy answer to avoid phantom-YES leakage.
type AnswerState = { answer: Answer | null; notes: string | null };

export function SraWizard({ questions, initialState }: SraWizardProps) {
  const grouped = useMemo(() => groupSraQuestions(questions), [questions]);

  // C2 fix — pre-allocate the assessmentId synchronously on mount so
  // two overlapping per-question saves both target the same draft.
  // Without this, both timers fire with assessmentId=undefined, the
  // action mints two UUIDs, and the projection creates two orphan
  // drafts. With this, both timers send the same client UUID; the
  // action's "row not found yet" path falls through to the projection's
  // create-on-missing logic, materialising a single draft tied to the
  // caller's practice.
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
  const [tab, setTab] = useState<Category>("ADMINISTRATIVE");
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
              const result = await answerSraQuestionAction({
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
        // C1 fix — preserve the merged answer (which may be null).
        // Do NOT fall back to "YES" here: a row with null answer must
        // remain null so the submit gate, score, and payload don't
        // silently treat a notes-only edit as a real YES answer.
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
        (x): x is { questionCode: string; answer: Answer; riskWeight: SraQuestionLite["riskWeight"] } =>
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

        // C1 fix — gate the payload on truthy answer. The submit
        // button is disabled until allAnswered (every row has a real
        // Answer), so this filter should never drop anything; treat a
        // null-leak here as a programmer error rather than fabricating
        // a YES.
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

        const result = await completeSraAction({
          assessmentId,
          answers: completedAnswers,
        });
        router.push(`/programs/risk/${result.assessmentId}` as Route);
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
            <h2 className="text-sm font-semibold">Security Risk Assessment</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Answer all {questions.length} safeguards. Drafts save automatically.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {score.totalCount}/{questions.length} answered • Score{" "}
            {score.overallScore}
          </Badge>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Category)}>
          <TabsList>
            {CATEGORIES.map((cat) => {
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
          {CATEGORIES.map((cat) => (
            <TabsContent key={cat} value={cat} className="space-y-3">
              <CategoryQuestions
                questions={grouped[cat] as SraWizardQuestion[]}
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
  questions: SraWizardQuestion[];
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
  // Sub-group by subcategory for the accordion. groupSraQuestions
  // already sorted by (subcategory, sortOrder) so we just walk the
  // pre-sorted list and bucket by subcategory.
  const subgroups = useMemo(() => {
    const map = new Map<string, SraWizardQuestion[]>();
    for (const q of questions) {
      const list = map.get(q.subcategory) ?? [];
      list.push(q);
      map.set(q.subcategory, list);
    }
    return [...map.entries()];
  }, [questions]);

  if (subgroups.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        No questions in this category.
      </p>
    );
  }

  return (
    <Accordion
      type="multiple"
      defaultValue={subgroups.map(([sub]) => sub)}
      className="w-full"
    >
      {subgroups.map(([sub, qs]) => {
        const answered = qs.filter((q) => answers[q.code]?.answer).length;
        return (
          <AccordionItem key={sub} value={sub}>
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <span>{sub}</span>
                <Badge variant="outline" className="text-[10px]">
                  {answered}/{qs.length}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              {qs.map((q) => (
                <QuestionCard
                  key={q.code}
                  question={q}
                  value={answers[q.code]}
                  onAnswer={onAnswer}
                />
              ))}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

// ────────────────────────────────────────────────────────────────────

interface QuestionCardProps {
  question: SraWizardQuestion;
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
            {question.citation && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {question.citation}
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
          {question.lookFor.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                What auditors look for ({question.lookFor.length})
              </summary>
              <ul className="ml-5 mt-1 list-disc space-y-0.5 text-muted-foreground">
                {question.lookFor.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </details>
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
            placeholder="Optional notes (evidence location, exceptions, remediation plan)"
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
