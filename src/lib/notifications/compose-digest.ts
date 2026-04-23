// src/lib/notifications/compose-digest.ts
//
// Turns a user's current open notifications into a weekly digest email —
// both plain-text fallback and HTML body for rendering clients.

import type { Notification, Practice } from "@prisma/client";
import { renderEmailHtml, type EmailSection } from "@/lib/email/template";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export function composeDigestEmail(input: {
  practice: Pick<Practice, "name">;
  recipientEmail: string;
  notifications: Notification[];
  baseUrl: string;
}): { subject: string; text: string; html: string } | null {
  const { practice, notifications, baseUrl } = input;
  if (notifications.length === 0) return null;

  // Sort CRITICAL → WARNING → INFO, then newest first within each band.
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
    critical.length > 0
      ? `[CRITICAL · ${practice.name}] ${critical.length} compliance item${critical.length === 1 ? "" : "s"} need attention`
      : `Weekly compliance digest — ${practice.name}`;

  const sectionFor = (label: string, list: Notification[]) => {
    if (list.length === 0) return "";
    const rows = list
      .map((n) => {
        const url = n.href
          ? `${baseUrl.replace(/\/$/, "")}${n.href}`
          : null;
        return `  • ${n.title}\n    ${n.body}${url ? `\n    → ${url}` : ""}`;
      })
      .join("\n\n");
    return `\n${label} (${list.length})\n${"-".repeat(label.length + list.length.toString().length + 3)}\n\n${rows}\n`;
  };

  const body = [
    `Weekly compliance digest for ${practice.name}`,
    ``,
    `You have ${sorted.length} open item${sorted.length === 1 ? "" : "s"} across compliance tracking.`,
    sectionFor("Critical", critical),
    sectionFor("Warnings", warning),
    sectionFor("Informational", info),
    ``,
    `View all: ${baseUrl.replace(/\/$/, "")}/audit/overview`,
    `Adjust notification preferences: ${baseUrl.replace(/\/$/, "")}/settings/notifications`,
    ``,
    `— GuardWell`,
  ].join("\n");

  const htmlSectionFor = (label: string, list: Notification[]): EmailSection | null => {
    if (list.length === 0) return null;
    const rows = list
      .map((n) => {
        const hrefAttr = n.href
          ? `${baseUrl.replace(/\/$/, "")}${escapeAttr(n.href)}`
          : null;
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

  const html = renderEmailHtml({
    preheader: `${sorted.length} open compliance item${sorted.length === 1 ? "" : "s"} for ${practice.name}.`,
    headline:
      critical.length > 0
        ? `${critical.length} critical item${critical.length === 1 ? "" : "s"} need attention`
        : `Weekly compliance digest`,
    subheadline: `You have ${sorted.length} open item${sorted.length === 1 ? "" : "s"} across compliance tracking.`,
    accent: critical.length > 0 ? "critical" : undefined,
    sections: [
      htmlSectionFor("Critical", critical),
      htmlSectionFor("Warnings", warning),
      htmlSectionFor("Informational", info),
    ].filter((s): s is EmailSection => s !== null),
    cta: {
      label: "View overview",
      href: `${baseUrl.replace(/\/$/, "")}/audit/overview`,
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

  return { subject, text: body, html };
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
