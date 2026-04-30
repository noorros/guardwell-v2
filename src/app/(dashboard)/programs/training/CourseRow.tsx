// src/app/(dashboard)/programs/training/CourseRow.tsx
//
// Phase 4 PR 3 — single-row presenter for an assignment in the
// "My Training" tab. CTA label flips on the resolved status:
//
//   TO_DO       → "Start"
//   IN_PROGRESS → "Resume"  (PR 6 wires this once VideoProgress lands)
//   COMPLETED   → "Retake"
//   OVERDUE     → "Start"   (treated like TO_DO with an extra badge)
//
// Always links to /programs/training/[courseId] — the per-course page
// handles lesson + quiz + completion.

"use client";

import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AssignmentStatusBadge,
  type AssignmentStatus,
} from "./AssignmentStatusBadge";

export interface CourseRowProps {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  type: string;
  durationMinutes: number | null;
  dueDate: Date | string | null;
  requiredFlag: boolean;
  status: AssignmentStatus;
  completionScore: number | null;
  completionExpiresAt: Date | string | null;
}

function ctaLabel(status: AssignmentStatus): string {
  if (status === "COMPLETED") return "Retake";
  if (status === "IN_PROGRESS") return "Resume";
  // TO_DO + OVERDUE — both are "start the course" from the user's POV.
  return "Start";
}

function ctaVariant(
  status: AssignmentStatus,
): "default" | "outline" | "secondary" {
  // Completed → outline (de-emphasized retake), everything else → default.
  return status === "COMPLETED" ? "outline" : "default";
}

export function CourseRow(props: CourseRowProps) {
  const {
    courseId,
    courseTitle,
    type,
    durationMinutes,
    dueDate,
    status,
    completionScore,
    completionExpiresAt,
  } = props;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{courseTitle}</p>
            <Badge variant="secondary" className="text-[10px]">
              {type}
            </Badge>
            <AssignmentStatusBadge
              status={status}
              dueDate={dueDate}
              completionScore={completionScore}
              completionExpiresAt={completionExpiresAt}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {durationMinutes ? `~${durationMinutes} min` : "self-paced"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant={ctaVariant(status)}>
            <Link href={`/programs/training/${courseId}` as Route}>
              {ctaLabel(status)}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
