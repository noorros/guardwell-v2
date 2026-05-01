// src/lib/notifications/generators/breachDeadline.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { ownerAdminUserIds } from "./helpers";

const BREACH_DETERMINATION_WINDOW_DAYS = 60;
const BREACH_DETERMINATION_REMIND_AFTER_DAYS = 50;

/**
 * HIPAA's 60-day breach-determination window is closing — fire when the
 * window has 10 or fewer days left (discoveredAt is between 50 and 60
 * days ago) AND the breach-determination wizard hasn't run yet. The
 * wizard atomically sets `isBreach` and `breachDeterminedAt` (see
 * src/lib/events/projections/incident.ts), so `isBreach: null` is the
 * "wizard not run" state — that's what this reminder targets. Recipients
 * are owners + admins. WARNING severity to surface urgency. NOTE: the
 * spec also mentioned the incident's `assigneeId`, but the schema
 * doesn't currently carry an assignee field on Incident; owners + admins
 * is the launch coverage and will be revisited if/when assignment ships.
 */
export async function generateBreachDeterminationDeadlineNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const now = Date.now();
  const windowEnd = new Date(now - BREACH_DETERMINATION_REMIND_AFTER_DAYS * DAY_MS);
  const windowStart = new Date(now - BREACH_DETERMINATION_WINDOW_DAYS * DAY_MS);

  const incidents = await tx.incident.findMany({
    where: {
      practiceId,
      // isBreach: null = breach-determination wizard hasn't run yet.
      // Once the wizard runs it sets isBreach=true|false AND breachDeterminedAt
      // atomically, exiting this reminder's target state.
      isBreach: null,
      resolvedAt: null,
      // discoveredAt > 60 days ago AND < 50 days ago = inside the window
      discoveredAt: { gt: windowStart, lt: windowEnd },
    },
    select: { id: true, title: true, discoveredAt: true },
  });

  const proposals: NotificationProposal[] = [];
  for (const inc of incidents) {
    const daysSince = Math.floor((now - inc.discoveredAt.getTime()) / DAY_MS);
    const daysLeft = Math.max(0, BREACH_DETERMINATION_WINDOW_DAYS - daysSince);
    const deadline = new Date(
      inc.discoveredAt.getTime() + BREACH_DETERMINATION_WINDOW_DAYS * DAY_MS,
    );
    const discoveredStr = formatPracticeDate(inc.discoveredAt, practiceTimezone);
    const deadlineStr = formatPracticeDate(deadline, practiceTimezone);
    const title = `Breach determination due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    const body = `Incident "${inc.title}" discovered ${discoveredStr} requires HIPAA breach determination by ${deadlineStr}. Complete the breach risk assessment.`;
    const entityKey = `breach-deadline:${inc.id}`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "BREACH_DETERMINATION_DEADLINE_APPROACHING" as NotificationType,
        severity: "WARNING" as NotificationSeverity,
        title,
        body,
        href: `/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}
