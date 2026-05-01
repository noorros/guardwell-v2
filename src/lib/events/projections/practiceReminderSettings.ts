// src/lib/events/projections/practiceReminderSettings.ts
//
// Phase 7 PR 8 — projection for PRACTICE_REMINDER_SETTINGS_UPDATED v1.
// Writes Practice.reminderSettings to the new value (afterJson). The
// EventLog row carries the before/after snapshots so the audit trail
// can reconstruct the prior state without replaying every preceding
// settings event. Sibling helper to practiceProfileSettings.ts.
//
// Idempotent on replay — repeated applies of the same payload land the
// same JSON in the column. afterJson is allowed to be null (signals
// "clear all overrides, fall back to DEFAULT_LEAD_TIMES") so the column
// is unset rather than left with a stale partial override map.

import { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"PRACTICE_REMINDER_SETTINGS_UPDATED", 1>;

export async function projectPracticeReminderSettingsUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; actorUserId?: string | null; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Prisma Json columns require `Prisma.JsonNull` (DB NULL) for nullable
  // clear-the-column semantics; passing JS null wouldn't compile against
  // the InputJsonValue type. afterJson === null means "user cleared all
  // overrides, fall back to DEFAULT_LEAD_TIMES."
  const reminderSettings: Prisma.InputJsonValue | typeof Prisma.JsonNull =
    payload.afterJson === null
      ? Prisma.JsonNull
      : (payload.afterJson as Prisma.InputJsonValue);
  await tx.practice.update({
    where: { id: practiceId },
    data: { reminderSettings },
  });
}
