// src/lib/notifications/generators/cmsEnrollment.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal } from "./types";
import { daysUntil, ownerAdminUserIds } from "./helpers";
import { getEffectiveLeadTimes } from "../leadTimes";

const CMS_CREDENTIAL_TYPE_CODES = [
  "MEDICARE_PECOS_ENROLLMENT",
  "MEDICARE_PROVIDER_ENROLLMENT",
];

/**
 * Medicare/Medicaid revalidation reminder. Mirrors
 * generateCredentialRenewalNotifications' milestone-cross logic but
 * filtered to the two CMS credential type codes. Recipients are owners +
 * admins (CMS revalidation is an admin task, not staff).
 */
export async function generateCmsEnrollmentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { not: null },
      credentialType: { code: { in: CMS_CREDENTIAL_TYPE_CODES } },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      credentialType: { select: { code: true } },
      reminderConfig: {
        select: { enabled: true, milestoneDays: true },
      },
    },
  });

  // Per-credential reminderConfig still wins when set; per-practice
  // reminderSettings.cmsEnrollment is the fallback above the global default.
  const practiceMilestones = getEffectiveLeadTimes(
    reminderSettings,
    "cmsEnrollment",
  );

  const proposals: NotificationProposal[] = [];
  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : practiceMilestones;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue;

    // Audit #21 Credentials IM-7: same fix as generateCredentialRenewalNotifications.
    // Fire every milestone we're inside of; entityKey dedup prevents repeats.
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    const isPecos = cred.credentialType.code === "MEDICARE_PECOS_ENROLLMENT";
    const flavor = isPecos ? "PECOS" : "provider";
    const expiryStr = formatPracticeDate(cred.expiryDate, practiceTimezone);
    const title = `Medicare ${flavor} enrollment expires in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Revalidation must be completed via PECOS before ${expiryStr}.`;

    for (const matched of matchedMilestones) {
      const entityKey = `cms-enrollment:${cred.id}:milestone:${matched}`;
      for (const uid of adminIds) {
        proposals.push({
          userId: uid,
          practiceId,
          type: "CMS_ENROLLMENT_EXPIRING" as NotificationType,
          severity: "INFO" as NotificationSeverity,
          title,
          body,
          href: `/credentials/${cred.id}`,
          entityKey,
        });
      }
    }
  }
  return proposals;
}
