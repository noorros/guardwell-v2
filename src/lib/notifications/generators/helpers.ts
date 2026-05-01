// src/lib/notifications/generators/helpers.ts
//
// Shared helpers used by multiple per-generator files. Imports ONLY from
// types.ts (never from per-generator files) to avoid circular imports.

import type { Prisma } from "@prisma/client";
import { DAY_MS } from "./types";

export function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  // Math.floor (not Math.round) so "30.7 days until expiry" → 30, not 31.
  // Combined with "days <= milestone" matching in the renewal generators,
  // this makes milestone firing deterministic regardless of when the cron
  // runs within the boundary day. Without floor, a delayed/retried cron
  // straddling a milestone day could fire twice (saved by entityKey
  // dedup) OR skip the milestone entirely. Audit #21 Credentials IM-7.
  return Math.floor((date.getTime() - Date.now()) / DAY_MS);
}

/**
 * Returns the ISO 8601 week number ("01"-"53") for a date as a zero-padded
 * 2-char string. Used by the absence-based generators (phishing, backup,
 * destruction) for year-week dedup entityKeys so a stale practice gets
 * exactly one nudge per week, not one per digest run.
 *
 * Algorithm: Thursday of the week determines the week's year (per ISO 8601).
 */
export function getIsoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return weekNum.toString().padStart(2, "0");
}

/**
 * Helper: load OWNER + ADMIN PracticeUser.userIds for a practice. Used by
 * generators whose recipients are admins-only (not all members).
 */
export async function ownerAdminUserIds(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<string[]> {
  const rows = await tx.practiceUser.findMany({
    where: {
      practiceId,
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
