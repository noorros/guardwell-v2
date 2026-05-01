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
// on every run. The alert remains in DB so the UI surfaces it when an
// admin joins later, but no email will fire — known blind spot. If we
// need to backfill emails on admin-join, the right fix is a separate
// post-join sweep, NOT removing the stamp here (which would unbound the
// global scan against admin-less practices). A console.warn below makes
// this observable so ops can detect the case.

import { db } from "@/lib/db";
import type { NotificationSeverity } from "@prisma/client";
import {
  REGULATORY_TO_NOTIFICATION_SEVERITY,
  type Severity,
} from "./types";

const KNOWN_SEVERITIES = new Set<string>(
  Object.keys(REGULATORY_TO_NOTIFICATION_SEVERITY),
);

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
      // Only `title` is read in the loop body — `url` is on the
      // RegulatoryArticle row and unused here.
      article: { select: { title: true } },
      practice: {
        select: {
          // alert.practiceId is already on the alert row; we only need
          // the filtered practiceUsers list from this side.
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
        // Observable empty-recipients case — see file header comment.
        console.warn(
          `[regulatory:notify] alert ${alert.id} has no OWNER/ADMIN recipients on practice ${alert.practiceId}; stamping sentAt without sending email`,
        );
        await db.regulatoryAlert.update({
          where: { id: alert.id },
          data: { sentAt: new Date() },
        });
        continue;
      }

      const severity = mapSeverity(alert.id, alert.severity);
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

// alert.severity is a free-form String column upstream — Zod gates the
// AI output, but a manual DB write (or a future schema drift) could
// leak through. Log a warning so unexpected values are observable in
// Cloud Logging instead of silently downgrading to INFO.
function mapSeverity(
  alertId: string,
  raw: string,
): NotificationSeverity {
  if (KNOWN_SEVERITIES.has(raw)) {
    return REGULATORY_TO_NOTIFICATION_SEVERITY[raw as Severity];
  }
  console.warn(
    `[regulatory:notify] unexpected severity "${raw}" on alert ${alertId}, defaulting to INFO`,
  );
  return "INFO";
}
