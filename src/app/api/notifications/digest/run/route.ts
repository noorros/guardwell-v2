// src/app/api/notifications/digest/run/route.ts
//
// POST /api/notifications/digest/run
// Callable by Cloud Scheduler on a cron schedule. Guarded by a shared
// secret in the `X-Cron-Secret` header. Without the secret (or when
// NOTIFICATION_CRON_SECRET is unset on the server) the endpoint 403s so
// it never runs accidentally.
//
// Also available for authenticated manual triggers by OWNER/ADMIN via
// /settings/notifications (follow-up PR) — same handler, different
// auth path.

import { NextResponse } from "next/server";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.NOTIFICATION_CRON_SECRET;
  if (!configured) {
    return NextResponse.json(
      { ok: false, reason: "NOTIFICATION_CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== configured) {
    return NextResponse.json(
      { ok: false, reason: "invalid cron secret" },
      { status: 403 },
    );
  }

  try {
    const summary = await runNotificationDigest();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
