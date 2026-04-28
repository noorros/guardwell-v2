// src/app/api/audit/dea-form-106/[id]/route.tsx
//
// GET /api/audit/dea-form-106/[id]
// Renders a DEA Form 106 (Report of Theft or Loss of Controlled
// Substances, 21 CFR §1301.74(c)) PDF for a single
// DeaTheftLossReport.
//
// Phase D scope: single-row Form 106. The federal form is a multi-row
// table; v1 launches single-row because most healthcare practices
// report one drug per theft/loss event. A future post-launch route
// would group every report sharing a `reportBatchId` into one Form
// 106.
//
// Emits a DEA_PDF_GENERATED audit event post-render — best-effort, so
// a failed audit-event write does not block the legitimate user's
// access to their own record (per ADR-0001 access-vs-audit tradeoff).

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectDeaPdfGenerated } from "@/lib/events/projections/dea";
import { DeaForm106Document } from "@/lib/audit/dea-form-106-pdf";

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

  const { id } = await params;
  const report = await db.deaTheftLossReport.findUnique({
    where: { id },
  });
  if (!report || report.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve the reportedByUserId. The action sets this server-side
  // from requireUser(), so it's always a real User — a missing row
  // means the User was hard-deleted; render "Unknown" rather than
  // leaking the raw cuid into the PDF.
  const reporter = await db.user.findUnique({
    where: { id: report.reportedByUserId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const reportedByName = reporter
    ? [reporter.firstName, reporter.lastName].filter(Boolean).join(" ") ||
      reporter.email
    : "Unknown";

  const pdfBuffer = await renderToBuffer(
    <DeaForm106Document
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        generatedAt: new Date(),
        report: {
          discoveredAt: report.discoveredAt,
          lossType: report.lossType,
          methodOfDiscovery: report.methodOfDiscovery,
          lawEnforcementNotified: report.lawEnforcementNotified,
          lawEnforcementAgency: report.lawEnforcementAgency,
          lawEnforcementCaseNumber: report.lawEnforcementCaseNumber,
          deaNotifiedAt: report.deaNotifiedAt,
          form106SubmittedAt: report.form106SubmittedAt,
          reportedByName,
          notes: report.notes,
          // Phase D: a DeaTheftLossReport is one drug. The PDF accepts a
          // table of items so a future multi-drug Form 106 can pass all
          // rows that share a reportBatchId without changing the
          // component shape.
          items: [
            {
              schedule: report.schedule,
              drugName: report.drugName,
              ndc: report.ndc,
              strength: report.strength,
              quantityLost: report.quantityLost,
              unit: report.unit,
            },
          ],
        },
      }}
    />,
  );

  // DEA audit trail: every Form 106 PDF read leaves an EventLog row.
  // Best-effort same as INCIDENT_BREACH_MEMO_GENERATED + Form 41 + 300.
  try {
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "DEA_PDF_GENERATED",
        payload: {
          form: "FORM_106",
          recordId: id,
          generatedByUserId: user.id,
        },
      },
      async () => projectDeaPdfGenerated(),
    );
  } catch (err) {
    console.error("[dea-form-106] audit event emit failed", err);
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="dea-form-106-${report.discoveredAt.toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
