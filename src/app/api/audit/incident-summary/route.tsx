// src/app/api/audit/incident-summary/route.ts
//
// GET /api/audit/incident-summary
// Renders an incident summary PDF grouped by status.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  IncidentSummaryDocument,
  type IncidentRow,
} from "@/lib/audit/incident-summary-pdf";

export const maxDuration = 120;

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "No practice" }, { status: 401 });
  }

  const incidents = await db.incident.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: [{ status: "asc" }, { discoveredAt: "desc" }],
    select: {
      title: true,
      type: true,
      severity: true,
      status: true,
      discoveredAt: true,
      resolvedAt: true,
      isBreach: true,
      affectedCount: true,
    },
  });

  const rows: IncidentRow[] = incidents.map((i) => ({
    title: i.title,
    type: i.type,
    severity: i.severity,
    status: i.status,
    discoveredAt: i.discoveredAt,
    resolvedAt: i.resolvedAt,
    isBreach: i.isBreach,
    affectedCount: i.affectedCount,
  }));

  const pdfBuffer = await renderToBuffer(
    <IncidentSummaryDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        incidents: rows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="incident-summary-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
