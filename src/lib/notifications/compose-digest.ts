// src/lib/notifications/compose-digest.ts
//
// Turns a user's current open notifications into a plain-text weekly
// digest email. HTML template is a follow-up — text ships today so the
// digest actually works before we perfect the design.

import type { Notification, Practice } from "@prisma/client";

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
}): { subject: string; text: string } | null {
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

  return { subject, text: body };
}
