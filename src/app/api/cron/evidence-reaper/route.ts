// src/app/api/cron/evidence-reaper/route.ts
//
// POST /api/cron/evidence-reaper
// Daily Cloud Scheduler trigger that hard-deletes GCS objects + Evidence
// DB rows for any evidence soft-deleted more than 30 days ago.
//
// Auth: same X-Cron-Secret pattern as /api/cron/onboarding-drip.
// Cloud Scheduler config: daily at 02:00 UTC, same secret as other crons.
//
// Cloud Scheduler one-time setup (Noorros runs once):
//   gcloud scheduler jobs create http guardwell-v2-evidence-reaper \
//     --location=us-central1 \
//     --schedule="0 2 * * *" \
//     --uri="https://v2.app.gwcomp.com/api/cron/evidence-reaper" \
//     --http-method=POST \
//     --headers="x-cron-secret=<CRON_SECRET_VALUE>" \
//     --attempt-deadline=5m \
//     --time-zone="UTC"

import { NextResponse } from "next/server";
import { runReaper } from "@/lib/storage/reaper";

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
    const result = await runReaper();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evidence-reaper] runReaper threw:", message);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
