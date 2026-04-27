// src/app/api/vendors/export/route.ts
//
// GET /api/vendors/export — round-trip CSV of every active vendor.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { buildCsv } from "@/components/gw/BulkCsvImport";

export const dynamic = "force-dynamic";

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
      contact: true,
      email: true,
      processesPhi: true,
      baaExecutedAt: true,
      baaExpiresAt: true,
      baaDirection: true,
      notes: true,
    },
  });

  const csv = buildCsv(vendors, [
    { field: "name", label: "name" },
    { field: "type", label: "type" },
    { field: "service", label: "service" },
    { field: "contact", label: "contact" },
    { field: "email", label: "email" },
    { field: "processesPhi", label: "processesPhi" },
    { field: "baaExecutedAt", label: "baaExecutedAt" },
    { field: "baaExpiresAt", label: "baaExpiresAt" },
    { field: "baaDirection", label: "baaDirection" },
    { field: "notes", label: "notes" },
  ]);

  const safeName = pu.practice.name.replace(/[^A-Za-z0-9]/g, "-");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vendors-${safeName}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
