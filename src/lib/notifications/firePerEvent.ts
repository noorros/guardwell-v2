// src/lib/notifications/firePerEvent.ts
//
// Immediate-fire notification path. Used for state changes that mustn't
// wait for the daily digest cron — billing failures, subscription
// cancellations, etc.
//
// Writes a single Notification row (idempotent via the unique constraint
// on (userId, type, entityKey)) and best-effort sends an email
// immediately when `sendImmediately: true`.
//
// Replay safety: when a Stripe webhook is delivered twice, the upsert's
// (userId, type, entityKey) unique constraint dedups the row. We treat
// "row already existed" as "already nudged this user" and skip the email
// send. This stacks on top of appendEventAndApply's idempotencyKey
// guarantee (Stripe event id-keyed) for two-layer protection.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import type { NotificationType, NotificationSeverity } from "@prisma/client";

export interface FireArgs {
  practiceId: string;
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  entityKey: string | null;
  /** When true, also attempts an immediate email send. Skip when only
   *  in-app surfacing is desired (e.g. low-severity status changes). */
  sendImmediately?: boolean;
}

export interface FireResult {
  /** The new Notification row id, or null when the upsert hit an
   *  existing row (replay / second fire for the same entityKey). */
  notificationId: string | null;
  emailAttempted: boolean;
  emailDelivered: boolean;
}

export async function firePerEventNotification(
  args: FireArgs,
): Promise<FireResult> {
  const result: FireResult = {
    notificationId: null,
    emailAttempted: false,
    emailDelivered: false,
  };

  // Idempotent insert via the (userId, type, entityKey) unique constraint.
  // Prisma generates the compound key name from the columns:
  // userId_type_entityKey. The entityKey column is nullable, but the
  // upsert's where clause cannot use null directly — we coerce null to
  // empty string (consistent with run-digest.ts's existing dedup keying).
  const created = await db.notification.upsert({
    where: {
      userId_type_entityKey: {
        userId: args.userId,
        type: args.type,
        entityKey: args.entityKey ?? "",
      },
    },
    update: {}, // no-op on conflict — existing row stays as-is
    create: {
      practiceId: args.practiceId,
      userId: args.userId,
      type: args.type,
      severity: args.severity,
      title: args.title,
      body: args.body,
      href: args.href,
      entityKey: args.entityKey,
    },
  });

  // upsert always returns the row. To detect "newly inserted vs existing"
  // (so we don't double-email on replay), check createdAt: a fresh row
  // was created in this call if it's within the last 5 seconds.
  const isNew = Date.now() - created.createdAt.getTime() < 5_000;
  result.notificationId = isNew ? created.id : null;

  if (!isNew || !args.sendImmediately) return result;

  // Best-effort email. Skip silently when we can't resolve a destination
  // address — the in-app row is the canonical record either way.
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { email: true },
  });
  if (!user?.email) return result;

  result.emailAttempted = true;
  try {
    const emailResult = await sendEmail({
      to: user.email,
      subject: args.title,
      text: args.body,
    });
    result.emailDelivered = emailResult.delivered;
    if (emailResult.delivered) {
      await db.notification.update({
        where: { id: created.id },
        data: { sentViaEmailAt: new Date() },
      });
    }
  } catch {
    // Email failure is non-fatal — the notification row exists for
    // in-app delivery. Provider errors land in the email module's logs.
  }

  return result;
}
