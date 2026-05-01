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
// Replay safety: when a Stripe webhook is delivered twice, we attempt a
// plain `create` and catch Prisma's P2002 (unique constraint) on
// (userId, type, entityKey). A caught P2002 means "row already existed"
// — we treat that as "already nudged this user" and skip the email send.
// This stacks on top of appendEventAndApply's idempotencyKey guarantee
// (Stripe event id-keyed) for two-layer protection.
//
// Why try-create / catch-P2002 instead of upsert? An upsert always
// returns the row but provides no signal about whether it was newly
// inserted. We previously inferred "newly inserted" from a 5-second
// createdAt delta, which is fragile under DB latency. The try-create
// pattern is exact: a successful create means new, a P2002 means dedup.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import type {
  NotificationType,
  NotificationSeverity,
  Prisma,
} from "@prisma/client";

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
  /** The new Notification row id, or null when the create raised P2002
   *  (replay / second fire for the same entityKey). */
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
  // We attempt a plain `create` and let the DB enforce dedup; a P2002
  // error means the (userId, type, entityKey) tuple already exists and
  // we treat the call as a replay.
  let notification: { id: string } | null = null;
  let isNew = false;
  try {
    notification = await db.notification.create({
      data: {
        practiceId: args.practiceId,
        userId: args.userId,
        type: args.type,
        severity: args.severity,
        title: args.title,
        body: args.body,
        href: args.href,
        entityKey: args.entityKey,
      },
      select: { id: true },
    });
    isNew = true;
  } catch (err) {
    // P2002 = unique constraint violation. (userId, type, entityKey) row
    // already exists — treat as a replay/dedup and fall through.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as Prisma.PrismaClientKnownRequestError).code === "P2002"
    ) {
      isNew = false;
    } else {
      throw err;
    }
  }

  result.notificationId = isNew && notification ? notification.id : null;

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
      // isNew = true implies notification !== null (the create succeeded
      // before isNew was set). Non-null assertion is safe here.
      await db.notification.update({
        where: { id: notification!.id },
        data: { sentViaEmailAt: new Date() },
      });
    }
  } catch {
    // Email failure is non-fatal — the notification row exists for
    // in-app delivery. Provider errors land in the email module's logs.
  }

  return result;
}
