// src/app/api/evidence/[id]/download/route.ts
//
// Returns a 5-minute signed GCS download URL (or 503 in dev no-op mode).
// The client is redirected directly; no server-side buffering.

import { NextResponse } from "next/server";
import { getPracticeUser } from "@/lib/rbac";
import { getDownloadUrl } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const pu = await getPracticeUser();
    if (!pu) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await getDownloadUrl({
      practiceId: pu.practiceId,
      evidenceId: id,
    });

    if (!result.url) {
      return NextResponse.json(
        { error: result.reason ?? "GCS not configured" },
        { status: 503 },
      );
    }

    // 302 redirect so the browser downloads directly from GCS
    return NextResponse.redirect(result.url, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    const status = message === "Evidence not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
