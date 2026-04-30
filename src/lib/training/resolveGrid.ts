// src/lib/training/resolveGrid.ts
//
// Phase 4 PR 5 — server-side helper that builds the "Assignments grid"
// matrix shown at /programs/training/assignments. Given a list of staff
// (rows) and required courses (cols), plus the practice's full set of
// active assignments, exclusions, and passing completions, it computes
// a per-cell status that the page renders as a badge.
//
// The grid is read-only — this helper does not write events, mutate
// projection rows, or call the registry. It mirrors the per-user
// resolveAssignmentsForUser logic but evaluates the (staff, course)
// matrix in one pass so the page can render N×M cells without N×M
// resolver calls.
//
// Status priority (matches resolveAssignmentsForUser):
//   1. COMPLETED — a passing TrainingCompletion exists with expiresAt > now.
//   2. TO_DO     — assignment exists AND a passing completion exists but
//                  has expired (retake required) — surfaces as
//                  "Expired · retake".
//   3. OVERDUE   — assignment exists AND dueDate < now AND no passing
//                  completion (expired or otherwise).
//   4. IN_PROGRESS — assignment exists AND no completion AND no due date
//                    (or due date is in the future). PR 6 will refine this
//                    once VideoProgress lands; until then it's the catch-
//                    all for "assigned, not yet started/finished".
//   5. NOT_ASSIGNED — no assignment matches this (staff, course) pair.
//
// Multi-tenant rule: the caller is responsible for scoping the inputs
// (`staff`, `assignments`, `exclusions`, `completions`) to a single
// practice. This helper does not re-check practiceId on each row — it
// trusts the page's queries.

export type GridCellStatus =
  | "COMPLETED"
  | "TO_DO"
  | "OVERDUE"
  | "IN_PROGRESS"
  | "NOT_ASSIGNED";

export interface GridStaff {
  /** identity User.id (denormalized from PracticeUser.userId) */
  userId: string;
  /** PracticeRole — OWNER|ADMIN|STAFF|VIEWER */
  role: string;
  /** Per-user category (CLINICAL|ADMINISTRATIVE|MANAGEMENT|OTHER) — null
   * for now. Plumbed through ahead of the per-user category UI so the
   * resolver can OR it into assignment matching without another refactor. */
  category?: string | null;
}

export interface GridCourse {
  id: string;
}

export interface GridAssignment {
  id: string;
  courseId: string;
  assignedToUserId: string | null;
  assignedToRole: string | null;
  assignedToCategory: string | null;
  dueDate: Date | null;
}

export interface GridExclusion {
  assignmentId: string;
  userId: string;
}

export interface GridCompletion {
  userId: string;
  courseId: string;
  expiresAt: Date;
  completedAt: Date;
}

export interface GridCell {
  status: GridCellStatus;
  /** ISO string — completedAt for COMPLETED cells. The page formats
   * via the practice timezone before render. Null for non-completed
   * cells. */
  completedAtIso: string | null;
  /** ISO string — assignment dueDate for OVERDUE cells. Null otherwise. */
  dueDateIso: string | null;
}

export interface ResolveGridArgs {
  staff: GridStaff[];
  courses: GridCourse[];
  assignments: GridAssignment[];
  exclusions: GridExclusion[];
  completions: GridCompletion[];
  /** Defaults to `new Date()`. Injected for tests so we can pin a
   * deterministic "now" without vi.useFakeTimers. */
  now?: Date;
}

/**
 * Build a per-(staff, course) status map. Key shape: `${userId}:${courseId}`.
 *
 * Returns a plain Record keyed twice (`staffUserId → courseId → cell`) so
 * a server component can pass it to a client component without going
 * through Map → Object serialization. Lookup at render time is one
 * record dereference per cell — no array scans.
 */
export function resolveGridCells(args: ResolveGridArgs): Record<
  string,
  Record<string, GridCell>
> {
  const now = args.now ?? new Date();

  // Index exclusions by assignmentId → Set<userId> for O(1) lookups.
  const exclusionIndex = new Map<string, Set<string>>();
  for (const ex of args.exclusions) {
    const set = exclusionIndex.get(ex.assignmentId);
    if (set) {
      set.add(ex.userId);
    } else {
      exclusionIndex.set(ex.assignmentId, new Set([ex.userId]));
    }
  }

  // Index assignments by courseId for O(1) per-(staff, course) match.
  const assignmentsByCourse = new Map<string, GridAssignment[]>();
  for (const a of args.assignments) {
    const arr = assignmentsByCourse.get(a.courseId);
    if (arr) {
      arr.push(a);
    } else {
      assignmentsByCourse.set(a.courseId, [a]);
    }
  }

  // Index passing completions by `${userId}:${courseId}` → most-recent
  // completion (by completedAt). A user can have multiple passing
  // completions over time; we want the freshest so expired-but-renewed
  // certs read as COMPLETED.
  const completionIndex = new Map<string, GridCompletion>();
  for (const c of args.completions) {
    const key = `${c.userId}:${c.courseId}`;
    const prev = completionIndex.get(key);
    if (!prev || c.completedAt > prev.completedAt) {
      completionIndex.set(key, c);
    }
  }

  const result: Record<string, Record<string, GridCell>> = {};

  for (const staff of args.staff) {
    const row: Record<string, GridCell> = {};

    for (const course of args.courses) {
      const cell = computeCell({
        staff,
        course,
        assignmentsByCourse,
        exclusionIndex,
        completionIndex,
        now,
      });
      row[course.id] = cell;
    }

    result[staff.userId] = row;
  }

  return result;
}

interface ComputeArgs {
  staff: GridStaff;
  course: GridCourse;
  assignmentsByCourse: Map<string, GridAssignment[]>;
  exclusionIndex: Map<string, Set<string>>;
  completionIndex: Map<string, GridCompletion>;
  now: Date;
}

function computeCell({
  staff,
  course,
  assignmentsByCourse,
  exclusionIndex,
  completionIndex,
  now,
}: ComputeArgs): GridCell {
  // Look up an active passing completion FIRST — a fresh, unexpired
  // completion overrides any "OVERDUE" assignment status (a staffer who
  // completed it yesterday isn't overdue, even if the assignment's
  // dueDate is yesterday too).
  const completion = completionIndex.get(`${staff.userId}:${course.id}`);
  const completionFresh = completion ? completion.expiresAt > now : false;

  // Find the first matching active assignment for this (staff, course).
  // "Matching" = direct user match OR role match OR category match,
  // AND staff is NOT in the exclusion set for that assignment.
  const candidates = assignmentsByCourse.get(course.id) ?? [];
  let matchedAssignment: GridAssignment | null = null;
  for (const a of candidates) {
    const isMatch =
      a.assignedToUserId === staff.userId ||
      (a.assignedToRole !== null && a.assignedToRole === staff.role) ||
      (a.assignedToCategory !== null &&
        staff.category != null &&
        a.assignedToCategory === staff.category);
    if (!isMatch) continue;
    const excluded = exclusionIndex.get(a.id)?.has(staff.userId) ?? false;
    if (excluded) continue;
    matchedAssignment = a;
    break;
  }

  // Priority 1: COMPLETED if a fresh passing completion exists, even if
  // no current assignment (e.g. assignment was revoked after completion —
  // the user still gets credit on the grid).
  if (completion && completionFresh) {
    return {
      status: "COMPLETED",
      completedAtIso: completion.completedAt.toISOString(),
      dueDateIso: null,
    };
  }

  // No active assignment AND no fresh completion → either NOT_ASSIGNED
  // (no assignment at all) or stale-completion-only (treated as
  // NOT_ASSIGNED because there's no obligation today).
  if (!matchedAssignment) {
    return {
      status: "NOT_ASSIGNED",
      completedAtIso: null,
      dueDateIso: null,
    };
  }

  // Priority 2: TO_DO ("Expired · retake") — assignment + expired
  // passing completion. Mirrors resolveAssignmentsForUser's TO_DO branch
  // for stale completions.
  if (completion && !completionFresh) {
    return {
      status: "TO_DO",
      completedAtIso: completion.completedAt.toISOString(),
      dueDateIso: matchedAssignment.dueDate
        ? matchedAssignment.dueDate.toISOString()
        : null,
    };
  }

  // Priority 3: OVERDUE — assignment + dueDate < now + no passing
  // completion of any kind.
  if (matchedAssignment.dueDate && matchedAssignment.dueDate < now) {
    return {
      status: "OVERDUE",
      completedAtIso: null,
      dueDateIso: matchedAssignment.dueDate.toISOString(),
    };
  }

  // Priority 4: IN_PROGRESS placeholder — assignment exists, nothing
  // due, nothing completed. PR 6 will split this into "started" vs
  // "not started" via VideoProgress.
  return {
    status: "IN_PROGRESS",
    completedAtIso: null,
    dueDateIso: matchedAssignment.dueDate
      ? matchedAssignment.dueDate.toISOString()
      : null,
  };
}
