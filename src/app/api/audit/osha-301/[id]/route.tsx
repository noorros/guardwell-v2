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
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentOshaLogGenerated } from "@/lib/events/projections/incident";
import { Osha301Document } from "@/lib/audit/osha-301-pdf";

export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Audit C-2 (OSHA): the Form 301 incident report carries injured-
  // employee identification, narrative description, treating physician
  // — §1904.35(b)(2)(v) privacy-sensitive. STAFF/VIEWER should not
  // download a single incident's evidentiary PDF.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
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
      injuredUserId: true,
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

  // Schema doesn't define User relations, just scalar FKs. Audit #19:
  // resolve BOTH the injured employee and the reporter (Form 301 has
  // distinct slots for each — Section 1 is the injured employee per
  // §1904.35(b)(2)(v)). Fall back to reporter for legacy rows that
  // pre-date the injuredUserId field.
  const employeeId = incident.injuredUserId ?? incident.reportedByUserId;
  const userIds = Array.from(
    new Set([employeeId, incident.reportedByUserId].filter(Boolean)),
  );
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const formatName = (id: string | null) => {
    if (!id) return null;
    const u = userById.get(id);
    if (!u) return null;
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
  };
  const reportedByName = formatName(incident.reportedByUserId);
  const injuredEmployeeName = formatName(employeeId);

  const pdfBuffer = await renderToBuffer(
    <Osha301Document
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
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
        injuredEmployeeName,
      }}
    />,
  );

  // OSHA / employee-privacy audit trail: every 301 PDF read leaves an
  // EventLog row. Best-effort — a failed audit-event write should not
  // block the legitimate user's access to their own injury data. Same
  // pattern as INCIDENT_BREACH_MEMO_GENERATED.
  try {
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "INCIDENT_OSHA_LOG_GENERATED",
        payload: {
          form: "301",
          incidentId: id,
          generatedByUserId: user.id,
        },
      },
      async () => projectIncidentOshaLogGenerated(),
    );
  } catch (err) {
    console.error("[osha-301] audit event emit failed", err);
  }

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
