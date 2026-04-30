// src/app/api/audit/training-summary/route.ts
//
// GET /api/audit/training-summary
// Renders a per-staff training completion grid PDF.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  TrainingSummaryDocument,
  type TrainingCompletionRow,
} from "@/lib/audit/training-summary-pdf";

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
  // Audit HIPAA I-8: the training-summary PDF lists every staff
  // member's training completions (a §164.308(a)(5)(i) audit-trail
  // artifact). STAFF/VIEWER are read-only program participants and
  // should not be able to download a roster PDF cataloguing
  // colleagues' completion gaps.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // TrainingCompletion has no `user` relation in v2's schema (userId is
  // a plain FK to identity User.id); same for course. Fetch users +
  // courses in parallel and join in memory.
  // Audit HIPAA I-8: the user query was previously unbounded
  // (db.user.findMany with no where clause), pulling identity rows for
  // every user across every tenant. Scope to users in this practice
  // via the practiceUsers list — that's the only set the rendered
  // rows can reference, since `completions` are already filtered by
  // practiceId and we look up `userById` only for those completions.
  const practiceUsers = await db.practiceUser.findMany({
    where: { practiceId: pu.practiceId },
    select: { userId: true, role: true },
  });
  const practiceUserIds = practiceUsers.map((s) => s.userId);
  const [completions, totalStaff, users, courses] = await Promise.all([
    db.trainingCompletion.findMany({
      where: { practiceId: pu.practiceId, passed: true },
      orderBy: { expiresAt: "asc" },
    }),
    db.practiceUser.count({
      where: { practiceId: pu.practiceId, removedAt: null },
    }),
    practiceUserIds.length
      ? db.user.findMany({
          where: { id: { in: practiceUserIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : Promise.resolve([]),
    db.trainingCourse.findMany({
      select: { id: true, code: true, title: true },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const roleByUser = new Map(practiceUsers.map((s) => [s.userId, s.role]));

  const rows: TrainingCompletionRow[] = completions.map((c) => {
    const u = userById.get(c.userId);
    const course = courseById.get(c.courseId);
    const fullName =
      [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() ||
      u?.email ||
      "—";
    return {
      staffName: fullName,
      staffEmail: u?.email ?? "—",
      staffRole: roleByUser.get(c.userId) ?? "—",
      courseCode: course?.code ?? "—",
      courseTitle: course?.title ?? "—",
      passed: c.passed,
      score: c.score,
      completedAt: c.completedAt,
      expiresAt: c.expiresAt,
    };
  });

  const pdfBuffer = await renderToBuffer(
    <TrainingSummaryDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        practiceTimezone: pu.practice.timezone ?? "UTC",
        generatedAt: new Date(),
        totalStaff,
        completions: rows,
      }}
    />,
  );

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="training-summary-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
