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

  // TrainingCompletion has no `user` relation in v2's schema (userId is
  // a plain FK to identity User.id); same for course. Fetch users +
  // courses in parallel and join in memory.
  const [completions, totalStaff, users, courses, practiceUsers] =
    await Promise.all([
      db.trainingCompletion.findMany({
        where: { practiceId: pu.practiceId, passed: true },
        orderBy: { expiresAt: "asc" },
      }),
      db.practiceUser.count({
        where: { practiceId: pu.practiceId, removedAt: null },
      }),
      db.user.findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      db.trainingCourse.findMany({
        select: { id: true, code: true, title: true },
      }),
      db.practiceUser.findMany({
        where: { practiceId: pu.practiceId },
        select: { userId: true, role: true },
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
