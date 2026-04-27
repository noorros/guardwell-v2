// src/app/api/audit/dea-form-41/[id]/route.tsx
//
// GET /api/audit/dea-form-41/[id]
// Renders a DEA Form 41 (Registrant Inventory of Drugs Surrendered,
// 21 CFR §1317) PDF for a single DeaDisposalRecord.
//
// Phase C scope: single-row Form 41. The federal form is a multi-row
// table; v1 launches single-row because most healthcare practices
// dispose one drug at a time. A future post-launch route would group
// every disposal sharing a `disposalBatchId` into one Form 41.
//
// Phase C also intentionally does NOT emit a post-render audit event;
// Phase D will add a unified `INCIDENT_OSHA_LOG_GENERATED`-style event
// type for all DEA PDFs (Inventory + Form 41 + Form 106) at once.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { DeaForm41Document } from "@/lib/audit/dea-form-41-pdf";

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
  const disposal = await db.deaDisposalRecord.findUnique({
    where: { id },
  });
  if (!disposal || disposal.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve disposer + witness names. The disposedByUserId is set
  // server-side by the action (always a real User), so a missing row
  // means the User was hard-deleted — render "Unknown" rather than
  // leaking the raw cuid into the PDF. The witnessUserId field also
  // accepts free-text labels via the Phase C form, so the lookup is
  // best-effort: if no User row matches, render the raw value.
  const userIds = [disposal.disposedByUserId, disposal.witnessUserId].filter(
    (u): u is string => !!u,
  );
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const formatDisposerName = (id: string): string => {
    const u = userById.get(id);
    if (!u) return "Unknown";
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
  };
  const formatWitnessName = (id: string | null): string | null => {
    if (!id) return null;
    const u = userById.get(id);
    if (!u) return id; // free-text witness label
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
  };

  const pdfBuffer = await renderToBuffer(
    <DeaForm41Document
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        generatedAt: new Date(),
        disposal: {
          disposalDate: disposal.disposalDate,
          disposalMethod: disposal.disposalMethod,
          reverseDistributorName: disposal.reverseDistributorName,
          reverseDistributorDeaNumber: disposal.reverseDistributorDeaNumber,
          disposedByName: formatDisposerName(disposal.disposedByUserId),
          witnessName: formatWitnessName(disposal.witnessUserId),
          form41Filed: disposal.form41Filed,
          notes: disposal.notes,
          // Phase C: a DeaDisposalRecord is one drug. The PDF accepts a
          // table of items so a future multi-drug Form 41 can pass all
          // rows that share a disposalBatchId without changing the
          // component shape.
          items: [
            {
              schedule: disposal.schedule,
              drugName: disposal.drugName,
              ndc: disposal.ndc,
              strength: disposal.strength,
              quantity: disposal.quantity,
              unit: disposal.unit,
            },
          ],
        },
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="dea-form-41-${disposal.disposalDate.toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
