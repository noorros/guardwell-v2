// src/lib/notifications/generators/all.ts
//
// Fan-in over every per-type generator. Order doesn't affect uniqueness
// (dedup runs on insert), but sorting keeps the digest email body in a
// predictable order.

import type { Prisma } from "@prisma/client";
import { type NotificationProposal } from "./types";
import { generateSraNotifications } from "./sra";
import { generateCredentialNotifications } from "./credential";
import { generateCredentialRenewalNotifications } from "./credentialRenewal";
import { generateCredentialEscalationNotifications } from "./credentialEscalation";
import { generateCmsEnrollmentNotifications } from "./cmsEnrollment";
import { generateBaaSignaturePendingNotifications } from "./baaSignaturePending";
import { generateBaaExpiringNotifications } from "./baaExpiring";
import { generateBaaExecutedNotifications } from "./baaExecuted";
import { generateIncidentNotifications } from "./incident";
import { generateBreachDeterminationDeadlineNotifications } from "./breachDeadline";
import { generatePolicyReviewDueNotifications } from "./policyReviewDue";
import { generatePolicyAcknowledgmentPendingNotifications } from "./policyAcknowledgmentPending";
import { generateTrainingOverdueNotifications } from "./trainingOverdueCompletion";
import { generateTrainingEscalationNotifications } from "./trainingEscalation";
import { generateTrainingAssignedNotifications } from "./trainingAssigned";
import { generateTrainingDueSoonNotifications } from "./trainingDueSoon";
import { generateTrainingOverdueAssignmentNotifications } from "./trainingOverdueAssignment";
import { generateTrainingExpiringNotifications } from "./trainingExpiring";
import { generateOshaPostingReminderNotifications } from "./oshaPosting";
import { generateAllergyNotifications } from "./allergy";
import { generateAllergyCompetencyDueNotifications } from "./allergyCompetencyDue";
import { generateDeaBiennialInventoryDueNotifications } from "./deaBiennialInventory";
import { generatePhishingDrillDueNotifications } from "./phishingDrillDue";
import { generateBackupVerificationOverdueNotifications } from "./backupVerificationOverdue";
import { generateDocumentDestructionOverdueNotifications } from "./documentDestructionOverdue";
import { generateWelcomeNotifications } from "./welcome";
import { generateSystemNotifications } from "./system";

/**
 * Aggregate all generators for a practice. Order doesn't affect
 * uniqueness (dedup runs on insert), but sorting keeps the digest email
 * body in a predictable order.
 */
export async function generateAllNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  if (userIds.length === 0) return [];
  const [
    sra,
    creds,
    credRenewals,
    credEscalation,
    cmsEnrollment,
    baaSignaturePending,
    baaExpiring,
    baaExecuted,
    incidents,
    breachDeadline,
    policies,
    policyAck,
    training,
    trainingEscalation,
    trainingAssigned,
    trainingDueSoon,
    trainingOverdueAssignment,
    trainingExpiring,
    osha,
    allergy,
    allergyCompetency,
    deaBiennial,
    phishingDrill,
    backupVerification,
    documentDestruction,
    welcome,
    system,
  ] = await Promise.all([
    generateSraNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialRenewalNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateCredentialEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCmsEnrollmentNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateBaaSignaturePendingNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBaaExpiringNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateBaaExecutedNotifications(tx, practiceId, userIds, practiceTimezone),
    generateIncidentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBreachDeterminationDeadlineNotifications(tx, practiceId, userIds, practiceTimezone),
    generatePolicyReviewDueNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generatePolicyAcknowledgmentPendingNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingAssignedNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingDueSoonNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateTrainingOverdueAssignmentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingExpiringNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateOshaPostingReminderNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyCompetencyDueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateDeaBiennialInventoryDueNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generatePhishingDrillDueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBackupVerificationOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateDocumentDestructionOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateWelcomeNotifications(tx, practiceId, userIds, practiceTimezone),
    generateSystemNotifications(tx, practiceId, userIds, practiceTimezone),
  ]);
  return [
    ...sra,
    ...creds,
    ...credRenewals,
    ...credEscalation,
    ...cmsEnrollment,
    ...baaSignaturePending,
    ...baaExpiring,
    ...baaExecuted,
    ...incidents,
    ...breachDeadline,
    ...policies,
    ...policyAck,
    ...training,
    ...trainingEscalation,
    ...trainingAssigned,
    ...trainingDueSoon,
    ...trainingOverdueAssignment,
    ...trainingExpiring,
    ...osha,
    ...allergy,
    ...allergyCompetency,
    ...deaBiennial,
    ...phishingDrill,
    ...backupVerification,
    ...documentDestruction,
    ...welcome,
    ...system,
  ];
}
