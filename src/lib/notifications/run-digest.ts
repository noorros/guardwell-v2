// src/lib/notifications/run-digest.ts
//
// Runs the notification digest against every active practice. For each
// practice:
//   1. Collect active users (PracticeUser.removedAt = null).
//   2. Run all generators to produce proposals.
//   3. Filter out proposals that already exist (unique on
//      userId + type + entityKey).
//   4. Bulk-insert the new Notifications.
//   5. For each user with digestEnabled + emailEnabled and at least one
//      unread notification, compose + send the digest email.
//
// Idempotent enough that running it multiple times in a period is fine:
// existing notifications dedup; the email send is best-effort and we
// don't track per-send-attempt persistence beyond `sentViaEmailAt`.
//
// Returns a summary for the cron handler's JSON response.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import {
  generateAllNotifications,
  type NotificationProposal,
} from "./generators";
import { composeDigestEmail } from "./compose-digest";
import { getEffectivePreferences } from "./preferences";

export interface DigestRunSummary {
  practicesScanned: number;
  notificationsCreated: number;
  emailsAttempted: number;
  emailsDelivered: number;
  errors: Array<{ practiceId?: string; userId?: string; message: string }>;
}

export async function runNotificationDigest(): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = {
    practicesScanned: 0,
    notificationsCreated: 0,
    emailsAttempted: 0,
    emailsDelivered: 0,
    errors: [],
  };

  const practices = await db.practice.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      primaryState: true,
      timezone: true,
      reminderSettings: true,
    },
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";

  for (const practice of practices) {
    summary.practicesScanned += 1;
    try {
      const members = await db.practiceUser.findMany({
        where: { practiceId: practice.id, removedAt: null },
        select: {
          userId: true,
          user: { select: { id: true, email: true } },
        },
      });
      if (members.length === 0) continue;

      // Phase 7 PR 7 — cadence routing. Look up each member's effective
      // preference once and keep only DAILY-cadence members for this run:
      //   * WEEKLY users are served by runWeeklyNotificationDigest.
      //   * INSTANT users get critical events real-time via
      //     firePerEventNotification — no daily inbox accumulation.
      //   * NONE users opted out entirely.
      // Filtering at the generator step (not just the email loop) keeps
      // the inbox aligned with the user's chosen cadence.
      const memberPrefs = new Map<
        string,
        ReturnType<typeof getEffectivePreferences>
      >();
      for (const m of members) {
        const pref = await db.notificationPreference.findUnique({
          where: { userId: m.userId },
        });
        memberPrefs.set(m.userId, getEffectivePreferences(pref));
      }
      const dailyMembers = members.filter(
        (m) => memberPrefs.get(m.userId)?.cadence === "DAILY",
      );
      if (dailyMembers.length === 0) continue;
      const userIds = dailyMembers.map((m) => m.userId);

      // Generators run in a read-only pass through the transaction.
      // We don't need a transaction here — just a shared client — but
      // using the default client keeps the signature the same as the
      // projection helpers.
      const proposals = await generateAllNotifications(
        db,
        practice.id,
        userIds,
        practice.timezone ?? "UTC",
        practice.reminderSettings,
      );

      // Dedup: pull existing (userId, type, entityKey) tuples and skip
      // proposals that match. createMany with skipDuplicates handles
      // the race where a second generator run appears between dedup
      // read and insert.
      const newProposals = await dedupProposals(proposals);
      if (newProposals.length > 0) {
        const { count } = await db.notification.createMany({
          data: newProposals.map((p) => ({
            practiceId: p.practiceId,
            userId: p.userId,
            type: p.type,
            severity: p.severity,
            title: p.title,
            body: p.body,
            href: p.href,
            entityKey: p.entityKey,
          })),
          skipDuplicates: true,
        });
        summary.notificationsCreated += count;
      }

      // Send digest per user. Skip users with digest disabled or email
      // disabled. Skip users with zero unread notifications — no point
      // mailing an empty digest. Cadence was already filtered above; we
      // only loop dailyMembers here.
      for (const m of dailyMembers) {
        const effective = memberPrefs.get(m.userId);
        const digestEnabled = effective?.digestEnabled ?? true;
        const emailEnabled = effective?.emailEnabled ?? true;
        if (!digestEnabled || !emailEnabled) continue;

        const unread = await db.notification.findMany({
          where: {
            userId: m.userId,
            practiceId: practice.id,
            readAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        if (unread.length === 0) continue;

        const digest = composeDigestEmail({
          practice,
          recipientEmail: m.user.email,
          notifications: unread,
          baseUrl,
        });
        if (!digest) continue;

        summary.emailsAttempted += 1;
        const result = await sendEmail({
          to: m.user.email,
          subject: digest.subject,
          text: digest.text,
          html: digest.html,
        });
        if (result.delivered) {
          summary.emailsDelivered += 1;
          // Mark the unread notifications as emailed (not read — user
          // hasn't opened the inbox yet; read state is separate).
          await db.notification.updateMany({
            where: {
              id: { in: unread.map((n) => n.id) },
              sentViaEmailAt: null,
            },
            data: { sentViaEmailAt: new Date() },
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

async function dedupProposals(
  proposals: NotificationProposal[],
): Promise<NotificationProposal[]> {
  if (proposals.length === 0) return [];
  // Group by (userId) to minimize round-trips — one findMany per user
  // covering every type/entityKey seen in this run.
  const byUser = new Map<string, NotificationProposal[]>();
  for (const p of proposals) {
    const arr = byUser.get(p.userId) ?? [];
    arr.push(p);
    byUser.set(p.userId, arr);
  }

  const keep: NotificationProposal[] = [];
  for (const [userId, list] of byUser) {
    const existing = await db.notification.findMany({
      where: {
        userId,
        OR: list.map((p) => ({
          type: p.type,
          entityKey: p.entityKey,
        })),
      },
      select: { type: true, entityKey: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.type}:${e.entityKey ?? ""}`),
    );
    for (const p of list) {
      const key = `${p.type}:${p.entityKey ?? ""}`;
      if (!existingKeys.has(key)) keep.push(p);
    }
  }
  return keep;
}
