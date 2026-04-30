// src/app/(dashboard)/programs/training/manage/page.tsx
//
// Phase 4 PR 4 — Manage Courses admin sub-page. Lists every course
// visible to the caller's practice (system courses + this practice's
// own custom courses) with retire/restore controls on the custom rows.
//
// Tenancy: TrainingCourse is a global table without a practiceId
// column. Custom courses are namespaced by code-prefix
// (`${practiceId}_${userCode}`). Showing a different practice's
// custom-course titles to admins here would leak private data, so
// we filter via courseTenancy helpers (isSystemCourse OR
// isCustomForPractice). The catalog is small (~30 rows) so JS-side
// filtering is acceptable; SQL regex isn't portable across drivers.
//
// Role gate: OWNER + ADMIN only. STAFF/VIEWER are bounced back to the
// /programs/training landing.

import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import {
  isCustomForPractice,
  isSystemCourse,
  RETIRED_SORT_ORDER,
} from "@/lib/training/courseTenancy";
import { ManageCoursesTab } from "./ManageCoursesTab";

export const metadata = { title: "Manage Courses · Training" };
export const dynamic = "force-dynamic";

export interface ManageCourseRow {
  id: string;
  code: string;
  title: string;
  type: string;
  version: number;
  sortOrder: number;
  isCustom: boolean;
  isRetired: boolean;
}

export default async function TrainingManagePage() {
  await requireUser();
  const pu = await getPracticeUser();
  if (!pu) redirect("/dashboard");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    redirect("/programs/training");
  }

  const allCourses = await db.trainingCourse.findMany({
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: {
      id: true,
      code: true,
      title: true,
      type: true,
      version: true,
      sortOrder: true,
    },
  });

  const rows: ManageCourseRow[] = allCourses
    .filter(
      (c) =>
        isSystemCourse(c.code) || isCustomForPractice(c.code, pu.practiceId),
    )
    .map((c) => ({
      ...c,
      isCustom: isCustomForPractice(c.code, pu.practiceId),
      isRetired: c.sortOrder === RETIRED_SORT_ORDER,
    }));

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Training", href: "/programs/training" },
          { label: "Manage Courses" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Manage Courses
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the training catalog. System courses are read-only; custom
            courses authored for your practice can be retired or restored from
            here.
          </p>
        </div>
      </header>

      <ManageCoursesTab rows={rows} />
    </main>
  );
}
