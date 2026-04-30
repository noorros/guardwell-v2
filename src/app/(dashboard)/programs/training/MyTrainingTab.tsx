// src/app/(dashboard)/programs/training/MyTrainingTab.tsx
//
// Phase 4 PR 3 — the "My Training" tab. Renders the user's resolved
// assignments through filter chips:
//   - Status: To Do / In Progress / Completed / Overdue
//   - Type:   distinct course.type values present in the data
//
// Filters AND together. Empty result → empty state copy. Filter buttons
// use aria-pressed to convey toggle state to assistive tech.

"use client";

import { useMemo, useState } from "react";
import { CourseRow } from "./CourseRow";
import type { ResolvedAssignment } from "@/lib/training/resolveAssignments";
import { Button } from "@/components/ui/button";

type StatusFilter =
  | "ALL"
  | "TO_DO"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE";

// IN_PROGRESS chip surfaces zero rows until PR 6 wires VideoProgress —
// the resolver currently has no way to derive that status. Listing the
// chip now keeps the filter UI stable across PR 6's data flip.
const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "TO_DO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "OVERDUE", label: "Overdue" },
];

export interface MyTrainingTabProps {
  assignments: ResolvedAssignment[];
}

export function MyTrainingTab({ assignments }: MyTrainingTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  // Multi-select: the user can stack type chips. Empty set = "all types".
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const distinctTypes = useMemo(() => {
    const set = new Set<string>();
    for (const a of assignments) set.add(a.type);
    return Array.from(set).sort();
  }, [assignments]);

  const filtered = useMemo(() => {
    return assignments.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (selectedTypes.size > 0 && !selectedTypes.has(a.type)) return false;
      return true;
    });
  }, [assignments, statusFilter, selectedTypes]);

  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        You have no training assigned. Your administrator can assign courses
        from the Manage Courses tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap items-center gap-2"
      >
        {STATUS_CHIPS.map((chip) => {
          const pressed = statusFilter === chip.value;
          return (
            <Button
              key={chip.value}
              type="button"
              size="xs"
              variant={pressed ? "default" : "outline"}
              aria-pressed={pressed}
              onClick={() => setStatusFilter(chip.value)}
            >
              {chip.label}
            </Button>
          );
        })}
      </div>

      {distinctTypes.length > 0 && (
        <div
          role="group"
          aria-label="Filter by type"
          className="flex flex-wrap items-center gap-2"
        >
          {distinctTypes.map((t) => {
            const pressed = selectedTypes.has(t);
            return (
              <Button
                key={t}
                type="button"
                size="xs"
                variant={pressed ? "default" : "outline"}
                aria-pressed={pressed}
                onClick={() => toggleType(t)}
              >
                {t}
              </Button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          No courses match your filters.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <CourseRow
                id={a.id}
                courseId={a.courseId}
                courseCode={a.courseCode}
                courseTitle={a.courseTitle}
                type={a.type}
                durationMinutes={a.durationMinutes}
                dueDate={a.dueDate}
                requiredFlag={a.requiredFlag}
                status={a.status}
                completionScore={a.completionScore}
                completionExpiresAt={a.completionExpiresAt}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
