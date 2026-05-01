// src/app/(dashboard)/settings/reminders/actions.ts
//
// Phase 7 PR 8 — server action for /settings/reminders. Mirrors the
// pure-helper-plus-server-wrapper split used by
// settings/practice/actions.ts so the integration tests can exercise
// handleSaveReminderSettings directly without a Firebase cookie.
//
// Auth: requireRole("ADMIN") — OWNER also passes (role hierarchy).
// Audit trail: PRACTICE_REMINDER_SETTINGS_UPDATED v1 carrying
// changedCategories + before/after JSON snapshots so reviewers can
// reconstruct prior state from the EventLog alone.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeReminderSettingsUpdated } from "@/lib/events/projections/practiceReminderSettings";
import {
  DEFAULT_LEAD_TIMES,
  type LeadTimeCategory,
} from "@/lib/notifications/leadTimes";

// Each category accepts up to 10 milestones, each 1..1825 days. 1825
// maps to a five-year early warning so CMS Medicare/Medicaid 5-year
// revalidation can have a 1-year-out (or earlier) milestone; 1 is the
// same-day final nudge before a deadline. Empty array semantics: drop
// the override for that category and use DEFAULT_LEAD_TIMES instead.
const MilestoneArray = z.array(z.number().int().min(1).max(1825)).max(10);

const ReminderSettingsSchema = z.object({
  credentials: MilestoneArray.optional(),
  training: MilestoneArray.optional(),
  trainingExpiring: MilestoneArray.optional(),
  policies: MilestoneArray.optional(),
  policyReview: MilestoneArray.optional(),
  baa: MilestoneArray.optional(),
  incidents: MilestoneArray.optional(),
  deaInventory: MilestoneArray.optional(),
  cmsEnrollment: MilestoneArray.optional(),
});

const SaveInput = z.object({
  reminderSettings: ReminderSettingsSchema,
});

export type SaveReminderSettingsInput = z.infer<typeof SaveInput>;
export type SaveReminderSettingsResult =
  | { ok: true; changedCategories: string[] }
  | { ok: false; error: string };

/**
 * Pure helper invoked by both the server action wrapper and the
 * integration test suite. Caller resolves the {practiceId, actorUserId}
 * ctx + the Zod-validated input.
 *
 * Idempotent on no-change submits: when nothing differs from the
 * existing column the helper returns `{ ok: true, changedCategories: []
 * }` WITHOUT writing an event — so re-saving the same form does not
 * pollute the audit trail with empty rows.
 *
 * Default-filtering: a user-submitted value that exactly matches
 * DEFAULT_LEAD_TIMES for that category is dropped from the persisted
 * JSON. Semantic: "missing key in JSON = follow current defaults; key
 * present = explicit override". Without this filter, the form (which
 * always submits all 9 categories) would pin a practice to today's
 * defaults forever — future tweaks to DEFAULT_LEAD_TIMES would silently
 * not propagate to that practice. Empty arrays are also dropped (same
 * "use defaults" semantic).
 */
export async function handleSaveReminderSettings(
  ctx: { practiceId: string; actorUserId: string },
  input: SaveReminderSettingsInput,
): Promise<SaveReminderSettingsResult> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  // Filter the input down to true overrides — values that differ from
  // DEFAULT_LEAD_TIMES. Empty arrays are also dropped (same semantic:
  // "use defaults"). The resulting object is what we persist + diff
  // against the existing column.
  const filteredOverrides: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(parsed.data.reminderSettings)) {
    if (!value || value.length === 0) continue;
    const defaults = DEFAULT_LEAD_TIMES[key as LeadTimeCategory];
    const matchesDefault =
      Array.isArray(defaults) &&
      value.length === defaults.length &&
      value.every((v, i) => v === defaults[i]);
    if (matchesDefault) continue;
    filteredOverrides[key] = value;
  }

  const before = await db.practice.findUnique({
    where: { id: ctx.practiceId },
    select: { reminderSettings: true },
  });
  const beforeJson = (before?.reminderSettings ?? null) as Record<
    string,
    number[] | undefined
  > | null;

  // Diff filteredOverrides against beforeJson. A category being cleared
  // (previously overridden, now matches defaults / dropped) IS a change
  // — we want it in changedCategories so the audit row reflects it.
  const allKeys = new Set<string>([
    ...Object.keys(filteredOverrides),
    ...Object.keys(beforeJson ?? {}),
  ]);
  const changedCategories: string[] = [];
  for (const key of allKeys) {
    const oldValue = beforeJson?.[key];
    const newValue = filteredOverrides[key];
    // JSON.stringify treats undefined and missing keys identically, so
    // "category absent" vs "category set to []" both diff against an
    // existing override correctly.
    if (
      JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null)
    ) {
      changedCategories.push(key);
    }
  }

  // Idempotent on no-change submits: nothing differs from the existing
  // column. Skip event + skip projection write so re-saving an unchanged
  // form doesn't pollute the audit trail.
  if (changedCategories.length === 0) {
    return { ok: true, changedCategories: [] };
  }

  // afterJson is null when filteredOverrides is empty — represents
  // "follow defaults across the board" in the audit trail.
  const afterJson =
    Object.keys(filteredOverrides).length > 0 ? filteredOverrides : null;

  await appendEventAndApply(
    {
      practiceId: ctx.practiceId,
      actorUserId: ctx.actorUserId,
      type: "PRACTICE_REMINDER_SETTINGS_UPDATED",
      payload: {
        changedCategories,
        beforeJson: beforeJson ?? null,
        afterJson,
      },
    },
    async (tx) =>
      projectPracticeReminderSettingsUpdated(tx, {
        practiceId: ctx.practiceId,
        actorUserId: ctx.actorUserId,
        payload: {
          changedCategories,
          beforeJson: beforeJson ?? null,
          afterJson,
        },
      }),
  );

  return { ok: true, changedCategories };
}

export async function saveReminderSettingsAction(
  input: SaveReminderSettingsInput,
): Promise<SaveReminderSettingsResult> {
  const pu = await requireRole("ADMIN");
  const result = await handleSaveReminderSettings(
    { practiceId: pu.practiceId, actorUserId: pu.dbUser.id },
    input,
  );
  if (result.ok) {
    revalidatePath("/settings/reminders");
  }
  return result;
}
