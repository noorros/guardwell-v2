// src/lib/notifications/run-digest-weekly.ts
//
// Phase 7 PR 7 — weekly notification digest runner.
//
// Mirrors run-digest.ts (the daily runner) but with weekly semantics:
//
//   * Window = last 7 days (vs 1 day for daily).
//   * Per-user filter = effective cadence === "WEEKLY" (DAILY/INSTANT/NONE
//     users are skipped — DAILY runs in the daily cron, INSTANT events
//     fire in real time via firePerEventNotification, NONE means opted
//     out entirely).
//   * Body = AI-composed summary + topAction (via composeWeeklyDigest)
//     plus an itemized list of the underlying notifications.
//
// Like the daily runner, this is idempotent: notifications already
// marked sentViaEmailAt are not re-sent. We DO still email WEEKLY users
// even when they have zero new items in the window — composeWeeklyDigest
// handles the "quiet week" case explicitly so users get a steady
// touchpoint and so the absence-of-mail isn't ambiguous.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, type EmailSection } from "@/lib/email/template";
import { composeWeeklyDigest } from "./compose-weekly-digest";
import { getEffectivePreferences } from "./preferences";
import type { NotificationWeeklyDigestInput } from "@/lib/ai/prompts/notificationWeeklyDigest";
import type { Notification } from "@prisma/client";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export interface WeeklyDigestRunSummary {
  practicesScanned: number;
  weeklyDigestsAttempted: number;
  weeklyDigestsDelivered: number;
  errors: Array<{ practiceId?: string; userId?: string; message: string }>;
}

export async function runWeeklyNotificationDigest(): Promise<WeeklyDigestRunSummary> {
  const summary: WeeklyDigestRunSummary = {
    practicesScanned: 0,
    weeklyDigestsAttempted: 0,
    weeklyDigestsDelivered: 0,
    errors: [],
  };

  const practices = await db.practice.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
    },
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const practice of practices) {
    summary.practicesScanned += 1;
    try {
      const members = await db.practiceUser.findMany({
        where: { practiceId: practice.id, removedAt: null },
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, email: true } },
        },
      });
      if (members.length === 0) continue;

      // Pre-batch the per-user NotificationPreference rows in one query
      // instead of N findUnique calls inside the loop. Mirrors the
      // pattern in run-digest.ts (the daily runner). A user with no row
      // yet falls through to getEffectivePreferences(null), which uses
      // the documented defaults.
      const memberUserIds = members.map((m) => m.userId);
      const prefRows = await db.notificationPreference.findMany({
        where: { userId: { in: memberUserIds } },
      });
      const memberPrefs = new Map(prefRows.map((p) => [p.userId, p]));

      for (const m of members) {
        try {
          const pref = memberPrefs.get(m.userId) ?? null;
          const effective = getEffectivePreferences(pref);

          if (effective.cadence !== "WEEKLY") continue;
          if (!effective.digestEnabled) continue;
          if (!effective.emailEnabled) continue;

          // Pull the last 7 days of unread notifications. Sent-but-unread
          // items are intentionally excluded (sentViaEmailAt set) so we
          // don't repeat ourselves week-over-week if a user lets the
          // inbox sit.
          const recent = await db.notification.findMany({
            where: {
              userId: m.userId,
              practiceId: practice.id,
              readAt: null,
              sentViaEmailAt: null,
              createdAt: { gte: sevenDaysAgo },
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          });

          const composeInput: NotificationWeeklyDigestInput = {
            practiceName: practice.name,
            userRole: m.role,
            notifications: recent.map((n) => ({
              title: n.title,
              severity: n.severity as "INFO" | "WARNING" | "CRITICAL",
              type: n.type,
              body: n.body,
            })),
            // Score delta wiring is deferred — the prompt accepts null
            // and the AI handles its absence gracefully. Adding a real
            // weekly-score-snapshot table is a separate PR.
            scoreChange: null,
          };

          const composed = await composeWeeklyDigest(composeInput, {
            practiceId: practice.id,
            actorUserId: m.userId,
          });

          const rendered = renderWeeklyDigestEmail({
            practiceName: practice.name,
            summary: composed.summary,
            topAction: composed.topAction,
            notifications: recent,
            baseUrl,
          });

          summary.weeklyDigestsAttempted += 1;
          const result = await sendEmail({
            to: m.user.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          });
          if (result.delivered) {
            summary.weeklyDigestsDelivered += 1;
            if (recent.length > 0) {
              await db.notification.updateMany({
                where: {
                  id: { in: recent.map((n) => n.id) },
                  sentViaEmailAt: null,
                },
                data: { sentViaEmailAt: new Date() },
              });
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push({
            practiceId: practice.id,
            userId: m.userId,
            message,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ practiceId: practice.id, message });
    }
  }

  return summary;
}

function renderWeeklyDigestEmail(input: {
  practiceName: string;
  summary: string;
  topAction: string | null;
  notifications: Notification[];
  baseUrl: string;
}): { subject: string; text: string; html: string } {
  const { practiceName, summary, topAction, notifications, baseUrl } = input;
  const total = notifications.length;
  const trimBase = baseUrl.replace(/\/$/, "");

  const sorted = [...notifications].sort((a, b) => {
    const bySev =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (bySev !== 0) return bySev;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  const critical = sorted.filter((n) => n.severity === "CRITICAL");
  const warning = sorted.filter((n) => n.severity === "WARNING");
  const info = sorted.filter((n) => n.severity === "INFO");

  const subject =
    total === 0
      ? `Weekly compliance digest — ${practiceName}`
      : critical.length > 0
        ? `[CRITICAL · ${practiceName}] ${critical.length} compliance item${critical.length === 1 ? "" : "s"} need attention`
        : `Weekly compliance digest — ${practiceName}`;

  // ===== Plain-text body =====
  const sectionFor = (label: string, list: Notification[]) => {
    if (list.length === 0) return "";
    const rows = list
      .map((n) => {
        const url = n.href ? `${trimBase}${n.href}` : null;
        return `  • ${n.title}\n    ${n.body}${url ? `\n    → ${url}` : ""}`;
      })
      .join("\n\n");
    return `\n${label} (${list.length})\n${"-".repeat(label.length + list.length.toString().length + 3)}\n\n${rows}\n`;
  };

  const textParts: string[] = [
    `Weekly compliance digest for ${practiceName}`,
    ``,
    summary,
  ];
  if (topAction) {
    textParts.push(``, `Top action this week: ${topAction}`);
  }
  if (total > 0) {
    textParts.push(
      ``,
      sectionFor("Critical", critical),
      sectionFor("Warnings", warning),
      sectionFor("Informational", info),
    );
  }
  textParts.push(
    ``,
    `View overview: ${trimBase}/audit/overview`,
    `Notification preferences: ${trimBase}/settings/notifications`,
    ``,
    `— GuardWell`,
  );
  const text = textParts.filter((p) => p !== "").join("\n");

  // ===== HTML body =====
  const htmlSectionFor = (
    label: string,
    list: Notification[],
  ): EmailSection | null => {
    if (list.length === 0) return null;
    const rows = list
      .map((n) => {
        const hrefAttr = n.href ? `${trimBase}${escapeAttr(n.href)}` : null;
        const titleHtml = hrefAttr
          ? `<a href="${hrefAttr}" style="color: #1E293B; text-decoration: none;"><strong>${escapeHtml(n.title)}</strong></a>`
          : `<strong>${escapeHtml(n.title)}</strong>`;
        return `<li style="margin: 0 0 10px; padding: 0;">${titleHtml}<br /><span style="color: #64748B;">${escapeHtml(n.body)}</span></li>`;
      })
      .join("");
    return {
      label: `${label} (${list.length})`,
      html: `<ul style="list-style: none; margin: 0; padding: 0;">${rows}</ul>`,
    };
  };

  const sections: EmailSection[] = [
    { label: "This week", html: `<p style="margin: 0;">${escapeHtml(summary)}</p>` },
  ];
  if (topAction) {
    sections.push({
      label: "Top action",
      html: `<p style="margin: 0;"><strong>${escapeHtml(topAction)}</strong></p>`,
    });
  }
  for (const s of [
    htmlSectionFor("Critical", critical),
    htmlSectionFor("Warnings", warning),
    htmlSectionFor("Informational", info),
  ]) {
    if (s !== null) sections.push(s);
  }

  const headline =
    total === 0
      ? `Weekly compliance digest`
      : critical.length > 0
        ? `${critical.length} critical item${critical.length === 1 ? "" : "s"} need attention`
        : `Weekly compliance digest`;
  const subheadline =
    total === 0
      ? `No new items this week.`
      : `You have ${total} item${total === 1 ? "" : "s"} from the past 7 days.`;

  const html = renderEmailHtml({
    preheader:
      total === 0
        ? `No new items for ${practiceName} this week.`
        : `${total} item${total === 1 ? "" : "s"} from the past 7 days at ${practiceName}.`,
    headline,
    subheadline,
    accent: critical.length > 0 ? "critical" : undefined,
    sections,
    cta: {
      label: "View overview",
      href: `${trimBase}/audit/overview`,
    },
    secondaryLinks: [
      {
        label: "Notification preferences",
        href: `${trimBase}/settings/notifications`,
      },
    ],
    practiceName,
    baseUrl,
  });

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
