// Per-practice authorization. Pattern ported from v1: every dashboard
// page/action that touches a practice's data MUST resolve a PracticeUser
// before doing anything, then assert role >= minimum.
//
// Multi-tenant rule: every Prisma query MUST scope by practiceId. The
// helpers below are NOT a substitute for that — they assert the user
// CAN act within a practice; query-level scoping still required.

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
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

  const where = practiceId
    ? { userId: user.id, practiceId, removedAt: null }
    : { userId: user.id, removedAt: null };

  const pu = await db.practiceUser.findFirst({
    where,
    include: { practice: true },
    orderBy: { joinedAt: "asc" },
  });

  return pu ? { ...pu, dbUser: user } : null;
}

export async function requireRole(minRole: PracticeRole, practiceId?: string) {
  const pu = await getPracticeUser(practiceId);
  if (!pu) throw new Error("Unauthorized");
  if (ROLE_HIERARCHY[pu.role] < ROLE_HIERARCHY[minRole]) {
    throw new Error(`Requires ${minRole} role or higher`);
  }
  return pu;
}
