// src/app/api/audit/osha-300/route.tsx
//
// GET /api/audit/osha-300?year=YYYY
// Renders the OSHA Form 300 annual log PDF for a calendar year.
// Defaults to the current calendar year if `year` is not provided.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Osha300Document, type Osha300Row } from "@/lib/audit/osha-300-pdf";

export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam
    ? Number.parseInt(yearParam, 10)
    : new Date().getUTCFullYear();
  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "Invalid year parameter" },
      { status: 400 },
    );
  }

  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`);

  const incidents = await db.incident.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "OSHA_RECORDABLE",
      discoveredAt: { gte: yearStart, lt: yearEnd },
    },
    orderBy: { discoveredAt: "asc" },
    select: {
      id: true,
      discoveredAt: true,
      oshaInjuryNature: true,
      oshaOutcome: true,
      oshaDaysAway: true,
      oshaDaysRestricted: true,
      reportedByUserId: true,
    },
  });

  // Schema doesn't define a relation, just the scalar FK. Fetch all
  // unique reporters in one query to keep this O(1) regardless of the
  // number of OSHA-recordable cases.
  const reporterIds = Array.from(
    new Set(incidents.map((i) => i.reportedByUserId)),
  );
  const reporters = reporterIds.length
    ? await db.user.findMany({
        where: { id: { in: reporterIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const reporterById = new Map(reporters.map((u) => [u.id, u]));

  const rows: Osha300Row[] = incidents.map((i, idx) => {
    const r = reporterById.get(i.reportedByUserId);
    const employeeName = r
      ? [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email
      : null;
    return {
      caseNumber: String(idx + 1).padStart(3, "0"),
      injuryDate: i.discoveredAt,
      employeeName,
      injuryNature: i.oshaInjuryNature,
      outcome: i.oshaOutcome,
      daysAway: i.oshaDaysAway,
      daysRestricted: i.oshaDaysRestricted,
    };
  });

  const pdfBuffer = await renderToBuffer(
    <Osha300Document
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        year,
        generatedAt: new Date(),
        rows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="osha-300-${year}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
