// src/lib/notifications/generators/credential.ts

import type { Prisma, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { EXPIRING_SOON_DAYS } from "@/lib/credentials/status";
import { type NotificationProposal, DAY_MS } from "./types";
import { daysUntil } from "./helpers";

/**
 * Credentials expiring within EXPIRING_SOON_DAYS. One notification per
 * credential per holder. Entity key includes the credential id so a
 * renewed credential (new id) produces a fresh notification cycle.
 *
 * Audit #16: window now sourced from src/lib/credentials/status.ts so
 * the dashboard badge, the register PDF, and these notifications all
 * agree on the 90-day threshold (the page+Concierge had been showing
 * EXPIRING_SOON 30 days before the email even fired).
 */
export async function generateCredentialNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const horizon = new Date(Date.now() + EXPIRING_SOON_DAYS * DAY_MS);
  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { lte: horizon, gt: new Date(Date.now() - 30 * DAY_MS) },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      licenseNumber: true,
    },
  });
  const proposals: NotificationProposal[] = [];
  for (const c of credentials) {
    if (!c.expiryDate) continue;
    const daysLeft = daysUntil(c.expiryDate);
    if (daysLeft === null) continue;
    const severity: NotificationSeverity =
      daysLeft <= 0 ? "CRITICAL" : daysLeft <= 14 ? "WARNING" : "INFO";
    const title =
      daysLeft <= 0
        ? `${c.title} expired`
        : `${c.title} expires in ${daysLeft} days`;
    const body = `${c.title}${c.licenseNumber ? ` (${c.licenseNumber})` : ""} expires ${formatPracticeDate(c.expiryDate, practiceTimezone)}. Update /programs/credentials before it lapses.`;
    // entityKey is a UTC-stable dedup hash — do NOT replace with formatPracticeDate
    const entityKey = `credential:${c.id}:${c.expiryDate.toISOString().slice(0, 10)}`;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "CREDENTIAL_EXPIRING",
        severity,
        title,
        body,
        href: "/programs/credentials",
        entityKey,
      });
    }
  }
  return proposals;
}
