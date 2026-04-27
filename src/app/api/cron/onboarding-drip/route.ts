// src/app/api/cron/onboarding-drip/route.ts
//
// POST /api/cron/onboarding-drip
// Daily Cloud Scheduler trigger that runs the 5-email onboarding drip per
// docs/specs/onboarding-flow.md § Phase E. Guarded by an X-Cron-Secret
// header validated against the `CRON_SECRET` env var (same secret +
// pattern as /api/notifications/digest/run, so a single Cloud Run
// secret reference covers every cron in this codebase).
//
// Without the secret (or when CRON_SECRET is unset on the server) the
// endpoint 403s so it never runs accidentally.

import { NextResponse } from "next/server";
import { runOnboardingDrip } from "@/lib/onboarding/run-drip";

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
    const summary = await runOnboardingDrip();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
