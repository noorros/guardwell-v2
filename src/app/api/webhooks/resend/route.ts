// src/app/api/webhooks/resend/route.ts
//
// Phase 7 PR 9 — Resend bounce + complaint webhook receiver.
//
// PUBLIC route (no Firebase auth cookie required) — security comes
// entirely from the Svix HMAC signature on every payload. If the
// RESEND_WEBHOOK_SECRET env var is unset we return 503 instead of
// silently accepting unsigned posts; mis-deployment fails closed.
//
// Resend events we care about:
//   - email.bounced   → suppress recipient with reason=BOUNCE
//   - email.complained → suppress recipient with reason=COMPLAINT
// Resend events we ignore (analytics, not actionable here):
//   - email.delivered, email.opened, email.clicked, email.sent, ...
//
// Idempotency: suppressEmail() upserts on (email) — replaying the
// same Svix event id is a no-op, and a second event for the same
// recipient keeps the original cause + timestamp.

import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { suppressEmail } from "@/lib/email/suppression";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResendBouncePayload {
  type: string;
  data: {
    email_id?: string;
    to?: string[];
    bounce?: { reason?: string };
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, reason: "RESEND_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { ok: false, reason: "missing svix headers" },
      { status: 400 },
    );
  }

  // Svix is hashing the raw bytes — req.json() would re-serialize and
  // trip the signature check on whitespace differences, so use text().
  const rawBody = await req.text();

  let payload: ResendBouncePayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendBouncePayload;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid signature" },
      { status: 401 },
    );
  }

  if (payload.type === "email.bounced") {
    const recipients = payload.data.to ?? [];
    for (const email of recipients) {
      await suppressEmail({ email, reason: "BOUNCE", resendId: svixId });
    }
  } else if (payload.type === "email.complained") {
    const recipients = payload.data.to ?? [];
    for (const email of recipients) {
      await suppressEmail({ email, reason: "COMPLAINT", resendId: svixId });
    }
  }
  // All other event types: noop. We acknowledge with 200 so Resend
  // doesn't keep retrying analytics events we don't care about.

  return NextResponse.json({ ok: true });
}
