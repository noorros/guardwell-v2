// src/app/api/audit/vendor-baa-register/route.ts
//
// GET /api/audit/vendor-baa-register
// Renders the vendor + BAA register PDF.

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

  const vendors = await db.vendor.findMany({
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
    },
  });

  const rows: VendorRow[] = vendors.map((v) => ({
    name: v.name,
    type: v.type,
    service: v.service,
    processesPhi: v.processesPhi,
    baaDirection: v.baaDirection,
    baaExecutedAt: v.baaExecutedAt,
    baaExpiresAt: v.baaExpiresAt,
  }));

  const pdfBuffer = await renderToBuffer(
    <VendorBaaRegisterDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        vendors: rows,
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
