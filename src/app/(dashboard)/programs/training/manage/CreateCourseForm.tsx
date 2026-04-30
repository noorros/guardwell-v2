// src/app/(dashboard)/programs/training/manage/CreateCourseForm.tsx
//
// Phase 4 PR 4 — Dialog-hosted form for authoring a new custom training
// course. Mirrors the `CreateCustomCourseInput` Zod schema in
// /programs/training/actions.ts so the client validates the same
// shape the server validates; the server is still the source of
// truth (defense in depth).
//
// Audit-#12 ARIA pattern:
//   - Each quiz question is wrapped in <fieldset><legend>...</legend>
//   - Required inputs carry aria-required="true"
//   - Inputs that fail validation get aria-invalid + aria-describedby
//     pointing at the inline error <p id=...>
//   - The form itself uses aria-describedby to surface form-level errors

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCustomCourseAction } from "../actions";

interface QuestionDraft {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  // The order column is sequential per the Zod schema; we derive it
  // from array index at submit-time so the user doesn't have to manage
  // it manually as they add/remove questions.
}

const COURSE_TYPES = ["HIPAA", "OSHA", "OIG", "DEA", "CUSTOM"] as const;

const emptyQuestion = (): QuestionDraft => ({
  question: "",
  options: ["", ""],
  correctIndex: 0,
  explanation: "",
});

export interface CreateCourseFormProps {
  onSuccess: () => void;
}

export function CreateCourseForm({ onSuccess }: CreateCourseFormProps) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(COURSE_TYPES[0]);
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [passingScore, setPassingScore] = useState<string>("80");
  const [lessonContent, setLessonContent] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    emptyQuestion(),
  ]);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateQuestion(idx: number, patch: Partial<QuestionDraft>) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    );
  }
  function addQuestion() {
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }
  function removeQuestion(idx: number) {
    setQuestions((prev) => {
      if (prev.length === 1) return prev; // always keep ≥1
      return prev.filter((_, i) => i !== idx);
    });
  }
  function addOption(qIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx ? { ...q, options: [...q.options, ""] } : q,
      ),
    );
  }
  function removeOption(qIdx: number, optIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        if (q.options.length <= 2) return q; // min 2 options
        const nextOptions = q.options.filter((_, j) => j !== optIdx);
        // If we just removed the option that was marked correct, fall
        // back to index 0 so correctIndex never points past the array.
        const nextCorrect =
          q.correctIndex === optIdx
            ? 0
            : q.correctIndex > optIdx
              ? q.correctIndex - 1
              : q.correctIndex;
        return { ...q, options: nextOptions, correctIndex: nextCorrect };
      }),
    );
  }
  function updateOption(qIdx: number, optIdx: number, value: string) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx
          ? {
              ...q,
              options: q.options.map((o, j) => (j === optIdx ? value : o)),
            }
          : q,
      ),
    );
  }

  function validate(): string | null {
    if (!/^[A-Z0-9_]+$/.test(code)) {
      return "Code must be uppercase letters, digits, or underscore.";
    }
    if (code.length === 0 || code.length > 30) {
      return "Code is required (max 30 characters).";
    }
    if (title.trim().length === 0 || title.length > 200) {
      return "Title is required (max 200 characters).";
    }
    if (type.trim().length === 0 || type.length > 40) {
      return "Type is required (max 40 characters).";
    }
    const passing = Number.parseInt(passingScore, 10);
    if (!Number.isFinite(passing) || passing < 0 || passing > 100) {
      return "Passing score must be between 0 and 100.";
    }
    if (durationMinutes !== "") {
      const dur = Number.parseInt(durationMinutes, 10);
      if (!Number.isFinite(dur) || dur < 0 || dur > 600) {
        return "Duration must be 0–600 minutes (or blank).";
      }
    }
    if (lessonContent.length > 50_000) {
      return "Lesson content exceeds 50,000 characters.";
    }
    if (questions.length < 1) {
      return "Add at least one quiz question.";
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      if (q.question.trim().length === 0) {
        return `Question ${i + 1}: text is required.`;
      }
      if (q.options.length < 2 || q.options.length > 10) {
        return `Question ${i + 1}: between 2 and 10 options required.`;
      }
      for (let j = 0; j < q.options.length; j++) {
        if (q.options[j]!.trim().length === 0) {
          return `Question ${i + 1}, option ${j + 1}: text is required.`;
        }
      }
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        return `Question ${i + 1}: pick a correct answer.`;
      }
    }
    return null;
  }

  function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      try {
        await createCustomCourseAction({
          code,
          title,
          type,
          durationMinutes:
            durationMinutes === ""
              ? null
              : Number.parseInt(durationMinutes, 10),
          passingScore: Number.parseInt(passingScore, 10),
          lessonContent,
          quizQuestions: questions.map((q, i) => ({
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation:
              q.explanation.trim().length === 0 ? null : q.explanation,
            order: i + 1,
          })),
        });
        onSuccess();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create course",
        );
      }
    });
  }

  const formErrorId = "create-course-form-error";

  return (
    <form
      onSubmit={handleSubmit}
      aria-describedby={error ? formErrorId : undefined}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="cc-code"
          label="Code"
          required
          value={code}
          onChange={(v) =>
            setCode(v.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
          }
          hint="Uppercase letters, digits, underscore. Max 30 chars."
          error={
            error?.toLowerCase().includes("code") ? error : null
          }
        />
        <Field
          id="cc-title"
          label="Title"
          required
          value={title}
          onChange={setTitle}
          maxLength={200}
        />
        <div className="space-y-1">
          <label
            htmlFor="cc-type"
            className="block text-xs font-medium text-foreground"
          >
            Type{" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="cc-type"
            required
            aria-required="true"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {COURSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Field
          id="cc-duration"
          label="Duration (min, optional)"
          required={false}
          type="number"
          value={durationMinutes}
          onChange={setDurationMinutes}
          min={0}
          max={600}
        />
        <Field
          id="cc-passing"
          label="Passing score"
          required
          type="number"
          value={passingScore}
          onChange={setPassingScore}
          min={0}
          max={100}
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="cc-lesson"
          className="block text-xs font-medium text-foreground"
        >
          Lesson content (markdown){" "}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="cc-lesson"
          required
          aria-required="true"
          rows={6}
          value={lessonContent}
          onChange={(e) => setLessonContent(e.target.value)}
          className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Quiz questions</h3>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={addQuestion}
            disabled={questions.length >= 50}
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
            Add question
          </Button>
        </div>
        {questions.map((q, qIdx) => (
          <fieldset
            key={qIdx}
            className="space-y-2 rounded-md border p-3"
          >
            <legend className="px-1 text-xs font-medium">
              Question {qIdx + 1}
            </legend>
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <label
                  htmlFor={`cc-q-${qIdx}-text`}
                  className="block text-xs font-medium text-foreground"
                >
                  Prompt{" "}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  id={`cc-q-${qIdx}-text`}
                  required
                  aria-required="true"
                  rows={2}
                  value={q.question}
                  onChange={(e) =>
                    updateQuestion(qIdx, { question: e.target.value })
                  }
                  className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              {questions.length > 1 && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => removeQuestion(qIdx)}
                  aria-label={`Remove question ${qIdx + 1}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              )}
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium">
                Options (pick the correct one)
              </legend>
              {q.options.map((opt, optIdx) => (
                <div key={optIdx} className="flex items-center gap-2">
                  <input
                    id={`cc-q-${qIdx}-correct-${optIdx}`}
                    type="radio"
                    name={`cc-q-${qIdx}-correct`}
                    checked={q.correctIndex === optIdx}
                    onChange={() =>
                      updateQuestion(qIdx, { correctIndex: optIdx })
                    }
                    aria-label={`Mark option ${optIdx + 1} correct`}
                  />
                  <input
                    type="text"
                    required
                    aria-required="true"
                    aria-label={`Question ${qIdx + 1} option ${optIdx + 1}`}
                    value={opt}
                    onChange={(e) =>
                      updateOption(qIdx, optIdx, e.target.value)
                    }
                    className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                  />
                  {q.options.length > 2 && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => removeOption(qIdx, optIdx)}
                      aria-label={`Remove option ${optIdx + 1} from question ${qIdx + 1}`}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))}
              {q.options.length < 10 && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => addOption(qIdx)}
                >
                  <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                  Add option
                </Button>
              )}
            </fieldset>
            <div className="space-y-1">
              <label
                htmlFor={`cc-q-${qIdx}-explanation`}
                className="block text-xs font-medium text-foreground"
              >
                Explanation (optional)
              </label>
              <input
                id={`cc-q-${qIdx}-explanation`}
                type="text"
                value={q.explanation}
                onChange={(e) =>
                  updateQuestion(qIdx, { explanation: e.target.value })
                }
                className="block w-full rounded-md border bg-background px-2 py-1 text-sm"
              />
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <p
          id={formErrorId}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create course"}
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
  hint?: string;
  error?: string | null;
  min?: number;
  max?: number;
  maxLength?: number;
}

function Field({
  id,
  label,
  required,
  value,
  onChange,
  type = "text",
  hint,
  error,
  min,
  max,
  maxLength,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy =
    error && hintId
      ? `${errorId} ${hintId}`
      : error
        ? errorId
        : hintId;
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-foreground"
      >
        {label}
        {required && (
          <>
            {" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </>
        )}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        aria-required={required ? "true" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        maxLength={maxLength}
        className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      {hint && (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
