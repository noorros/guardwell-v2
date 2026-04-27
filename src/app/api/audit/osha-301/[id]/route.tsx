// src/app/api/audit/osha-301/[id]/route.tsx
//
// GET /api/audit/osha-301/[id]
// Renders the OSHA Form 301 PDF for a single OSHA-recordable incident.
// 404 if the incident is not in this practice or its type is not
// OSHA_RECORDABLE.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Osha301Document } from "@/lib/audit/osha-301-pdf";

export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const incident = await db.incident.findUnique({
    where: { id },
    select: {
      practiceId: true,
      type: true,
      title: true,
      description: true,
      discoveredAt: true,
      oshaBodyPart: true,
      oshaInjuryNature: true,
      oshaOutcome: true,
      oshaDaysAway: true,
      oshaDaysRestricted: true,
      sharpsDeviceType: true,
      reportedByUserId: true,
    },
  });

  if (!incident || incident.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (incident.type !== "OSHA_RECORDABLE") {
    return NextResponse.json(
      { error: "Incident is not OSHA-recordable" },
      { status: 404 },
    );
  }

  // Schema doesn't define a `reportedBy` relation, just the scalar FK.
  // Fetch the user separately to populate the "Reported by" line on
  // section 1 of the form.
  const reporter = await db.user.findUnique({
    where: { id: incident.reportedByUserId },
    select: { firstName: true, lastName: true, email: true },
  });
  const reportedByName = reporter
    ? [reporter.firstName, reporter.lastName].filter(Boolean).join(" ") ||
      reporter.email
    : null;

  const pdfBuffer = await renderToBuffer(
    <Osha301Document
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        generatedAt: new Date(),
        incident: {
          title: incident.title,
          description: incident.description,
          discoveredAt: incident.discoveredAt,
          oshaBodyPart: incident.oshaBodyPart,
          oshaInjuryNature: incident.oshaInjuryNature,
          oshaOutcome: incident.oshaOutcome,
          oshaDaysAway: incident.oshaDaysAway,
          oshaDaysRestricted: incident.oshaDaysRestricted,
          sharpsDeviceType: incident.sharpsDeviceType,
        },
        reportedByName,
      }}
    />,
  );

  const slug = incident.title.replace(/[^A-Za-z0-9]/g, "-").slice(0, 60);
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="osha-301-${slug}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
