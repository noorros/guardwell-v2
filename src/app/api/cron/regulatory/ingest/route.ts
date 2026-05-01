// src/app/api/cron/regulatory/ingest/route.ts
//
// POST /api/cron/regulatory/ingest
// Daily Cloud Scheduler trigger that walks every active RegulatorySource
// and writes new RegulatoryArticle rows. See docs/runbooks/regulatory-engine.md
// for ops setup (PR 7).
//
// Auth: same X-Cron-Secret pattern as other crons.

import { NextResponse } from "next/server";
import { runRegulatoryIngest } from "@/lib/regulatory/ingest";

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
    const summary = await runRegulatoryIngest();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[regulatory:ingest] runRegulatoryIngest threw:", message);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
