// src/app/api/evidence/upload/route.ts
//
// Two-step upload flow:
//   POST { action: "init", ... }    → returns { evidenceId, gcsKey, uploadUrl }
//   POST { action: "confirm", ... } → flips status to UPLOADED

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { requestUpload, confirmUpload } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

const InitInput = z.object({
  action: z.literal("init"),
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  fileSizeBytes: z.number().int().min(0),
});

const ConfirmInput = z.object({
  action: z.literal("confirm"),
  evidenceId: z.string().min(1),
});

const Body = z.discriminatedUnion("action", [InitInput, ConfirmInput]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const pu = await getPracticeUser();
    if (!pu) {
      return NextResponse.json({ error: "No practice" }, { status: 401 });
    }

    const json = await request.json();
    const parsed = Body.parse(json);

    if (parsed.action === "init") {
      const result = await requestUpload({
        practiceId: pu.practiceId,
        practiceUserId: pu.id,
        actorUserId: user.id,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        fileSizeBytes: parsed.fileSizeBytes,
      });
      return NextResponse.json(result);
    }

    // action === "confirm"
    await confirmUpload({
      practiceId: pu.practiceId,
      actorUserId: user.id,
      evidenceId: parsed.evidenceId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
