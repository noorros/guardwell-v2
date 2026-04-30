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
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentOshaLogGenerated } from "@/lib/events/projections/incident";
import { Osha300Document, type Osha300Row } from "@/lib/audit/osha-300-pdf";
import { practiceYearBoundsUtc } from "@/lib/audit/format";

export const maxDuration = 120;

export async function GET(req: Request) {
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
  // Audit C-2 (OSHA): the Form 300 log is the official §1904.32 annual
  // recordkeeping artifact — exposes injured-employee names, body parts,
  // outcomes, days-away counts. STAFF/VIEWER are read-only program
  // participants and should not exfiltrate the full incident register.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const practiceTz = pu.practice.timezone ?? "UTC";
  // Default the year selector to the current calendar year as observed
  // in the practice's timezone — a Pacific tenant generating the form on
  // 2027-01-01 02:00Z is still in 2026 locally and should default to 2026.
  const year = yearParam
    ? Number.parseInt(yearParam, 10)
    : Number(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: practiceTz,
          year: "numeric",
        }).format(new Date()),
      );
  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "Invalid year parameter" },
      { status: 400 },
    );
  }

  // Audit C-4 (OSHA): the calendar year the inspector cares about is the
  // year as observed locally, not in UTC. A 2026-12-31 23:00 Pacific
  // injury is still on the 2026 form even though its UTC stamp is
  // 2027-01-01 07:00. practiceYearBoundsUtc returns the UTC instants that
  // bracket the local year so the SQL filter stays index-friendly.
  const { startUtc: yearStart, endUtc: yearEnd } = practiceYearBoundsUtc(
    year,
    practiceTz,
  );

  const incidents = await db.incident.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "OSHA_RECORDABLE",
      discoveredAt: { gte: yearStart, lt: yearEnd },
      // §1904.7(b)(5): first-aid-only injuries are NOT recordable on
      // Form 300. Excluded here so they never reach the rendered PDF.
      oshaOutcome: { not: "FIRST_AID" },
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
      injuredUserId: true,
    },
  });

  // Audit #19: prefer injuredUserId for the Employee column. Fall back
  // to reportedByUserId so legacy rows (pre-audit-#19, when the field
  // didn't exist) still populate something rather than rendering "—"
  // and forcing the inspector to chase down who was actually injured.
  // Schema doesn't define User relations on Incident, just the scalar
  // FKs — one batched findMany covers both id sets.
  const userIds = Array.from(
    new Set(incidents.flatMap((i) => [i.injuredUserId, i.reportedByUserId].filter((id): id is string => id != null))),
  );
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: Osha300Row[] = incidents.map((i, idx) => {
    const employeeId = i.injuredUserId ?? i.reportedByUserId;
    const u = userById.get(employeeId);
    const employeeName = u
      ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email
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
        practiceTimezone: practiceTz,
        year,
        generatedAt: new Date(),
        rows,
      }}
    />,
  );

  // OSHA / employee-privacy audit trail: every 300 PDF read leaves an
  // EventLog row. Best-effort same as the 301 route + breach memo.
  try {
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "INCIDENT_OSHA_LOG_GENERATED",
        payload: {
          form: "300",
          year,
          generatedByUserId: user.id,
        },
      },
      async () => projectIncidentOshaLogGenerated(),
    );
  } catch (err) {
    console.error("[osha-300] audit event emit failed", err);
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="osha-300-${year}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
