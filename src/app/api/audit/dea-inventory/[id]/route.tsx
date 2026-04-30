// src/app/api/audit/dea-inventory/[id]/route.tsx
//
// GET /api/audit/dea-inventory/[id]
// Renders a single DEA biennial inventory snapshot PDF (21 CFR
// §1304.11).
//
// Phase D migrated this from a query-param route (?inventoryId=)
// to a path-param route for project-wide consistency with Form 41,
// Form 106, Incident Breach Memo, and OSHA 301.
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
import { DeaInventoryDocument } from "@/lib/audit/dea-inventory-pdf";

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
  const inventory = await db.deaInventory.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ schedule: "asc" }, { drugName: "asc" }] },
    },
  });
  if (!inventory || inventory.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve conductor + witness user names (no @relation defined; use
  // scalar IDs). The witnessUserId field also accepts free-text labels
  // entered via the Phase B InventoryTab form, so the lookup is
  // best-effort: if no User row matches, render the raw value.
  const userIds = [
    inventory.conductedByUserId,
    inventory.witnessUserId,
  ].filter((u): u is string => !!u);
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  // The conductor is always a real User (server-action enforces it), so a
  // missing record means the User was hard-deleted — render "Unknown" rather
  // than leaking the raw cuid into the PDF. The witness field is free text
  // entered via the Phase B form, so we keep the raw fallback for it.
  const formatConductorName = (id: string): string => {
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
    <DeaInventoryDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        inventory: {
          asOfDate: inventory.asOfDate,
          conductedByName: formatConductorName(inventory.conductedByUserId),
          witnessName: formatWitnessName(inventory.witnessUserId),
          notes: inventory.notes,
          items: inventory.items.map((it) => ({
            schedule: it.schedule,
            drugName: it.drugName,
            ndc: it.ndc,
            strength: it.strength,
            quantity: it.quantity,
            unit: it.unit,
          })),
        },
      }}
    />,
  );

  // DEA audit trail: every Inventory PDF read leaves an EventLog row.
  // Best-effort same as INCIDENT_BREACH_MEMO_GENERATED + Form 41 + 300.
  try {
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "DEA_PDF_GENERATED",
        payload: {
          form: "INVENTORY",
          recordId: id,
          generatedByUserId: user.id,
        },
      },
      async () => projectDeaPdfGenerated(),
    );
  } catch (err) {
    console.error("[dea-inventory] audit event emit failed", err);
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="dea-inventory-${inventory.asOfDate.toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
