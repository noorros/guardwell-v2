// src/app/api/credentials/export/route.ts
//
// GET /api/credentials/export — round-trip CSV of every active credential.

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
  // Audit C-3: the export bundles every active credential's license number,
  // holder email, issuing body, and free-text notes. VIEWER/STAFF roles
  // are read-only program participants (consultants, part-time staff)
  // and should not exfiltrate the full credentials register.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const credentials = await db.credential.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ holderId: "asc" }, { expiryDate: "asc" }],
    include: {
      credentialType: { select: { code: true } },
      holder: {
        include: { user: { select: { email: true } } },
      },
    },
  });

  const exportRows = credentials.map((c) => ({
    credentialTypeCode: c.credentialType.code,
    holderEmail: c.holder?.user.email ?? null,
    title: c.title,
    licenseNumber: c.licenseNumber,
    issuingBody: c.issuingBody,
    issueDate: c.issueDate,
    expiryDate: c.expiryDate,
    notes: c.notes,
  }));

  const csv = buildCsv(exportRows, [
    { field: "credentialTypeCode", label: "credentialTypeCode" },
    { field: "holderEmail", label: "holderEmail" },
    { field: "title", label: "title" },
    { field: "licenseNumber", label: "licenseNumber" },
    { field: "issuingBody", label: "issuingBody" },
    { field: "issueDate", label: "issueDate" },
    { field: "expiryDate", label: "expiryDate" },
    { field: "notes", label: "notes" },
  ]);

  const safeName = pu.practice.name.replace(/[^A-Za-z0-9]/g, "-");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="credentials-${safeName}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
