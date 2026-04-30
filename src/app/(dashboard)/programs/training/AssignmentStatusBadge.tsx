// src/app/(dashboard)/programs/training/AssignmentStatusBadge.tsx
//
// Phase 4 PR 3 — 4-state status badge for the assignment-driven view.
// Distinct from the legacy <TrainingStatusBadge> which derives state
// from a single TrainingCompletion row + has 4 orthogonal outputs
// around pass/fail/expiry/never-started. This badge takes the resolved
// 4-state status string directly so the dashboard row never has to
// reason about which TrainingCompletion is "latest" — the
// resolveAssignmentsForUser helper already did that work. The legacy
// component stays in the tree (imported by no one currently, but kept
// for reference and any caller that wants single-completion semantics).

"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

export type AssignmentStatus =
  | "TO_DO"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE";

export interface AssignmentStatusBadgeProps {
  status: AssignmentStatus;
  dueDate: Date | string | null;
  completionScore: number | null;
  completionExpiresAt: Date | string | null;
}

export function AssignmentStatusBadge({
  status,
  dueDate,
  completionScore,
  completionExpiresAt,
}: AssignmentStatusBadgeProps) {
  const tz = usePracticeTimezone();

  if (status === "COMPLETED") {
    const expiresAt = completionExpiresAt
      ? typeof completionExpiresAt === "string"
        ? new Date(completionExpiresAt)
        : completionExpiresAt
      : null;
    const expiresFmt = expiresAt ? formatPracticeDateLong(expiresAt, tz) : "";
    return (
      <Badge
        variant="secondary"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Completed{completionScore !== null ? ` · ${completionScore}%` : ""}
        {expiresFmt ? ` · expires ${expiresFmt}` : ""}
      </Badge>
    );
  }

  if (status === "OVERDUE") {
    const due = dueDate
      ? typeof dueDate === "string"
        ? new Date(dueDate)
        : dueDate
      : null;
    const dueFmt = due ? formatPracticeDateLong(due, tz) : "";
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-at-risk)",
          borderColor: "var(--gw-color-at-risk)",
        }}
      >
        Overdue{dueFmt ? ` · was due ${dueFmt}` : ""}
      </Badge>
    );
  }

  if (status === "IN_PROGRESS") {
    return (
      <Badge variant="outline" className="text-[10px]">
        In progress
      </Badge>
    );
  }

  if (status === "TO_DO") {
    const due = dueDate
      ? typeof dueDate === "string"
        ? new Date(dueDate)
        : dueDate
      : null;
    const dueFmt = due ? formatPracticeDateLong(due, tz) : "";
    return (
      <Badge variant="outline" className="text-[10px]">
        To do{dueFmt ? ` · due ${dueFmt}` : ""}
      </Badge>
    );
  }

  // Compile-time exhaustiveness — adding a new status surfaces here as a
  // never-narrowing TS error.
  const _exhaustive: never = status;
  throw new Error(
    `Unknown AssignmentStatus: ${String(_exhaustive)}. Update AssignmentStatusBadge.`,
  );
}
