// src/lib/notifications/critical-alert.ts
//
// Same-day critical alert helper. Called immediately after an event
// that warrants a "don't wait for the weekly digest" notification —
// the only current trigger is a positive breach determination. Creates
// CRITICAL notification rows for every practice member whose
// criticalAlertsEnabled preference is true, and fires a single-item
// email per user whose emailEnabled preference is true.
//
// Runs OUTSIDE the projection transaction: notification row creation
// is idempotent via the unique (userId, type, entityKey) index, and
// the email is best-effort. Failure to email never throws — the row
// still shows in the inbox.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";

export interface CriticalBreachAlertInput {
  practiceId: string;
  incidentId: string;
  incidentTitle: string;
  affectedCount: number;
  overallRiskScore: number;
  discoveredAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OCR_WINDOW_DAYS = 60;
const MAJOR_BREACH_THRESHOLD = 500;

export async function emitCriticalBreachAlert(
  input: CriticalBreachAlertInput,
): Promise<{ notified: number; emailed: number }> {
  const practice = await db.practice.findUnique({
    where: { id: input.practiceId },
    select: { name: true },
  });
  if (!practice) return { notified: 0, emailed: 0 };

  const members = await db.practiceUser.findMany({
    where: { practiceId: input.practiceId, removedAt: null },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (members.length === 0) return { notified: 0, emailed: 0 };

  const daysSinceDiscovery = Math.max(
    0,
    Math.floor((Date.now() - input.discoveredAt.getTime()) / DAY_MS),
  );
  const daysLeft = Math.max(0, OCR_WINDOW_DAYS - daysSinceDiscovery);
  const isMajor = input.affectedCount >= MAJOR_BREACH_THRESHOLD;
  const title = isMajor
    ? `Major breach determined — ${input.affectedCount.toLocaleString("en-US")} affected`
    : `Breach determined — HHS notification required`;
  const body = [
    `"${input.incidentTitle}" has been classified as a reportable HIPAA breach (risk score ${input.overallRiskScore}/100, ${input.affectedCount} affected).`,
    isMajor
      ? `HHS Office for Civil Rights + media notice are required within ${daysLeft} days.`
      : `HHS OCR notification is required within ${daysLeft} days.`,
  ].join(" ");
  const href = `/programs/incidents/${input.incidentId}`;
  // Tie the notification to the incident id so multiple breach-determined
  // cycles on the same incident dedup — only one alert per incident per
  // user lives in the inbox at a time.
  const entityKey = `critical-breach:${input.incidentId}`;

  // Idempotent insert — unique index (userId, type, entityKey) absorbs
  // duplicate calls when this helper is re-run.
  const proposals = members.map((m) => ({
    practiceId: input.practiceId,
    userId: m.userId,
    type: "INCIDENT_BREACH_UNRESOLVED" as const,
    severity: "CRITICAL" as const,
    title,
    body,
    href,
    entityKey,
  }));
  const { count: notified } = await db.notification.createMany({
    data: proposals,
    skipDuplicates: true,
  });

  // Email the subset that wants critical alerts + email. Preferences
  // default true when no row exists for the user.
  let emailed = 0;
  for (const m of members) {
    try {
      const prefs = await db.notificationPreference.findUnique({
        where: { userId: m.userId },
      });
      const criticalAlertsEnabled = prefs?.criticalAlertsEnabled ?? true;
      const emailEnabled = prefs?.emailEnabled ?? true;
      if (!criticalAlertsEnabled || !emailEnabled) continue;

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
      const subject = `[CRITICAL · ${practice.name}] ${title}`;
      const text = [
        `${title}`,
        ``,
        body,
        ``,
        `Open the incident: ${baseUrl.replace(/\/$/, "")}${href}`,
        ``,
        `— GuardWell`,
      ].join("\n");

      const result = await sendEmail({
        to: m.user.email,
        subject,
        text,
      });
      if (result.delivered) {
        emailed += 1;
        // Mark these rows as emailed so the weekly digest doesn't
        // re-send the same alert.
        await db.notification.updateMany({
          where: {
            userId: m.userId,
            type: "INCIDENT_BREACH_UNRESOLVED",
            entityKey,
            sentViaEmailAt: null,
          },
          data: { sentViaEmailAt: new Date() },
        });
      }
    } catch {
      // Swallow per-user email errors — the notification row already
      // exists; we don't want one user's bad address to block alerts to
      // everyone else on the practice.
    }
  }

  return { notified, emailed };
}
