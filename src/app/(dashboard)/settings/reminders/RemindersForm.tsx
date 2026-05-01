// src/app/(dashboard)/settings/reminders/RemindersForm.tsx
//
// Phase 7 PR 8 — client form for editing per-category reminder lead-time
// milestones. One <fieldset> per LeadTimeCategory (9 total). Each input
// is a comma-separated string of integers; we parse on blur + on submit.
//
// Audit-#12 ARIA pattern:
//   - <fieldset> + <legend> wraps each category
//   - aria-required on every milestone input
//   - aria-invalid + aria-describedby pointing at an inline error <p id=...>
//     when validation fails
//   - Form-level error in role="alert" so screen readers announce it
//
// Validation:
//   - Comma-separated string -> number[] of integers in [1, 1825]
//   - 1825 (~5 years) is the upper bound so CMS Medicare/Medicaid 5-year
//     revalidation can have a 1-year-out (or earlier) milestone.
//   - Empty input is valid (means "use DEFAULT_LEAD_TIMES for this category")
//   - Server-side Zod schema enforces the same bounds (defense in depth)

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { saveReminderSettingsAction } from "./actions";
import {
  DEFAULT_LEAD_TIMES,
  type LeadTimeCategory,
} from "@/lib/notifications/leadTimes";

interface CategoryDefinition {
  key: LeadTimeCategory;
  label: string;
  description: string;
}

// Order is the order users see in the form. Keep grouped by lifecycle
// area: credentials family first, then training, then policies, then
// vendor/BAA, then incidents/safety, then DEA, then CMS.
const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    key: "credentials",
    label: "Credential renewal",
    description:
      "Alerts before licenses, board certs, DEA registration, etc. expire.",
  },
  {
    key: "training",
    label: "Training due-soon",
    description: "Alerts before assigned training due dates.",
  },
  {
    key: "trainingExpiring",
    label: "Training expiring",
    description:
      "Alerts before completed training certifications expire (e.g. annual HIPAA).",
  },
  {
    key: "policies",
    label: "Policy acknowledgment",
    description:
      "Alerts about policy versions staff have not yet acknowledged.",
  },
  {
    key: "policyReview",
    label: "Policy annual review",
    description:
      "Alerts before a practice policy is due for its annual review by leadership.",
  },
  {
    key: "baa",
    label: "Vendor BAA",
    description: "Alerts before a Business Associate Agreement expires.",
  },
  {
    key: "incidents",
    label: "Incident deadlines",
    description:
      "Alerts before a 60-day breach determination or notification deadline.",
  },
  {
    key: "deaInventory",
    label: "DEA biennial inventory",
    description:
      "Alerts before the 24-month controlled-substance inventory is due.",
  },
  {
    key: "cmsEnrollment",
    label: "CMS enrollment renewal",
    description:
      "Alerts before Medicare/Medicaid revalidation deadlines (5-year cycle).",
  },
];

type ValuesState = Record<LeadTimeCategory, string>;
type ErrorsState = Partial<Record<LeadTimeCategory, string>>;

export interface RemindersFormProps {
  /** Practice.reminderSettings JSON column (or null when no overrides). */
  initialSettings: unknown;
}

/** Comma-separated string -> number[]. Empty/whitespace returns []. */
function parseMilestones(input: string): number[] | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const result: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n)) return null;
    if (n < 1 || n > 1825) return null;
    result.push(n);
  }
  return result;
}

function defaultValueString(key: LeadTimeCategory): string {
  return DEFAULT_LEAD_TIMES[key].join(", ");
}

function initialValueString(
  key: LeadTimeCategory,
  initial: Record<string, number[] | undefined> | null,
): string {
  const override = initial?.[key];
  if (Array.isArray(override) && override.length > 0) {
    return override.join(", ");
  }
  // No override saved (or saved as empty) — show the defaults so the
  // user understands what schedule is in effect.
  return defaultValueString(key);
}

export function RemindersForm({ initialSettings }: RemindersFormProps) {
  const initial = initialSettings as Record<string, number[] | undefined> | null;
  const [values, setValues] = useState<ValuesState>(() =>
    Object.fromEntries(
      CATEGORY_DEFINITIONS.map((c) => [c.key, initialValueString(c.key, initial)]),
    ) as ValuesState,
  );
  const [errors, setErrors] = useState<ErrorsState>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formErrorId = "reminders-form-error";

  function setCategoryValue(key: LeadTimeCategory, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear the per-category error as the user types — they'll get a
    // fresh validation pass on submit.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
    setNotice(null);
  }

  function resetCategoryToDefault(key: LeadTimeCategory) {
    setCategoryValue(key, defaultValueString(key));
  }

  function validateAll(): { errors: ErrorsState; parsed: Record<LeadTimeCategory, number[]> } | null {
    const newErrors: ErrorsState = {};
    const parsed: Partial<Record<LeadTimeCategory, number[]>> = {};
    for (const c of CATEGORY_DEFINITIONS) {
      const result = parseMilestones(values[c.key]);
      if (result === null) {
        newErrors[c.key] =
          "Use comma-separated whole numbers between 1 and 1825 (~5 years), e.g. 90, 60, 30, 7.";
        continue;
      }
      // De-dup and sort descending so submitted state is canonical.
      const deduped = Array.from(new Set(result)).sort((a, b) => b - a);
      parsed[c.key] = deduped;
    }
    if (Object.keys(newErrors).length > 0) {
      return { errors: newErrors, parsed: {} as Record<LeadTimeCategory, number[]> };
    }
    return { errors: {}, parsed: parsed as Record<LeadTimeCategory, number[]> };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const validation = validateAll();
    if (!validation) {
      setFormError("Fix the errors above and try again.");
      return;
    }
    if (Object.keys(validation.errors).length > 0) {
      setErrors(validation.errors);
      setFormError("Fix the errors above and try again.");
      return;
    }
    setErrors({});
    // Build the payload: send EVERY category. The server filters out
    // entries that exactly match DEFAULT_LEAD_TIMES (semantic: missing
    // key in JSON = "follow current defaults"; explicit value =
    // "override"). So a user clicking Save without editing anything
    // ends up with reminderSettings === null in the column, not pinned
    // to today's defaults forever. The server then diffs the filtered
    // overrides against the existing row to avoid logging empty events.
    const reminderSettings: Record<LeadTimeCategory, number[]> = validation.parsed;
    startTransition(async () => {
      try {
        const result = await saveReminderSettingsAction({ reminderSettings });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        if (result.changedCategories.length === 0) {
          setNotice("No changes to save.");
        } else {
          setNotice(
            `Saved. Updated ${result.changedCategories.length} categor${result.changedCategories.length === 1 ? "y" : "ies"}.`,
          );
        }
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
      noValidate
      aria-describedby={formError ? formErrorId : undefined}
    >
      <div className="space-y-4">
        {CATEGORY_DEFINITIONS.map((c) => {
          const inputId = `rem-${c.key}-input`;
          const descId = `rem-${c.key}-desc`;
          const errorId = `rem-${c.key}-error`;
          const hasError = Boolean(errors[c.key]);
          return (
            <fieldset
              key={c.key}
              className="space-y-2 rounded-md border border-border p-4"
            >
              <legend className="px-1 text-sm font-semibold text-foreground">
                {c.label}
              </legend>
              <p id={descId} className="text-xs text-muted-foreground">
                {c.description} Default: {defaultValueString(c.key)} days.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor={inputId}
                    className="block text-xs font-medium text-foreground"
                  >
                    Milestones (days before deadline)
                  </label>
                  <input
                    id={inputId}
                    name={c.key}
                    type="text"
                    inputMode="numeric"
                    value={values[c.key]}
                    onChange={(e) => setCategoryValue(c.key, e.target.value)}
                    aria-required="true"
                    aria-invalid={hasError ? true : undefined}
                    aria-describedby={
                      hasError ? `${descId} ${errorId}` : descId
                    }
                    placeholder={defaultValueString(c.key)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  {hasError && (
                    <p
                      id={errorId}
                      className="text-[11px] text-[color:var(--gw-color-risk)]"
                    >
                      {errors[c.key]}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => resetCategoryToDefault(c.key)}
                  className="sm:mt-5"
                >
                  Reset to defaults
                </Button>
              </div>
            </fieldset>
          );
        })}
      </div>

      {formError && (
        <p
          id={formErrorId}
          role="alert"
          className="text-sm text-[color:var(--gw-color-risk)]"
        >
          {formError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save reminders"}
        </Button>
        {notice && (
          <span
            role="status"
            className="text-xs text-[color:var(--gw-color-compliant)]"
          >
            {notice}
          </span>
        )}
      </div>
    </form>
  );
}
