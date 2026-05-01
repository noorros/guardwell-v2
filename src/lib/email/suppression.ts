// src/lib/email/suppression.ts
//
// Resend bounce + complaint suppression. The webhook at
// /api/webhooks/resend writes EmailSuppression rows on bounce and
// complaint events. sendEmail() consults this list before issuing
// any Resend API call to avoid repeatedly mailing known-bad addresses.
//
// Storage convention: every email is normalized to lowercase on both
// read and write — Resend reports recipients in whatever case the
// caller used, but RFC 5321 treats the local-part as case-sensitive
// only optionally; in practice virtually every receiver folds to
// lowercase. Storing lowercased gives us a stable unique key.

import { db } from "@/lib/db";

export type SuppressionReason = "BOUNCE" | "COMPLAINT" | "UNSUBSCRIBE" | "MANUAL";

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await db.emailSuppression.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Idempotent upsert. If the row exists, leaves it as-is (we keep the
 * earliest suppression timestamp + reason; rewriting on every webhook
 * delivery would lose the original cause and reset the timestamp on
 * every replay).
 */
export async function suppressEmail(args: {
  email: string;
  reason: SuppressionReason;
  resendId?: string | null;
}): Promise<void> {
  await db.emailSuppression.upsert({
    where: { email: args.email.toLowerCase() },
    update: {}, // no-op on conflict — keep the earliest cause + timestamp
    create: {
      email: args.email.toLowerCase(),
      reason: args.reason,
      resendId: args.resendId ?? null,
    },
  });
}
