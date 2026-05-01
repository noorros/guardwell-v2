// src/lib/notifications/generators/welcome.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal, DAY_MS } from "./types";

// ---------------------------------------------------------------------------
// Phase 7 PR 5: welcome + system-broadcast generators
// ---------------------------------------------------------------------------
//
// generateWelcomeNotifications fires once per newly-added PracticeUser
// (joinedAt within the past day). entityKey scopes to PracticeUser.id so
// re-adding a user (new PracticeUser row, even if same userId) re-fires.
//
// generateSystemNotifications is a no-op stub for now. The
// SYSTEM_NOTIFICATION enum value is reserved for an admin-broadcast UI
// that lands in a future phase — wiring it into the fan-in here keeps
// the surface in lock-step with the enum definition.

/**
 * Welcome new PracticeUsers added in the last 24h. Single INFO-severity
 * row per user. The 1-day window is intentional — if the digest cron is
 * broken for >1d, missed welcome notifications stay missed (we'd rather
 * skip them than spam a now-week-old new hire). entityKey is keyed on
 * the PracticeUser.id (not userId) so a user who leaves and rejoins
 * gets a fresh welcome.
 */
export async function generateWelcomeNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const cutoff = new Date(Date.now() - DAY_MS);
  const newMembers = await tx.practiceUser.findMany({
    where: {
      practiceId,
      joinedAt: { gte: cutoff },
      removedAt: null,
    },
    select: { id: true, userId: true },
  });
  if (newMembers.length === 0) return [];

  return newMembers.map((m) => ({
    userId: m.userId,
    practiceId,
    type: "WELCOME" as NotificationType,
    severity: "INFO" as NotificationSeverity,
    title: "Welcome to GuardWell!",
    body: "We're glad to have you on the team. Visit your dashboard to see what compliance tasks are assigned to you.",
    href: "/dashboard",
    entityKey: `welcome:${m.id}`,
  }));
}
