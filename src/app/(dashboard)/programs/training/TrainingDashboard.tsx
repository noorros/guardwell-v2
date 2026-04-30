// src/app/(dashboard)/programs/training/TrainingDashboard.tsx
//
// Phase 4 PR 3 — top-level orchestrator for /programs/training. Renders a
// KPI band ("My Progress" %, Completed, In Progress, Team Completions)
// followed by a Tabs primitive splitting the page into:
//
//   - "My Training"     — visible to everyone; the assignment-driven
//                         course list (PR 3, this file)
//   - "Manage Courses"  — admin-only; placeholder pointer to the
//                         /programs/training/manage route (lands in PR 4)
//   - "Assignments"     — admin-only; placeholder pointer to the
//                         /programs/training/assignments grid (lands in
//                         PR 5)
//
// Client component because Tabs uses Radix state. The "In Progress" KPI
// is hardcoded to 0 until PR 6 (BYOV + VideoProgress) wires through real
// in-progress data.

"use client";

import Link from "next/link";
import type { Route } from "next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyTrainingTab } from "./MyTrainingTab";
import type { ResolvedAssignment } from "@/lib/training/resolveAssignments";

export interface TrainingDashboardProps {
  canManage: boolean;
  myProgress: {
    completed: number;
    inProgress: number;
    toDo: number;
    teamCompletions: number;
  };
  myAssignments: ResolvedAssignment[];
}

export function TrainingDashboard({
  canManage,
  myProgress,
  myAssignments,
}: TrainingDashboardProps) {
  return (
    <div className="space-y-6">
      <KpiBand progress={myProgress} />
      <Tabs defaultValue="my">
        <TabsList>
          <TabsTrigger value="my">My Training</TabsTrigger>
          {canManage && <TabsTrigger value="manage">Manage Courses</TabsTrigger>}
          {canManage && <TabsTrigger value="assignments">Assignments</TabsTrigger>}
        </TabsList>
        <TabsContent value="my">
          <MyTrainingTab assignments={myAssignments} />
        </TabsContent>
        {canManage && (
          <TabsContent value="manage">
            <p className="text-sm text-muted-foreground">
              Course management lives at{" "}
              <Link
                href={"/programs/training/manage" as Route}
                className="underline"
              >
                /programs/training/manage
              </Link>
              .
            </p>
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="assignments">
            <p className="text-sm text-muted-foreground">
              Per-staff completion grid lives at{" "}
              <Link
                href={"/programs/training/assignments" as Route}
                className="underline"
              >
                /programs/training/assignments
              </Link>
              .
            </p>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function KpiBand({
  progress,
}: {
  progress: TrainingDashboardProps["myProgress"];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <KpiTile label="My Progress" value={`${progressPct(progress)}%`} />
      <KpiTile label="Completed" value={progress.completed} />
      <KpiTile label="In Progress" value={progress.inProgress} />
      <KpiTile label="Team Completions" value={progress.teamCompletions} />
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function progressPct(p: TrainingDashboardProps["myProgress"]): number {
  const total = p.completed + p.inProgress + p.toDo;
  if (total === 0) return 0;
  return Math.round((p.completed / total) * 100);
}
