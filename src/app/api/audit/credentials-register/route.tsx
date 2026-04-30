// src/app/api/audit/credentials-register/route.ts
//
// GET /api/audit/credentials-register
// Renders the credentials register PDF.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  CredentialsRegisterDocument,
  type CredentialRow,
} from "@/lib/audit/credentials-register-pdf";

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

  const credentials = await db.credential.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ holderId: "asc" }, { expiryDate: "asc" }],
    include: {
      credentialType: { select: { name: true } },
      holder: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  const rows: CredentialRow[] = credentials.map((c) => {
    const holderName = c.holder
      ? [c.holder.user.firstName, c.holder.user.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        c.holder.user.email ||
        "Unknown holder"
      : "Practice-level";
    return {
      holderLabel: holderName,
      typeName: c.credentialType.name,
      title: c.title,
      licenseNumber: c.licenseNumber,
      issuingBody: c.issuingBody,
      issueDate: c.issueDate,
      expiryDate: c.expiryDate,
    };
  });

  const pdfBuffer = await renderToBuffer(
    <CredentialsRegisterDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        credentials: rows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="credentials-register-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
