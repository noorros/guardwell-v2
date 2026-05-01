// src/lib/notifications/generators/incident.ts

import type { Prisma } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";

/**
 * Incidents that are open or under investigation and haven't had a
 * breach determination yet. Nudges the team to run the four-factor
 * analysis. One notification per incident per user.
 */
export async function generateIncidentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const openIncidents = await tx.incident.findMany({
    where: {
      practiceId,
      status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
      isBreach: null,
    },
    select: { id: true, title: true, discoveredAt: true },
  });
  const unresolvedBreaches = await tx.incident.findMany({
    where: {
      practiceId,
      isBreach: true,
      resolvedAt: null,
    },
    select: {
      id: true,
      title: true,
      discoveredAt: true,
      affectedCount: true,
    },
  });

  const proposals: NotificationProposal[] = [];
  for (const inc of openIncidents) {
    const daysOpen = Math.max(
      0,
      Math.floor((Date.now() - inc.discoveredAt.getTime()) / DAY_MS),
    );
    const entityKey = `incident-open:${inc.id}`;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "INCIDENT_OPEN",
        severity: daysOpen > 7 ? "WARNING" : "INFO",
        title: `Incident awaiting breach determination (${daysOpen}d open)`,
        body: `"${inc.title}" is still open. Run the HIPAA §164.402 four-factor analysis to classify.`,
        href: `/programs/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  for (const inc of unresolvedBreaches) {
    const daysOpen = Math.max(
      0,
      Math.floor((Date.now() - inc.discoveredAt.getTime()) / DAY_MS),
    );
    const deadlineDaysLeft = Math.max(0, 60 - daysOpen);
    const entityKey = `incident-breach:${inc.id}`;
    const isMajor = (inc.affectedCount ?? 0) >= 500;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "INCIDENT_BREACH_UNRESOLVED",
        severity: deadlineDaysLeft <= 7 ? "CRITICAL" : "WARNING",
        title: isMajor
          ? `Major breach unresolved — HHS notice in ${deadlineDaysLeft} days`
          : `Breach unresolved — HHS notice in ${deadlineDaysLeft} days`,
        body: `"${inc.title}" was determined a breach on ${formatPracticeDate(inc.discoveredAt, practiceTimezone)}. HHS OCR notification deadline is ${deadlineDaysLeft} days away. ${isMajor ? "Major-breach media notice is also required." : ""}`.trim(),
        href: `/programs/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}
