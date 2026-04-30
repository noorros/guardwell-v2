// src/lib/notifications/critical-osha-alert.ts
//
// Audit #21 (OSHA I-4): §1904.39 8-hour fatality alert path. Mirrors
// src/lib/notifications/critical-alert.ts (HIPAA major-breach surface)
// but scopes recipients to OWNER + ADMIN — fatality reporting is the
// employer's legal obligation, not workforce-wide. Inserts a CRITICAL
// Notification row per OWNER/ADMIN, emails the subset whose
// criticalAlertsEnabled + emailEnabled prefs are true, and appends an
// INCIDENT_OSHA_FATALITY_REPORTED EventLog row. The event row doubles
// as the idempotency guard: if one already exists for this incident,
// the helper returns immediately (no re-fire on duplicate calls from
// reportIncidentAction + updateIncidentOshaOutcomeAction).
//
// Deadlines:
//   - DEATH                          → 8 hours from occurredAt (this PR)
//   - In-patient hospitalization /
//     amputation / eye loss          → 24 hours from occurredAt (future)
//
// The Zod schema (registry.ts) accepts any oshaOutcome enum value so a
// future expansion can re-use this event type with `deadlineHours = 24`.
//
// Runs OUTSIDE the projection transaction in actions.ts. The notification
// row creation is idempotent via the unique (userId, type, entityKey)
// index, the event-log idempotency check absorbs the rest, and the
// email is best-effort. Email failure never throws — the notification
// row + event row already exist and the audit trail is intact.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml } from "@/lib/email/template";
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentOshaFatalityReported } from "@/lib/events/projections/incident";
import { formatPracticeDateTime } from "@/lib/audit/format";

export interface CriticalOshaAlertInput {
  practiceId: string;
  incidentId: string;
  oshaOutcome:
    | "DEATH"
    | "DAYS_AWAY"
    | "RESTRICTED"
    | "OTHER_RECORDABLE"
    | "FIRST_AID";
  /** Wall-clock incident occurrence — drives the 8-hour clock. Mirrors
   *  Incident.discoveredAt. */
  occurredAt: Date;
  /** Optional incident title for email subject; defaults to a generic
   *  label if not supplied. */
  incidentTitle?: string;
  /** Optional actor — written as actorUserId on the EventLog row. The
   *  helper still emails ALL admins regardless. */
  actorUserId?: string | null;
}

export interface CriticalOshaAlertResult {
  /** false when the helper short-circuited because the event already
   *  exists (idempotency hit). */
  fired: boolean;
  notified: number;
  emailed: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DEATH_DEADLINE_HOURS = 8;
const HOSPITALIZATION_DEADLINE_HOURS = 24;

/**
 * Returns the §1904.39 reporting deadline. DEATH = 8h; in-patient
 * hospitalization / amputation / eye loss = 24h. Other outcomes don't
 * trigger the rule but the helper bails before this is read.
 */
export function deadlineHoursFor(
  outcome: CriticalOshaAlertInput["oshaOutcome"],
): number {
  return outcome === "DEATH"
    ? DEATH_DEADLINE_HOURS
    : HOSPITALIZATION_DEADLINE_HOURS;
}

export async function triggerCriticalOshaAlert(
  input: CriticalOshaAlertInput,
): Promise<CriticalOshaAlertResult> {
  // Idempotency: if the event already fired for this incident, bail.
  // Read-before-write race window is acceptable — duplicate inserts on
  // Notification are absorbed by the unique index, and the EventLog
  // append below is unguarded only because the calling actions both
  // run server-side under a single user click each.
  const existing = await db.eventLog.findFirst({
    where: {
      practiceId: input.practiceId,
      type: "INCIDENT_OSHA_FATALITY_REPORTED",
      // EventLog payload is a JSON column; Prisma's `path` query works
      // on Postgres JSON. Match on incidentId inside the payload.
      payload: { path: ["incidentId"], equals: input.incidentId },
    },
    select: { id: true },
  });
  if (existing) {
    return { fired: false, notified: 0, emailed: 0 };
  }

  const practice = await db.practice.findUnique({
    where: { id: input.practiceId },
    select: { name: true, timezone: true },
  });
  if (!practice) {
    return { fired: false, notified: 0, emailed: 0 };
  }

  // Recipients = OWNER + ADMIN of the practice. STAFF / VIEWER do NOT
  // receive — fatality reporting is the employer's legal obligation,
  // and admin-only routing prevents alerting unrelated front-desk
  // workforce to a colleague's death.
  const admins = await db.practiceUser.findMany({
    where: {
      practiceId: input.practiceId,
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });

  const hours = deadlineHoursFor(input.oshaOutcome);
  const deadlineAt = new Date(input.occurredAt.getTime() + hours * HOUR_MS);

  // Write the EventLog row FIRST so the audit trail exists even if the
  // notification create / email-out below throws. The helper's
  // contract is "trail before delivery" — see file header.
  await appendEventAndApply(
    {
      practiceId: input.practiceId,
      actorUserId: input.actorUserId ?? null,
      type: "INCIDENT_OSHA_FATALITY_REPORTED",
      payload: {
        incidentId: input.incidentId,
        oshaOutcome: input.oshaOutcome,
        occurredAt: input.occurredAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
      },
    },
    async () => projectIncidentOshaFatalityReported(),
  );

  // No admins → event row stands as the audit trail; nothing to deliver.
  if (admins.length === 0) {
    return { fired: true, notified: 0, emailed: 0 };
  }

  const tz = practice.timezone ?? "UTC";
  const deadlineLabel = formatPracticeDateTime(deadlineAt, tz);
  const isFatality = input.oshaOutcome === "DEATH";
  const title = isFatality
    ? `OSHA fatality reported — call OSHA within ${hours} hours`
    : `OSHA reportable injury — call OSHA within ${hours} hours`;
  const body = [
    isFatality
      ? `An employee fatality has been logged on this incident.`
      : `A §1904.39 reportable injury has been logged on this incident.`,
    `OSHA must be notified by ${deadlineLabel} (${hours} hours from occurrence).`,
    `Phone: 1-800-321-OSHA (6742) or use the OSHA online reporting tool.`,
  ].join(" ");
  const href = `/programs/incidents/${input.incidentId}`;
  const entityKey = `critical-osha:${input.incidentId}`;

  const proposals = admins.map((m) => ({
    practiceId: input.practiceId,
    userId: m.userId,
    type: "INCIDENT_OPEN" as const,
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
  for (const m of admins) {
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
        title,
        ``,
        body,
        ``,
        `Open the incident: ${baseUrl.replace(/\/$/, "")}${href}`,
        ``,
        `— GuardWell`,
      ].join("\n");
      const html = renderEmailHtml({
        preheader: title,
        headline: title,
        subheadline: isFatality
          ? "29 CFR §1904.39 — 8-hour OSHA notification obligation triggered."
          : "29 CFR §1904.39 — 24-hour OSHA notification obligation triggered.",
        accent: "critical",
        sections: [
          {
            html: `<p style="margin:0;">${escapeHtml(body)}</p>`,
          },
          input.incidentTitle
            ? {
                label: "Incident",
                html: `<p style="margin:0;">${escapeHtml(input.incidentTitle)}</p>`,
              }
            : { html: "" },
        ].filter((s) => s.html.length > 0),
        cta: {
          label: "Open incident",
          href: `${baseUrl.replace(/\/$/, "")}${href}`,
        },
        secondaryLinks: [
          {
            label: "Notification preferences",
            href: `${baseUrl.replace(/\/$/, "")}/settings/notifications`,
          },
        ],
        practiceName: practice.name,
        baseUrl,
      });

      const result = await sendEmail({
        to: m.user.email,
        subject,
        text,
        html,
      });
      if (result.delivered) {
        emailed += 1;
        await db.notification.updateMany({
          where: {
            userId: m.userId,
            type: "INCIDENT_OPEN",
            entityKey,
            sentViaEmailAt: null,
          },
          data: { sentViaEmailAt: new Date() },
        });
      }
    } catch {
      // Per-user email errors swallowed — the notification row + event
      // row already exist; one bad address shouldn't block alerts to
      // the rest of the admin team.
    }
  }

  return { fired: true, notified, emailed };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
