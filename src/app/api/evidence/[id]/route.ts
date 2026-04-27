// src/app/api/evidence/[id]/route.ts
//
// DELETE /api/evidence/[id] — soft-delete an Evidence row.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { softDelete } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

export async function DELETE(
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

    await softDelete({
      practiceId: pu.practiceId,
      actorUserId: user.id,
      evidenceId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
