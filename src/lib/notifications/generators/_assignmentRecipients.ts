// src/lib/notifications/generators/_assignmentRecipients.ts
//
// Shared internal helpers for the three assignment-driven training
// generators (trainingAssigned, trainingDueSoon, trainingOverdueAssignment).
// Underscore-prefixed to signal "module-internal, not for direct import
// outside the generators/ folder." Not re-exported from index.ts.
//
// Lives in its own file (rather than helpers.ts) because it's domain-
// specific to training assignments — the three consumers all need it,
// but no other generator does.

import type { Prisma } from "@prisma/client";

export interface AssignmentRecipientRow {
  id: string;
  courseId: string;
  dueDate: Date | null;
  assignedToUserId: string | null;
  assignedToRole: string | null;
  assignedToCategory: string | null;
  course: { id: string; title: string };
}

export interface AssignmentRecipientContext {
  assignments: AssignmentRecipientRow[];
  exclusionsByAssignment: Map<string, Set<string>>;
  // PracticeUser rows for active members: userId → role. (category is plumbed
  // through but currently always null — see resolveGrid.ts comment.)
  members: Array<{ userId: string; role: string; category: string | null }>;
  // Latest passing completion per (userId, courseId) — used to suppress
  // notifications for users who already satisfy the assignment.
  passByUserCourse: Map<string, { id: string; expiresAt: Date }>;
}

/**
 * Single shared fetcher for the three assignment-driven generators. Pulls
 * active assignments + exclusions + member roster + latest passing
 * completions in 4 round trips, regardless of how many assignments exist.
 */
export async function loadAssignmentRecipientContext(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AssignmentRecipientContext> {
  const [assignments, exclusions, members, allPasses] = await Promise.all([
    tx.trainingAssignment.findMany({
      where: { practiceId, revokedAt: null },
      select: {
        id: true,
        courseId: true,
        dueDate: true,
        assignedToUserId: true,
        assignedToRole: true,
        assignedToCategory: true,
        course: { select: { id: true, title: true } },
      },
    }),
    tx.assignmentExclusion.findMany({
      where: { assignment: { practiceId } },
      select: { assignmentId: true, userId: true },
    }),
    tx.practiceUser.findMany({
      where: { practiceId, removedAt: null },
      select: { userId: true, role: true },
    }),
    tx.trainingCompletion.findMany({
      where: { practiceId, passed: true },
      select: {
        id: true,
        userId: true,
        courseId: true,
        completedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const exclusionsByAssignment = new Map<string, Set<string>>();
  for (const ex of exclusions) {
    const set = exclusionsByAssignment.get(ex.assignmentId);
    if (set) {
      set.add(ex.userId);
    } else {
      exclusionsByAssignment.set(ex.assignmentId, new Set([ex.userId]));
    }
  }

  // Latest passing completion per (userId, courseId). Caller wants the
  // freshest because validity windows roll forward — an old expired
  // completion shouldn't shadow a recent one.
  const passByUserCourse = new Map<string, { id: string; expiresAt: Date }>();
  for (const c of allPasses) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = passByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      passByUserCourse.set(key, { id: c.id, expiresAt: c.expiresAt });
    }
  }

  return {
    assignments,
    exclusionsByAssignment,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      // TODO(when-PracticeUser.category-lands): once the schema adds a
      // category column on PracticeUser, this path will route assignments
      // to all matching staff. The category-only test in
      // tests/integration/training-notifications.test.ts (currently asserts
      // zero proposals) will need to be updated to seed a category-tagged
      // member and assert routing.
      category: null, // PracticeUser has no per-user category column today
    })),
    passByUserCourse,
  };
}

/**
 * Resolve the eligible recipient userIds for a single assignment, given the
 * shared context. Mirrors resolveAssignmentsForUser's eligibility predicate:
 *   - assignedToUserId === user.id, OR
 *   - assignedToRole === user.role (and role is non-null on assignment), OR
 *   - assignedToCategory === user.category (and both non-null)
 *   - AND user is not in exclusionsByAssignment for this assignment
 */
export function resolveAssignmentRecipients(
  assignment: AssignmentRecipientRow,
  ctx: AssignmentRecipientContext,
): string[] {
  const excluded = ctx.exclusionsByAssignment.get(assignment.id);
  const recipients: string[] = [];
  for (const m of ctx.members) {
    const isMatch =
      assignment.assignedToUserId === m.userId ||
      (assignment.assignedToRole !== null &&
        assignment.assignedToRole === m.role) ||
      (assignment.assignedToCategory !== null &&
        m.category !== null &&
        assignment.assignedToCategory === m.category);
    if (!isMatch) continue;
    if (excluded?.has(m.userId)) continue;
    recipients.push(m.userId);
  }
  return recipients;
}
