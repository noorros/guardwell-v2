// src/lib/notifications/generators/allergyCompetencyDue.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { type NotificationProposal } from "./types";

/**
 * Staff missing current-year allergy competency. Emits ONE proposal per
 * recipient admin listing unqualified compounders (up to 5 + "and N more"
 * suffix), matching v1's ALLERGY_COMPETENCY_DUE logic.
 */
export async function generateAllergyCompetencyDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency. See generateAllergyNotifications comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!enabled) return [];

  const currentYear = new Date().getFullYear();

  const [allStaff, qualifiedCompetencies] = await Promise.all([
    tx.practiceUser.findMany({
      where: { practiceId, removedAt: null, requiresAllergyCompetency: true },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    tx.allergyCompetency.findMany({
      where: { practiceId, year: currentYear, isFullyQualified: true },
      select: { practiceUserId: true },
    }),
  ]);

  const qualifiedIds = new Set(qualifiedCompetencies.map((c) => c.practiceUserId));
  const unqualified = allStaff.filter((s) => !qualifiedIds.has(s.id));

  if (unqualified.length === 0) return [];

  const names = unqualified
    .slice(0, 5)
    .map((s) =>
      `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || "Staff member",
    );
  const suffix = unqualified.length > 5 ? ` and ${unqualified.length - 5} more` : "";
  const body = `The following staff do not have a current-year fully qualified allergy competency: ${names.join(", ")}${suffix}.`;

  return userIds.map((userId) => ({
    userId,
    practiceId,
    type: "ALLERGY_COMPETENCY_DUE" as NotificationType,
    severity: "WARNING" as NotificationSeverity,
    title: `${unqualified.length} staff missing ${currentYear} allergy competency`,
    body,
    href: "/programs/allergy",
    entityKey: `allergy-competency-due-${currentYear}`,
  }));
}
