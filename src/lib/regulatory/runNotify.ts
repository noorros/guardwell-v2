// src/lib/regulatory/runNotify.ts
//
// Phase 8 PR 5 — notify cron worker. Walks RegulatoryAlert rows that
// haven't been emailed yet (sentAt IS NULL, not dismissed) and creates
// one Notification per OWNER/ADMIN of the alert's practice. Stamps
// sentAt on the alert.
//
// Idempotency: Notifications dedup via the (userId, type, entityKey)
// unique constraint, so retries are safe — createMany skipDuplicates
// drops collisions silently. The entityKey scopes per-(alert, user) so
// two users on the same practice each get their own row but a re-run
// can never duplicate either.
//
// Empty-recipient handling: if a practice has zero OWNER/ADMIN
// PracticeUsers, we still stamp sentAt so the alert isn't re-scanned
// on every run (the global scan is bounded but unbounded growth of
// "abandoned" rows would slow the cron over time). The alert remains
// in DB for the UI when an admin joins later — the email channel is
// what we're satisfying here.

import { db } from "@/lib/db";
import type { NotificationSeverity } from "@prisma/client";

const SEVERITY_MAP: Record<string, NotificationSeverity> = {
  INFO: "INFO",
  ADVISORY: "WARNING",
  URGENT: "CRITICAL",
};

const NOTIFY_BATCH_LIMIT = 200;

export interface NotifyRunSummary {
  alertsScanned: number;
  notificationsCreated: number;
  errors: Array<{ alertId?: string; message: string }>;
}

export async function runRegulatoryNotify(): Promise<NotifyRunSummary> {
  const summary: NotifyRunSummary = {
    alertsScanned: 0,
    notificationsCreated: 0,
    errors: [],
  };

  const alerts = await db.regulatoryAlert.findMany({
    where: { sentAt: null, dismissedAt: null },
    include: {
      article: { select: { title: true, url: true } },
      practice: {
        select: {
          id: true,
          name: true,
          practiceUsers: {
            where: {
              role: { in: ["OWNER", "ADMIN"] },
              removedAt: null,
            },
            select: { userId: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: NOTIFY_BATCH_LIMIT,
  });

  for (const alert of alerts) {
    summary.alertsScanned += 1;
    try {
      const recipients = alert.practice.practiceUsers.map((p) => p.userId);
      if (recipients.length === 0) {
        // No OWNER/ADMIN to notify. Stamp sentAt anyway so we don't
        // re-scan this alert forever. The row stays in DB for the UI
        // when someone joins later — the email side is satisfied.
        await db.regulatoryAlert.update({
          where: { id: alert.id },
          data: { sentAt: new Date() },
        });
        continue;
      }

      const severity = SEVERITY_MAP[alert.severity] ?? "INFO";
      const title = `Regulatory alert: ${alert.article.title.slice(0, 100)}`;
      const body = alert.alertBody.slice(0, 5000);

      const proposals = recipients.map((userId) => ({
        practiceId: alert.practiceId,
        userId,
        type: "REGULATORY_ALERT" as const,
        severity,
        title,
        body,
        href: `/audit/regulatory/${alert.id}`,
        // entityKey scoped to (alertId, userId) so the unique constraint
        // (userId, type, entityKey) dedups idempotently across re-runs.
        entityKey: `regulatory-alert:${alert.id}:${userId}`,
      }));

      const result = await db.notification.createMany({
        data: proposals,
        skipDuplicates: true,
      });
      summary.notificationsCreated += result.count;

      await db.regulatoryAlert.update({
        where: { id: alert.id },
        data: { sentAt: new Date() },
      });
    } catch (err) {
      summary.errors.push({
        alertId: alert.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
