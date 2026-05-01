// src/lib/notifications/generators/sra.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { daysUntil } from "./helpers";

const SRA_OBLIGATION_DAYS = 365;
const SRA_WARNING_DAYS = 60; // Warn when SRA is within 60 days of expiry

/**
 * HIPAA_SRA is due / overdue. Warn 60 days before the 365-day wall, hit
 * CRITICAL once past.
 */
export async function generateSraNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const latest = await tx.practiceSraAssessment.findFirst({
    where: { practiceId, isDraft: false, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true, id: true },
  });
  if (!latest?.completedAt) {
    // No SRA ever — one-time nudge per user.
    return userIds.map((userId) => ({
      userId,
      practiceId,
      type: "SRA_DUE" as NotificationType,
      severity: "WARNING" as NotificationSeverity,
      title: "Complete your first Security Risk Assessment",
      body: "HIPAA §164.308(a)(1)(ii)(A) requires a documented Security Risk Assessment. Complete one to satisfy HIPAA_SRA.",
      href: "/programs/risk/new",
      entityKey: "none",
    }));
  }
  const dueDate = new Date(latest.completedAt.getTime() + SRA_OBLIGATION_DAYS * DAY_MS);
  const daysLeft = daysUntil(dueDate);
  if (daysLeft === null) return [];
  if (daysLeft > SRA_WARNING_DAYS) return [];

  const severity: NotificationSeverity = daysLeft <= 0 ? "CRITICAL" : "WARNING";
  const title =
    daysLeft <= 0
      ? "SRA is overdue — HIPAA_SRA flipped GAP"
      : `SRA expires in ${daysLeft} days`;
  const body =
    daysLeft <= 0
      ? `Your most recent Security Risk Assessment was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)} and is now past the 365-day obligation window. Run a fresh SRA to restore HIPAA_SRA compliance.`
      : `Your most recent SRA was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)}. Plan the next one — HIPAA_SRA flips GAP on ${formatPracticeDate(dueDate, practiceTimezone)}.`;

  // entityKey includes the source SRA id so a replacement SRA resets the
  // dedup and users get a fresh notification cycle for the new window.
  const entityKey = `sra:${latest.id}`;

  return userIds.map((userId) => ({
    userId,
    practiceId,
    type: "SRA_DUE" as NotificationType,
    severity,
    title,
    body,
    href: "/programs/risk",
    entityKey,
  }));
}
