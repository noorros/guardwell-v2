// src/app/(dashboard)/programs/training/assignments/page.tsx
//
// Phase 4 PR 5 — Assignments grid admin sub-page.
//
// Per-staff completion grid:
//   - Rows = active staff in this practice (PracticeUser.removedAt is null)
//   - Cols = required, non-retired training courses
//   - Cells = status badge per (staff, course):
//       * COMPLETED with date
//       * TO_DO ("Expired · retake") if completion expired
//       * OVERDUE if assignment.dueDate < now and no fresh completion
//       * IN_PROGRESS placeholder (PR 6 wires real video-progress tracking)
//       * NOT_ASSIGNED ("—") if no assignment matches the (role/category/user)
//
// Multi-tenant rule: every Prisma query in this file MUST scope by
// practiceId — directly or through a relation `where`. We have 5 reads:
//
//   1. practiceUser  → where.practiceId  ✓
//   2. trainingCourse → no practiceId column (global table); filtered by
//                       isRequired + retire-state. The grid's contents
//                       are practice-scoped via the assignments + completions
//                       queries below.
//   3. trainingAssignment → where.practiceId  ✓
//   4. assignmentExclusion → where.assignment.practiceId  ✓ (relational scope)
//   5. trainingCompletion → where.practiceId  ✓
//
// Role gate: OWNER + ADMIN only. STAFF/VIEWER are bounced to the
// /programs/training landing — same pattern the Manage Courses page uses.

import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import {
  resolveGridCells,
  type GridCell,
} from "@/lib/training/resolveGrid";
import { RETIRED_SORT_ORDER } from "@/lib/training/courseTenancy";
import { AssignmentsGrid } from "./AssignmentsGrid";
import { BulkAutoAssignButton } from "./BulkAutoAssignButton";

export const metadata = { title: "Assignments · Training" };
export const dynamic = "force-dynamic";

export interface GridStaffRow {
  userId: string;
  displayName: string;
  role: string;
  category: string | null;
}

export interface GridCourseColumn {
  id: string;
  code: string;
  title: string;
  type: string;
}

export type GridCellRecord = Record<string, Record<string, GridCell>>;

export default async function AssignmentsPage() {
  await requireUser();
  const pu = await getPracticeUser();
  if (!pu) redirect("/dashboard");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    redirect("/programs/training");
  }

  // Five practice-scoped reads in parallel. See file-header comment for
  // the practiceId-scope audit; do NOT remove a where clause here without
  // updating that comment.
  const [staff, courses, assignments, exclusions, completions] = await Promise.all([
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId, removedAt: null },
      include: { user: true },
      orderBy: { user: { email: "asc" } },
    }),
    // TrainingCourse is global. We list every required course that is
    // NOT retired (sortOrder<RETIRED_SORT_ORDER). Custom courses authored
    // by another practice are filtered out implicitly because they
    // never get isRequired=true outside of their owning practice's
    // catalog (system courses are the only required courses today; if
    // that changes, this page will need an `isCustomForPractice` filter
    // mirroring /programs/training/manage).
    db.trainingCourse.findMany({
      where: {
        isRequired: true,
        sortOrder: { lt: RETIRED_SORT_ORDER },
      },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: {
        id: true,
        code: true,
        title: true,
        type: true,
      },
    }),
    db.trainingAssignment.findMany({
      where: { practiceId: pu.practiceId, revokedAt: null },
      select: {
        id: true,
        courseId: true,
        assignedToUserId: true,
        assignedToRole: true,
        assignedToCategory: true,
        dueDate: true,
      },
    }),
    db.assignmentExclusion.findMany({
      where: { assignment: { practiceId: pu.practiceId } },
      select: { assignmentId: true, userId: true },
    }),
    db.trainingCompletion.findMany({
      where: { practiceId: pu.practiceId, passed: true },
      select: {
        userId: true,
        courseId: true,
        completedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  // Build the (serializable) grid props the client component will render.
  const staffRows: GridStaffRow[] = staff.map((s) => ({
    userId: s.userId,
    // PracticeUser doesn't carry firstName/lastName today — the email is
    // the only display handle. PR 4+ may add display-name fields; if so,
    // prefer "First Last" and fall back to email here.
    displayName: s.user.email ?? s.user.id,
    role: s.role,
    category: null, // PracticeUser has no per-user category column yet (TODO future PR)
  }));

  const courseCols: GridCourseColumn[] = courses.map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    type: c.type,
  }));

  const cells = resolveGridCells({
    staff: staffRows.map((s) => ({
      userId: s.userId,
      role: s.role,
      category: s.category,
    })),
    courses: courseCols.map((c) => ({ id: c.id })),
    assignments,
    exclusions,
    completions,
  });

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Training", href: "/programs/training" },
          { label: "Assignments" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Training Assignments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-staff completion grid for every required course. Use
            &quot;Auto-Assign required to Team&quot; to issue role-wide
            assignments to anyone who is missing one.
          </p>
        </div>
      </header>

      <div className="flex justify-end">
        <BulkAutoAssignButton />
      </div>

      <AssignmentsGrid
        staff={staffRows}
        courses={courseCols}
        cells={cells}
      />
    </main>
  );
}
