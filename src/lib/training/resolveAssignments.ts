// src/lib/training/resolveAssignments.ts
//
// Phase 4 PR 3 — read-time resolver that takes a (practiceId, userId, role,
// category?) tuple and returns the user's "My Training" view: every active
// (non-revoked) TrainingAssignment that targets them directly, by role, or
// by category, minus per-user exclusions, joined to the latest passing
// TrainingCompletion to compute a 4-state status.
//
// Status derivation:
//   - COMPLETED: a passing completion exists AND has not yet expired
//   - TO_DO:     no completion, OR a passing completion that is now expired
//                (the user must retake)
//   - OVERDUE:   no completion AND dueDate < now
//   - IN_PROGRESS: not derivable here yet — PR 6 (BYOV) wires this through
//                  VideoProgress. Until then, every "started but unfinished"
//                  attempt looks identical to TO_DO.
//
// Multi-tenant rule: every Prisma query in this file MUST scope by
// practiceId. The resolver only reads, so the no-direct-projection-mutation
// lint rule does not fire.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

interface Args {
  practiceId: string;
  userId: string;
  role: string;
  category?: string | null;
}

export type ResolvedAssignmentStatus =
  | "TO_DO"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE";

export interface ResolvedAssignment {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  type: string;
  durationMinutes: number | null;
  dueDate: Date | null;
  requiredFlag: boolean;
  status: ResolvedAssignmentStatus;
  completionScore: number | null;
  completionExpiresAt: Date | null;
}

export async function resolveAssignmentsForUser(args: Args): Promise<{
  assignments: ResolvedAssignment[];
  completed: number;
  inProgress: number;
  toDo: number;
}> {
  const orClauses: Prisma.TrainingAssignmentWhereInput[] = [
    { assignedToUserId: args.userId },
    { assignedToRole: args.role },
  ];
  if (args.category) {
    orClauses.push({ assignedToCategory: args.category });
  }

  const rows = await db.trainingAssignment.findMany({
    where: {
      practiceId: args.practiceId,
      revokedAt: null,
      OR: orClauses,
    },
    include: { course: true },
  });

  // Per-user exclusions on role/category-wide assignments. Direct
  // single-user assignments don't get excluded — that would be a no-op
  // here, but we still scope the query so a stray exclusion row from a
  // legacy data state can't accidentally hide a direct assignment.
  const exclusions = rows.length
    ? await db.assignmentExclusion.findMany({
        where: {
          userId: args.userId,
          assignmentId: { in: rows.map((r) => r.id) },
        },
      })
    : [];
  const excludedIds = new Set(exclusions.map((e) => e.assignmentId));
  const eligible = rows.filter((r) => !excludedIds.has(r.id));

  // Only need passing completions — a failed attempt doesn't satisfy an
  // assignment. Order desc so the .find() below picks the most recent.
  const completions = eligible.length
    ? await db.trainingCompletion.findMany({
        where: {
          practiceId: args.practiceId,
          userId: args.userId,
          courseId: { in: eligible.map((r) => r.courseId) },
          passed: true,
        },
        orderBy: { completedAt: "desc" },
      })
    : [];

  const now = new Date();
  const resolved: ResolvedAssignment[] = eligible.map((a) => {
    const completion = completions.find((c) => c.courseId === a.courseId);
    let status: ResolvedAssignmentStatus = "TO_DO";
    if (completion) {
      status = completion.expiresAt < now ? "TO_DO" : "COMPLETED";
    } else if (a.dueDate && a.dueDate < now) {
      status = "OVERDUE";
    }
    return {
      id: a.id,
      courseId: a.courseId,
      courseCode: a.course.code,
      courseTitle: a.course.title,
      type: a.course.type,
      durationMinutes: a.course.durationMinutes,
      dueDate: a.dueDate,
      requiredFlag: a.requiredFlag,
      status,
      completionScore: completion?.score ?? null,
      completionExpiresAt: completion?.expiresAt ?? null,
    };
  });

  return {
    assignments: resolved,
    completed: resolved.filter((r) => r.status === "COMPLETED").length,
    // PR 6 will track in-progress via VideoProgress. Until then no
    // assignment can land in this state and the count stays 0.
    inProgress: 0,
    toDo: resolved.filter((r) => r.status === "TO_DO" || r.status === "OVERDUE")
      .length,
  };
}
