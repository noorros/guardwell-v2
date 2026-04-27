// src/app/api/audit/pp-attestation/route.ts
//
// GET /api/audit/pp-attestation
// Renders the annual P&P review attestation PDF.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  PpAttestationDocument,
  type PolicyRow,
} from "@/lib/audit/pp-attestation-pdf";
import { POLICY_METADATA, type PolicyCode } from "@/lib/compliance/policies";

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

  const [policies, privacyOfficer] = await Promise.all([
    db.practicePolicy.findMany({
      where: { practiceId: pu.practiceId, retiredAt: null },
      orderBy: { policyCode: "asc" },
      select: {
        policyCode: true,
        version: true,
        adoptedAt: true,
        lastReviewedAt: true,
      },
    }),
    db.practiceUser.findFirst({
      where: {
        practiceId: pu.practiceId,
        isPrivacyOfficer: true,
        removedAt: null,
      },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
  ]);

  const rows: PolicyRow[] = policies.map((p) => {
    const meta = POLICY_METADATA[p.policyCode as PolicyCode];
    return {
      policyCode: p.policyCode,
      policyTitle: meta?.title ?? p.policyCode,
      version: p.version,
      adoptedAt: p.adoptedAt,
      lastReviewedAt: p.lastReviewedAt,
    };
  });

  const officerName = privacyOfficer
    ? [privacyOfficer.user.firstName, privacyOfficer.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      privacyOfficer.user.email ||
      null
    : null;

  const pdfBuffer = await renderToBuffer(
    <PpAttestationDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        generatedAt: new Date(),
        privacyOfficerName: officerName,
        policies: rows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="pp-attestation-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
