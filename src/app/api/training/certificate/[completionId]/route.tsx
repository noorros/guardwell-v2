// src/app/api/training/certificate/[completionId]/route.tsx
//
// GET /api/training/certificate/[completionId]
// Phase 4 PR 7 — Streams a Certificate of Completion PDF for a passed
// TrainingCompletion.
//
// Authorization model:
//   - 401 if no signed-in user OR no practice context.
//   - 404 if the completion isn't in the caller's practice (cross-tenant
//     guard — never leak existence to a foreign tenant; same-tenant
//     same-practice rows fall through to the role/ownership check).
//   - 403 if the completion is in this practice but belongs to a
//     different user AND the caller isn't OWNER/ADMIN. STAFF/VIEWER can
//     download their OWN certs but not their peers'.
//   - 400 if the completion is for a failed quiz attempt (no certificate
//     should be generated for a failure).
//   - 200 with application/pdf otherwise.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { CertificateDocument } from "@/lib/training/certificate-pdf";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ completionId: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { completionId } = await params;

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "No practice" }, { status: 401 });
  }

  // Cross-tenant guard: scope by practiceId so foreign-tenant probes
  // get a clean 404 instead of a 403 that confirms the row exists.
  const completion = await db.trainingCompletion.findFirst({
    where: { id: completionId, practiceId: pu.practiceId },
    include: {
      course: { select: { title: true, passingScore: true } },
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  if (!completion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same-tenant ownership check: OWNER/ADMIN can download anyone's cert
  // (audit-defense — manager pulling a roster of completions during a
  // CMS site visit). Everyone else can only download their own.
  const isAdmin = pu.role === "OWNER" || pu.role === "ADMIN";
  if (!isAdmin && completion.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!completion.passed) {
    return NextResponse.json(
      { error: "Cannot generate certificate for a failed attempt" },
      { status: 400 },
    );
  }

  const employeeName =
    [completion.user.firstName, completion.user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || completion.user.email;

  const pdfBuffer = await renderToBuffer(
    <CertificateDocument
      input={{
        certificateId: completion.id,
        practiceName: pu.practice.name,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        employeeName,
        courseTitle: completion.course.title,
        courseVersion: completion.courseVersion,
        completedAt: completion.completedAt,
        score: completion.score,
        passingScore: completion.course.passingScore,
        expiresAt: completion.expiresAt,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certificate-${completionId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
