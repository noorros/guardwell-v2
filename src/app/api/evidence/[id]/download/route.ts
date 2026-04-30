// src/app/api/evidence/[id]/download/route.ts
//
// Returns a 5-minute signed GCS download URL (or 503 in dev no-op mode).
// The client is redirected directly; no server-side buffering.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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

    // Audit #21 MN-6: STAFF/VIEWER are blocked from downloading evidence
    // attached to CREDENTIAL rows (DEA cert PDFs, malpractice insurance,
    // license cards). Pairs with the page-level gate in
    // src/app/(dashboard)/programs/credentials/[id]/page.tsx and the CR-3
    // activity-log redaction (PR #215). Other entityTypes (POLICY,
    // INCIDENT, DESTRUCTION_LOG, etc.) keep their existing role contracts.
    const evidenceRow = await db.evidence.findUnique({
      where: { id },
      select: { practiceId: true, entityType: true },
    });
    if (
      evidenceRow &&
      evidenceRow.practiceId === pu.practiceId &&
      evidenceRow.entityType === "CREDENTIAL" &&
      (pu.role === "STAFF" || pu.role === "VIEWER")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
