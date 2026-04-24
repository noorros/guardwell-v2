// src/app/api/audit/prep/[id]/packet/route.tsx
//
// GET /api/audit/prep/[id]/packet — assembles the multi-section packet
// from completed steps' snapshotted evidence + emits an
// AUDIT_PREP_PACKET_GENERATED event so the session flips COMPLETED.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAuditPrepPacketGenerated } from "@/lib/events/projections/auditPrep";
import {
  AuditPrepPacketDocument,
  type PacketSectionInput,
} from "@/lib/audit-prep/packet-pdf";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";

export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "No practice" }, { status: 401 });
  }

  const session = await db.auditPrepSession.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { code: "asc" } },
    },
  });
  if (!session || session.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const protocols = PROTOCOLS_BY_MODE[session.mode] ?? [];
  const sections: PacketSectionInput[] = protocols.flatMap((p) => {
    const step = session.steps.find((s) => s.code === p.code);
    if (!step || step.status === "PENDING") return [];
    return [
      {
        code: p.code,
        title: p.title,
        citation: p.citation,
        description: p.description,
        evidenceJson:
          (step.evidenceJson as Record<string, unknown> | null) ?? null,
        notes: step.notes,
        status: step.status as "COMPLETE" | "NOT_APPLICABLE",
      },
    ];
  });

  const pdfBuffer = await renderToBuffer(
    <AuditPrepPacketDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        mode: session.mode,
        startedAt: session.startedAt,
        generatedAt: new Date(),
        sections,
      }}
    />,
  );

  // Emit packet-generated event after render. Failure here doesn't
  // block the download — try/catch + log so the user still gets the PDF.
  try {
    const payload = {
      auditPrepSessionId: session.id,
      generatedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "AUDIT_PREP_PACKET_GENERATED",
        payload,
      },
      async (tx) =>
        projectAuditPrepPacketGenerated(tx, {
          practiceId: pu.practiceId,
          payload,
        }),
    );
  } catch (err) {
    console.error("[audit-prep] packet-generated event failed", err);
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="audit-prep-${session.mode}-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
