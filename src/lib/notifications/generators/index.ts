// src/lib/notifications/generators/index.ts
//
// Barrel re-export for the per-type generator family. Existing import
// paths like `from "@/lib/notifications/generators"` resolve here, so
// the file split is invisible to callers.

export type { NotificationProposal } from "./types";
export { generateAllNotifications } from "./all";

// Per-type generators — re-exported so test files and any future
// caller can import a single generator directly via the barrel.
export { generateSraNotifications } from "./sra";
export { generateCredentialNotifications } from "./credential";
export { generateCredentialRenewalNotifications } from "./credentialRenewal";
export { generateCredentialEscalationNotifications } from "./credentialEscalation";
export { generateCmsEnrollmentNotifications } from "./cmsEnrollment";
export { generateBaaSignaturePendingNotifications } from "./baaSignaturePending";
export { generateBaaExpiringNotifications } from "./baaExpiring";
export { generateBaaExecutedNotifications } from "./baaExecuted";
export { generateIncidentNotifications } from "./incident";
export { generateBreachDeterminationDeadlineNotifications } from "./breachDeadline";
export { generatePolicyReviewDueNotifications } from "./policyReviewDue";
export { generatePolicyAcknowledgmentPendingNotifications } from "./policyAcknowledgmentPending";
export { generateTrainingOverdueNotifications } from "./trainingOverdueCompletion";
export { generateTrainingEscalationNotifications } from "./trainingEscalation";
export { generateTrainingAssignedNotifications } from "./trainingAssigned";
export { generateTrainingDueSoonNotifications } from "./trainingDueSoon";
export { generateTrainingOverdueAssignmentNotifications } from "./trainingOverdueAssignment";
export { generateTrainingExpiringNotifications } from "./trainingExpiring";
export { generateOshaPostingReminderNotifications } from "./oshaPosting";
export { generateAllergyNotifications } from "./allergy";
export { generateAllergyCompetencyDueNotifications } from "./allergyCompetencyDue";
export { generateDeaBiennialInventoryDueNotifications } from "./deaBiennialInventory";
export { generatePhishingDrillDueNotifications } from "./phishingDrillDue";
export { generateBackupVerificationOverdueNotifications } from "./backupVerificationOverdue";
export { generateDocumentDestructionOverdueNotifications } from "./documentDestructionOverdue";
export { generateWelcomeNotifications } from "./welcome";
export { generateSystemNotifications } from "./system";
