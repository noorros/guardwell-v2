// src/app/api/security-assets/export/route.ts
//
// GET /api/security-assets/export
// Round-trip CSV export of every active TechAsset row. Same column set
// the bulk-import accepts so users can export, edit in Excel, and
// re-import.

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

  const assets = await db.techAsset.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ assetType: "asc" }, { name: "asc" }],
    select: {
      name: true,
      assetType: true,
      processesPhi: true,
      encryption: true,
      vendor: true,
      location: true,
      notes: true,
    },
  });

  const csv = buildCsv(assets, [
    { field: "name", label: "name" },
    { field: "assetType", label: "assetType" },
    { field: "processesPhi", label: "processesPhi" },
    { field: "encryption", label: "encryption" },
    { field: "vendor", label: "vendor" },
    { field: "location", label: "location" },
    { field: "notes", label: "notes" },
  ]);

  const safeName = pu.practice.name.replace(/[^A-Za-z0-9]/g, "-");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="security-assets-${safeName}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
