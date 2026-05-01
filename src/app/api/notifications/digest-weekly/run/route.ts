// src/app/api/notifications/digest-weekly/run/route.ts
//
// POST /api/notifications/digest-weekly/run
//
// Phase 7 PR 7 — weekly counterpart to /api/notifications/digest/run.
// Auth + response shape mirror the daily endpoint exactly. Cloud Scheduler
// invokes this once per week (Monday 08:00 local default per
// preferences.digestDay / digestTime; Cloud Scheduler triggers in UTC and
// the runner respects each user's preferred cadence).

import { NextResponse } from "next/server";
import { runWeeklyNotificationDigest } from "@/lib/notifications/run-digest-weekly";

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
    const summary = await runWeeklyNotificationDigest();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
