// src/lib/compliance/derivation/shared.ts
//
// Cross-framework derivation helpers. Keep these narrow — anything
// framework-specific belongs in <framework>.ts.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

/**
 * Generic "≥ threshold of active workforce has a passed, non-expired
 * completion of a specific course" rule. Used by both HIPAA
 * (HIPAA_WORKFORCE_TRAINING) and OSHA (OSHA_BBP_TRAINING, etc.).
 *
 * @param courseCode Unique code on TrainingCourse (e.g. "HIPAA_BASICS")
 * @param threshold Fraction of workforce that must be covered (0-1). 0.95 by default.
 */
export function courseCompletionThresholdRule(
  courseCode: string,
  threshold = 0.95,
): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const course = await tx.trainingCourse.findUnique({
      where: { code: courseCode },
      select: { id: true },
    });
    if (!course) return null; // course not seeded yet → rule doesn't apply

    const activeUsers = await tx.practiceUser.findMany({
      where: { practiceId, removedAt: null },
      select: { userId: true },
    });
    if (activeUsers.length === 0) return "GAP";

    const completed = await tx.trainingCompletion.findMany({
      where: {
        practiceId,
        courseId: course.id,
        passed: true,
        expiresAt: { gt: new Date() },
      },
      distinct: ["userId"],
      select: { userId: true },
    });

    const completedIds = new Set(completed.map((c) => c.userId));
    const compliantCount = activeUsers.filter((u) =>
      completedIds.has(u.userId),
    ).length;

    return compliantCount / activeUsers.length >= threshold ? "COMPLIANT" : "GAP";
  };
}
