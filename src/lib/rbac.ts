// Per-practice authorization. Pattern ported from v1: every dashboard
// page/action that touches a practice's data MUST resolve a PracticeUser
// before doing anything, then assert role >= minimum.
//
// Multi-tenant rule: every Prisma query MUST scope by practiceId. The
// helpers below are NOT a substitute for that — they assert the user
// CAN act within a practice; query-level scoping still required.

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSelectedPracticeId } from "@/lib/practice-cookie";
import { PracticeRole } from "@prisma/client";

const ROLE_HIERARCHY: Record<PracticeRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  STAFF: 2,
  VIEWER: 1,
};

export async function getPracticeUser(practiceId?: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Explicit practiceId arg always wins (e.g. an action targeting a
  // specific practice). When omitted, prefer the cookie-selected
  // practice (audit #7 multi-practice support); fall back to the
  // user's oldest membership if no cookie or the cookie value isn't
  // a current membership.
  if (practiceId) {
    const pu = await db.practiceUser.findFirst({
      where: { userId: user.id, practiceId, removedAt: null },
      include: { practice: true },
    });
    return pu ? { ...pu, dbUser: user } : null;
  }

  const cookieValue = await getSelectedPracticeId();
  if (cookieValue) {
    const pu = await db.practiceUser.findFirst({
      where: { userId: user.id, practiceId: cookieValue, removedAt: null },
      include: { practice: true },
    });
    if (pu) return { ...pu, dbUser: user };
    // Cookie points to a practice the user no longer belongs to (left,
    // removed, deleted). Fall through to oldest-membership lookup so
    // the page renders rather than 404'ing.
  }

  const pu = await db.practiceUser.findFirst({
    where: { userId: user.id, removedAt: null },
    include: { practice: true },
    orderBy: { joinedAt: "asc" },
  });

  return pu ? { ...pu, dbUser: user } : null;
}

/**
 * Returns every practice the user currently belongs to, ordered by
 * joinedAt (oldest first). Used by the PracticeSwitcher dropdown.
 */
export async function listMembershipsForCurrentUser() {
  const user = await getCurrentUser();
  if (!user) return [];
  const memberships = await db.practiceUser.findMany({
    where: { userId: user.id, removedAt: null },
    include: { practice: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    practiceUserId: m.id,
    practiceId: m.practiceId,
    practiceName: m.practice.name,
    role: m.role,
  }));
}

export async function requireRole(minRole: PracticeRole, practiceId?: string) {
  const pu = await getPracticeUser(practiceId);
  if (!pu) throw new Error("Unauthorized");
  if (ROLE_HIERARCHY[pu.role] < ROLE_HIERARCHY[minRole]) {
    throw new Error(`Requires ${minRole} role or higher`);
  }
  return pu;
}
