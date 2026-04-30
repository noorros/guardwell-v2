// src/app/api/audit/vendor-baa-register/route.ts
//
// GET /api/audit/vendor-baa-register
// Renders the vendor + BAA register PDF.
//
// Audit #21 M-2 (2026-04-30): the register now includes RETIRED vendors
// in their own section so OCR / state inspectors get a full §164.530(j)
// 6-year retention picture, not just the currently-active roster.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  VendorBaaRegisterDocument,
  type VendorRow,
} from "@/lib/audit/vendor-baa-register-pdf";

export const maxDuration = 120;

// §164.530(j) requires retention of compliance documentation for 6 years.
// We surface retired BAAs going back the same window in the register.
const RETIRED_LOOKBACK_MS = 6 * 365 * 24 * 60 * 60 * 1000;

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

  // Active vendors (the entire historical query). Sort: PHI-vendors
  // first (they're the §164.502(e) audit fodder), then alpha.
  const activeVendors = await db.vendor.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ processesPhi: "desc" }, { name: "asc" }],
    select: {
      name: true,
      type: true,
      service: true,
      processesPhi: true,
      baaDirection: true,
      baaExecutedAt: true,
      baaExpiresAt: true,
      retiredAt: true,
    },
  });

  // Retired vendors within the 6-year retention window. Sort by
  // most-recently-retired first so the most relevant rows are at top.
  const retiredCutoff = new Date(Date.now() - RETIRED_LOOKBACK_MS);
  const retiredVendors = await db.vendor.findMany({
    where: {
      practiceId: pu.practiceId,
      retiredAt: { gte: retiredCutoff },
    },
    orderBy: [{ retiredAt: "desc" }],
    select: {
      name: true,
      type: true,
      service: true,
      processesPhi: true,
      baaDirection: true,
      baaExecutedAt: true,
      baaExpiresAt: true,
      retiredAt: true,
    },
  });

  const activeRows: VendorRow[] = activeVendors.map((v) => ({
    name: v.name,
    type: v.type,
    service: v.service,
    processesPhi: v.processesPhi,
    baaDirection: v.baaDirection,
    baaExecutedAt: v.baaExecutedAt,
    baaExpiresAt: v.baaExpiresAt,
    retiredAt: null,
  }));

  const retiredRows: VendorRow[] = retiredVendors.map((v) => ({
    name: v.name,
    type: v.type,
    service: v.service,
    processesPhi: v.processesPhi,
    baaDirection: v.baaDirection,
    baaExecutedAt: v.baaExecutedAt,
    baaExpiresAt: v.baaExpiresAt,
    retiredAt: v.retiredAt,
  }));

  const pdfBuffer = await renderToBuffer(
    <VendorBaaRegisterDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        vendors: activeRows,
        retiredVendors: retiredRows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="vendor-baa-register-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
