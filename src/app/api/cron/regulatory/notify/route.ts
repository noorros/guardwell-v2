// src/app/api/cron/regulatory/notify/route.ts
//
// POST /api/cron/regulatory/notify
// Daily Cloud Scheduler trigger that walks every RegulatoryAlert with
// sentAt IS NULL (and not dismissed), creates Notification rows for
// OWNER + ADMIN PracticeUsers of the alert's practice (REGULATORY_ALERT
// type), then stamps sentAt on the alert.
//
// Idempotent on replay: Notification (userId, type, entityKey) unique
// constraint dedups via createMany skipDuplicates.
//
// See docs/runbooks/regulatory-engine.md for ops setup (PR 7).
//
// Auth: same X-Cron-Secret pattern as other crons.

import { NextResponse } from "next/server";
import { runRegulatoryNotify } from "@/lib/regulatory/runNotify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return NextResponse.json(
      { ok: false, reason: "CRON_SECRET not configured" },
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
    const summary = await runRegulatoryNotify();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[regulatory:notify] runRegulatoryNotify threw:", message);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
