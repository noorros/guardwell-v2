// src/app/(dashboard)/programs/training/page.tsx
//
// Phase 4 PR 3 — assignment-driven Training landing. Replaces the
// pre-Phase-4 view (every isRequired course, regardless of who it
// applies to) with: KPI band + tabs orchestrator. The "My Training"
// tab shows the user's resolved assignments — direct + role-wide +
// category-wide, minus exclusions.
//
// canManage gates the admin-only "Manage Courses" and "Assignments"
// tabs; the placeholder content inside each points to the dedicated
// routes that land in PRs 4 + 5.

import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { TrainingDashboard } from "./TrainingDashboard";
import { resolveAssignmentsForUser } from "@/lib/training/resolveAssignments";

export const metadata = { title: "Training · My Programs" };
export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) redirect("/dashboard");

  const canManage = pu.role === "OWNER" || pu.role === "ADMIN";

  const { assignments, completed, inProgress, toDo } =
    await resolveAssignmentsForUser({
      practiceId: pu.practiceId,
      userId: user.id,
      role: pu.role,
    });

  // Practice-wide "team completions" KPI — count of every passing
  // completion in the practice, ever. Multi-tenant: practiceId scope is
  // mandatory.
  const teamCompletions = await db.trainingCompletion.count({
    where: { practiceId: pu.practiceId, passed: true },
  });

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Training" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete training assigned to you to satisfy HIPAA workforce-training
            obligations. Your completions auto-update the matching HIPAA
            requirements on your module page.
          </p>
        </div>
      </header>

      <TrainingDashboard
        canManage={canManage}
        myProgress={{ completed, inProgress, toDo, teamCompletions }}
        myAssignments={assignments}
      />
    </main>
  );
}
