// src/app/(dashboard)/programs/training/assignments/AssignmentsGrid.tsx
//
// Phase 4 PR 5 — client component that renders the per-staff completion
// grid. Pure presentation: every row is keyed by staff.userId and every
// column by course.id; cells come pre-computed by the server via
// resolveGridCells in /src/lib/training/resolveGrid.ts.
//
// ARIA: a tabular `<table>` with `<th scope="col">` for course headers
// and `<th scope="row">` for staff name cells. Status cells are <td>
// elements; their text is human-readable (e.g. "Completed Apr 15, 2026")
// AND wrapped in a <Badge> for the visual treatment. Screen readers get
// the text directly.

"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";
import type { GridCell, GridCellStatus } from "@/lib/training/resolveGrid";
import type {
  GridStaffRow,
  GridCourseColumn,
  GridCellRecord,
} from "./page";

export interface AssignmentsGridProps {
  staff: GridStaffRow[];
  courses: GridCourseColumn[];
  cells: GridCellRecord;
}

export function AssignmentsGrid({
  staff,
  courses,
  cells,
}: AssignmentsGridProps) {
  if (staff.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        No active staff members yet. Invite staff from the People page to
        populate this grid.
      </div>
    );
  }
  if (courses.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        No required courses are currently in the catalog. Mark a course as
        required from the Manage Courses tab to populate this grid.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" aria-label="Training assignments grid">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2">
              Staff
            </th>
            {courses.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="px-3 py-2"
                title={c.code}
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {staff.map((s) => (
            <tr key={s.userId}>
              <th
                scope="row"
                className="px-3 py-2 text-left font-medium text-foreground"
              >
                <div>{s.displayName}</div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  {s.role}
                </div>
              </th>
              {courses.map((c) => {
                const cell = cells[s.userId]?.[c.id];
                return (
                  <td key={c.id} className="px-3 py-2 align-top">
                    <CellBadge cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellBadge({ cell }: { cell: GridCell | undefined }) {
  const tz = usePracticeTimezone();

  if (!cell || cell.status === "NOT_ASSIGNED") {
    return (
      <span className="text-muted-foreground" aria-label="Not assigned">
        —
      </span>
    );
  }

  if (cell.status === "COMPLETED") {
    const date = cell.completedAtIso
      ? formatPracticeDateLong(new Date(cell.completedAtIso), tz)
      : "";
    return (
      <Badge
        variant="secondary"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Completed {date}
      </Badge>
    );
  }

  if (cell.status === "OVERDUE") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-noncompliant)",
          borderColor: "var(--gw-color-noncompliant)",
        }}
      >
        Overdue
      </Badge>
    );
  }

  if (cell.status === "TO_DO") {
    return (
      <Badge variant="outline" className="text-[10px]">
        Expired · retake
      </Badge>
    );
  }

  // IN_PROGRESS — placeholder until PR 6 wires VideoProgress.
  return (
    <Badge variant="outline" className="text-[10px]">
      In Progress
    </Badge>
  );
}

// Re-exported for tests so they can pass the same status union the
// resolver emits. Avoids duplicating the literal union in test fixtures.
export type { GridCellStatus };
