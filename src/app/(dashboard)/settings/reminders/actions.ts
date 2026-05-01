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

// Each category accepts up to 10 milestones, each 1..365 days. 365 maps
// to a one-year early warning (e.g. for credentials with multi-year
// renewal cycles); 1 is the same-day final nudge before a deadline.
// Empty array semantics: drop the override for that category and use
// DEFAULT_LEAD_TIMES instead.
const MilestoneArray = z.array(z.number().int().min(1).max(365)).max(10);

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
 */
export async function handleSaveReminderSettings(
  ctx: { practiceId: string; actorUserId: string },
  input: SaveReminderSettingsInput,
): Promise<SaveReminderSettingsResult> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const { reminderSettings: after } = parsed.data;

  const before = await db.practice.findUnique({
    where: { id: ctx.practiceId },
    select: { reminderSettings: true },
  });
  const beforeJson = (before?.reminderSettings ?? null) as Record<
    string,
    number[] | undefined
  > | null;

  const changedCategories: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    const oldValue = beforeJson?.[key];
    // JSON.stringify treats undefined and missing keys identically, so
    // "category absent" vs "category set to []" both diff against an
    // existing override correctly.
    if (JSON.stringify(oldValue ?? null) !== JSON.stringify(value ?? null)) {
      changedCategories.push(key);
    }
  }

  if (changedCategories.length === 0) {
    return { ok: true, changedCategories: [] };
  }

  await appendEventAndApply(
    {
      practiceId: ctx.practiceId,
      actorUserId: ctx.actorUserId,
      type: "PRACTICE_REMINDER_SETTINGS_UPDATED",
      payload: {
        changedCategories,
        beforeJson: beforeJson ?? null,
        afterJson: after,
      },
    },
    async (tx) =>
      projectPracticeReminderSettingsUpdated(tx, {
        practiceId: ctx.practiceId,
        actorUserId: ctx.actorUserId,
        payload: {
          changedCategories,
          beforeJson: beforeJson ?? null,
          afterJson: after,
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
