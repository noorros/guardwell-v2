// src/app/api/evidence/[id]/confirm/route.ts
//
// Called by the client after the PUT to GCS succeeds. Flips Evidence.status
// to UPLOADED. Separate endpoint from /upload so the client can retry the
// confirm independently if the browser closes mid-upload.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { confirmUpload } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const pu = await getPracticeUser();
    if (!pu) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await confirmUpload({
      practiceId: pu.practiceId,
      actorUserId: user.id,
      evidenceId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirm failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
