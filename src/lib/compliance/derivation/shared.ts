// src/lib/compliance/derivation/shared.ts
//
// Cross-framework derivation helpers. Keep these narrow — anything
// framework-specific belongs in <framework>.ts.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

/**
 * Generic: is there at least one active, non-expired Credential of the
 * given CredentialType.code on file for this practice? "active" =
 * retiredAt is null. "non-expired" = expiryDate is null (perpetual) OR
 * expiryDate is in the future.
 *
 * Used by DEA_REGISTRATION, CMS_PECOS_ENROLLMENT, CMS_NPI_REGISTRATION,
 * CMS_MEDICARE_PROVIDER_ENROLLMENT, and anything else satisfied by "one
 * active credential of type X".
 */
export function credentialTypePresentRule(
  credentialTypeCode: string,
): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const credType = await tx.credentialType.findUnique({
      where: { code: credentialTypeCode },
      select: { id: true },
    });
    if (!credType) return null; // type not seeded → rule doesn't apply

    const count = await tx.credential.count({
      where: {
        practiceId,
        credentialTypeId: credType.id,
        retiredAt: null,
        OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
      },
    });
    return count >= 1 ? "COMPLIANT" : "GAP";
  };
}

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

/**
 * Generic "≥ threshold of active workforce has completed ALL of the listed
 * courses (passed, non-expired)". Stricter than running multiple
 * single-course rules because a user only counts as compliant if they've
 * cleared the FULL set. Used for HIPAA_CYBER_TRAINING_COMPLETE which
 * requires all four cybersecurity courses.
 *
 * @param courseCodes List of TrainingCourse.code values that must all be completed
 * @param threshold Fraction of workforce required (0-1). 0.80 by default for cyber.
 */
export function multipleCoursesCompletionThresholdRule(
  courseCodes: string[],
  threshold = 0.8,
): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    if (courseCodes.length === 0) return null;
    const courses = await tx.trainingCourse.findMany({
      where: { code: { in: courseCodes } },
      select: { id: true, code: true },
    });
    // If any required course is missing from the catalog, the rule is
    // unsatisfiable — return null so we don't show a permanent GAP for
    // a course we never seeded.
    if (courses.length !== courseCodes.length) return null;

    const activeUsers = await tx.practiceUser.findMany({
      where: { practiceId, removedAt: null },
      select: { userId: true },
    });
    if (activeUsers.length === 0) return "GAP";

    const courseIds = courses.map((c) => c.id);
    const completed = await tx.trainingCompletion.findMany({
      where: {
        practiceId,
        courseId: { in: courseIds },
        passed: true,
        expiresAt: { gt: new Date() },
      },
      select: { userId: true, courseId: true },
    });

    // userId → set of completed course ids
    const byUser = new Map<string, Set<string>>();
    for (const c of completed) {
      const set = byUser.get(c.userId) ?? new Set<string>();
      set.add(c.courseId);
      byUser.set(c.userId, set);
    }

    const compliantCount = activeUsers.filter((u) => {
      const done = byUser.get(u.userId);
      if (!done) return false;
      return courseIds.every((id) => done.has(id));
    }).length;

    return compliantCount / activeUsers.length >= threshold
      ? "COMPLIANT"
      : "GAP";
  };
}
