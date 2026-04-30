// src/app/api/audit/incident-breach-memo/[id]/route.tsx
//
// GET /api/audit/incident-breach-memo/[id]
// Renders a HIPAA §164.402 breach determination memo PDF for a single
// incident. 404 if the incident is not in this practice or no breach
// determination has been recorded yet.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentBreachMemoGenerated } from "@/lib/events/projections/incident";
import { IncidentBreachMemoDocument } from "@/lib/audit/incident-breach-memo-pdf";

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
  // Audit HIPAA C-3: the breach-memo PDF is the §164.402 four-factor
  // determination artifact — narrative description of the incident,
  // affected-PHI count, attestation chain. STAFF/VIEWER are read-only
  // program participants and should not be able to download the
  // memorialized determination memo.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const incident = await db.incident.findUnique({
    where: { id },
    select: {
      practiceId: true,
      title: true,
      type: true,
      severity: true,
      discoveredAt: true,
      phiInvolved: true,
      patientState: true,
      affectedCount: true,
      factor1Score: true,
      factor2Score: true,
      factor3Score: true,
      factor4Score: true,
      overallRiskScore: true,
      isBreach: true,
      ocrNotifyRequired: true,
      breachDeterminationMemo: true,
      breachDeterminedAt: true,
      ocrNotifiedAt: true,
      affectedIndividualsNotifiedAt: true,
      mediaNotifiedAt: true,
      stateAgNotifiedAt: true,
      // Audit #21 (HIPAA I-1): per-state AG notification rows for
      // multi-state breaches. The PDF renders a per-state table when
      // ≥2 rows; single/zero rows fall back to the legacy single line.
      stateAgNotifications: {
        select: {
          state: true,
          deadlineAt: true,
          notifiedAt: true,
          thresholdAffectedCount: true,
        },
      },
    },
  });

  if (!incident || incident.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    incident.breachDeterminedAt === null ||
    incident.factor1Score === null ||
    incident.factor2Score === null ||
    incident.factor3Score === null ||
    incident.factor4Score === null ||
    incident.overallRiskScore === null ||
    incident.isBreach === null ||
    incident.ocrNotifyRequired === null
  ) {
    return NextResponse.json(
      { error: "Breach determination has not been recorded yet" },
      { status: 404 },
    );
  }

  const pdfBuffer = await renderToBuffer(
    <IncidentBreachMemoDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        incident: {
          title: incident.title,
          type: incident.type,
          severity: incident.severity,
          discoveredAt: incident.discoveredAt,
          phiInvolved: incident.phiInvolved,
          patientState: incident.patientState,
          affectedCount: incident.affectedCount,
          factor1Score: incident.factor1Score,
          factor2Score: incident.factor2Score,
          factor3Score: incident.factor3Score,
          factor4Score: incident.factor4Score,
          overallRiskScore: incident.overallRiskScore,
          isBreach: incident.isBreach,
          ocrNotifyRequired: incident.ocrNotifyRequired,
          breachDeterminationMemo: incident.breachDeterminationMemo,
          breachDeterminedAt: incident.breachDeterminedAt,
        },
        notifications: {
          ocrNotifiedAt: incident.ocrNotifiedAt,
          affectedIndividualsNotifiedAt: incident.affectedIndividualsNotifiedAt,
          mediaNotifiedAt: incident.mediaNotifiedAt,
          stateAgNotifiedAt: incident.stateAgNotifiedAt,
        },
        // Audit #21 (HIPAA I-1): pass through the per-state rows. The
        // PDF component decides between the table view (≥2 rows) and
        // the legacy single-line view (0/1 rows).
        stateAgNotifications: incident.stateAgNotifications.map((r) => ({
          state: r.state,
          deadlineAt: r.deadlineAt,
          notifiedAt: r.notifiedAt,
          thresholdAffectedCount: r.thresholdAffectedCount,
        })),
      }}
    />,
  );

  // HIPAA audit trail: every breach memo PDF read leaves an EventLog
  // row. Best-effort — a failed audit-event write should not block the
  // legitimate user's access to their own PHI per the access-vs-audit
  // tradeoff documented in ADR-0001. Same pattern as audit-prep packet.
  try {
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "INCIDENT_BREACH_MEMO_GENERATED",
        payload: {
          incidentId: id,
          generatedByUserId: user.id,
        },
      },
      async () => projectIncidentBreachMemoGenerated(),
    );
  } catch (err) {
    console.error(
      "[incident-breach-memo] audit event emit failed",
      err,
    );
  }

  const slug = incident.title.replace(/[^A-Za-z0-9]/g, "-").slice(0, 60);
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="breach-memo-${slug}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
