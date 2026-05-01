// src/app/api/cron/regulatory/analyze/route.ts
//
// POST /api/cron/regulatory/analyze
// Daily Cloud Scheduler trigger that walks every unanalyzed
// RegulatoryArticle, scores it via Claude (analyzer.regulatory-relevance.v1),
// then fans out per-practice RegulatoryAlert rows where the article's
// relevant frameworks intersect the practice's enabled frameworks.
// See docs/runbooks/regulatory-engine.md for ops setup (PR 7).
//
// Auth: same X-Cron-Secret pattern as other crons.

import { NextResponse } from "next/server";
import { runRegulatoryAnalyze } from "@/lib/regulatory/runAnalyze";

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
    const summary = await runRegulatoryAnalyze();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[regulatory:analyze] runRegulatoryAnalyze threw:", message);
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 500 },
    );
  }
}
