// THE SOURCE OF TRUTH for what events exist. Adding a new event type is a
// 3-step pattern:
//   1. Add the literal to `EventType` union below
//   2. Add the Zod schema to `EVENT_SCHEMAS` keyed by (type, version)
//   3. (Optional) Register a projection handler under src/lib/events/projections/

import { z } from "zod";

export const EVENT_TYPES = [
  "PRACTICE_CREATED",
  "USER_INVITED",
  "REQUIREMENT_STATUS_UPDATED",
  "OFFICER_DESIGNATED",
  "POLICY_ADOPTED",
  "POLICY_RETIRED",
  "TRAINING_COMPLETED",
  "VENDOR_UPSERTED",
  "VENDOR_BAA_EXECUTED",
  "VENDOR_REMOVED",
  "CREDENTIAL_UPSERTED",
  "CREDENTIAL_REMOVED",
  "SRA_COMPLETED",
  "SRA_DRAFT_SAVED",
  "INCIDENT_REPORTED",
  "INCIDENT_BREACH_DETERMINED",
  "INCIDENT_RESOLVED",
  "INCIDENT_NOTIFIED_HHS",
  "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
  "INCIDENT_NOTIFIED_MEDIA",
  "INCIDENT_NOTIFIED_STATE_AG",
  "INVITATION_ACCEPTED",
  "INVITATION_REVOKED",
  "INVITATION_RESENT",
  "MEMBER_REMOVED",
  "PRACTICE_PROFILE_UPDATED",
  "TRACK_GENERATED",
  "TRACK_TASK_COMPLETED",
  "TRACK_TASK_REOPENED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const REQUIREMENT_STATUS_VALUES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLIANT",
  "GAP",
  "NOT_APPLICABLE",
] as const;

export const OFFICER_ROLES = [
  "PRIVACY",
  "SECURITY",
  "COMPLIANCE",
  "SAFETY",
] as const;
export type OfficerRole = (typeof OFFICER_ROLES)[number];

export const EVENT_SCHEMAS = {
  PRACTICE_CREATED: {
    1: z.object({
      practiceName: z.string().min(1).max(200),
      primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
      ownerUserId: z.string().min(1),
    }),
  },
  USER_INVITED: {
    1: z.object({
      invitationId: z.string().min(1),
      invitedEmail: z.string().email(),
      role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
      expiresAt: z.string().datetime(),
    }),
  },
  INVITATION_ACCEPTED: {
    1: z.object({
      invitationId: z.string().min(1),
      acceptedByUserId: z.string().min(1),
      invitedEmail: z.string().email(),
      role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
    }),
  },
  INVITATION_REVOKED: {
    1: z.object({
      invitationId: z.string().min(1),
    }),
  },
  INVITATION_RESENT: {
    1: z.object({
      invitationId: z.string().min(1),
      newExpiresAt: z.string().datetime(),
    }),
  },
  MEMBER_REMOVED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      removedUserId: z.string().min(1),
    }),
  },
  REQUIREMENT_STATUS_UPDATED: {
    1: z.object({
      requirementId: z.string().min(1),
      frameworkCode: z.string().min(1),
      requirementCode: z.string().min(1),
      previousStatus: z.enum(REQUIREMENT_STATUS_VALUES).nullable(),
      nextStatus: z.enum(REQUIREMENT_STATUS_VALUES),
      source: z.enum(["USER", "AI_ASSESSMENT", "IMPORT", "DERIVED"]),
      reason: z.string().max(500).optional(),
    }),
  },
  OFFICER_DESIGNATED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      userId: z.string().min(1),
      officerRole: z.enum(OFFICER_ROLES),
      designated: z.boolean(),
    }),
  },
  POLICY_ADOPTED: {
    1: z.object({
      practicePolicyId: z.string().min(1),
      policyCode: z.string().min(1),
      version: z.number().int().positive(),
      acknowledgedByUserIds: z.array(z.string()).optional(),
    }),
  },
  POLICY_RETIRED: {
    1: z.object({
      practicePolicyId: z.string().min(1),
      policyCode: z.string().min(1),
    }),
  },
  TRAINING_COMPLETED: {
    1: z.object({
      trainingCompletionId: z.string().min(1),
      userId: z.string().min(1),
      courseId: z.string().min(1),
      courseCode: z.string().min(1),
      courseVersion: z.number().int().positive(),
      score: z.number().int().min(0).max(100),
      passed: z.boolean(),
      expiresAt: z.string().datetime(),
    }),
  },
  VENDOR_UPSERTED: {
    1: z.object({
      vendorId: z.string().min(1),
      name: z.string().min(1).max(200),
      type: z.string().max(50).nullable().optional(),
      service: z.string().max(500).nullable().optional(),
      contact: z.string().max(200).nullable().optional(),
      email: z.string().email().nullable().optional().or(z.literal("")),
      notes: z.string().max(2000).nullable().optional(),
      processesPhi: z.boolean(),
    }),
  },
  VENDOR_BAA_EXECUTED: {
    1: z.object({
      vendorId: z.string().min(1),
      executedAt: z.string().datetime(),
      expiresAt: z.string().datetime().nullable().optional(),
      baaDirection: z
        .enum(["PRACTICE_PROVIDED", "VENDOR_PROVIDED", "PLATFORM_ACKNOWLEDGMENT"])
        .nullable()
        .optional(),
    }),
  },
  VENDOR_REMOVED: {
    1: z.object({
      vendorId: z.string().min(1),
    }),
  },
  CREDENTIAL_UPSERTED: {
    1: z.object({
      credentialId: z.string().min(1),
      credentialTypeCode: z.string().min(1),
      holderId: z.string().min(1).nullable().optional(),
      title: z.string().min(1).max(200),
      licenseNumber: z.string().max(100).nullable().optional(),
      issuingBody: z.string().max(200).nullable().optional(),
      issueDate: z.string().datetime().nullable().optional(),
      expiryDate: z.string().datetime().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  CREDENTIAL_REMOVED: {
    1: z.object({
      credentialId: z.string().min(1),
    }),
  },
  SRA_COMPLETED: {
    1: z.object({
      assessmentId: z.string().min(1),
      completedByUserId: z.string().min(1),
      overallScore: z.number().int().min(0).max(100),
      addressedCount: z.number().int().min(0),
      totalCount: z.number().int().min(1),
      answers: z.array(
        z.object({
          questionCode: z.string().min(1),
          answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
          notes: z.string().max(2000).nullable().optional(),
        }),
      ),
    }),
  },
  // Save-as-you-go progress event. Emitted every time the SRA wizard
  // persists a step of the user's answers. Does NOT satisfy HIPAA_SRA —
  // only SRA_COMPLETED does. Idempotent on assessmentId.
  SRA_DRAFT_SAVED: {
    1: z.object({
      assessmentId: z.string().min(1),
      currentStep: z.number().int().min(0).max(2),
      answers: z.array(
        z.object({
          questionCode: z.string().min(1),
          answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
          notes: z.string().max(2000).nullable().optional(),
        }),
      ),
    }),
  },
  // A new privacy/security/OSHA event reported by a workforce member. Does
  // NOT immediately declare whether it's a HIPAA breach — that happens
  // in INCIDENT_BREACH_DETERMINED after the four-factor wizard.
  INCIDENT_REPORTED: {
    1: z.object({
      incidentId: z.string().min(1),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(5000),
      type: z.enum([
        "PRIVACY",
        "SECURITY",
        "OSHA_RECORDABLE",
        "NEAR_MISS",
        "DEA_THEFT_LOSS",
        "CLIA_QC_FAILURE",
        "TCPA_COMPLAINT",
      ]),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      phiInvolved: z.boolean(),
      affectedCount: z.number().int().min(0).nullable().optional(),
      discoveredAt: z.string().datetime(),
      patientState: z
        .string()
        .length(2)
        .regex(/^[A-Z]{2}$/)
        .nullable()
        .optional(),
      // OSHA-specific fields — only populated when type=OSHA_RECORDABLE.
      oshaBodyPart: z.string().max(200).nullable().optional(),
      oshaInjuryNature: z.string().max(200).nullable().optional(),
      oshaOutcome: z
        .enum([
          "DEATH",
          "DAYS_AWAY",
          "RESTRICTED",
          "OTHER_RECORDABLE",
          "FIRST_AID",
        ])
        .nullable()
        .optional(),
      oshaDaysAway: z.number().int().min(0).nullable().optional(),
      oshaDaysRestricted: z.number().int().min(0).nullable().optional(),
    }),
  },
  // HIPAA §164.402 four-factor breach determination result. Each factor
  // scored 1-5 (1=low-probability, 5=high-probability of compromise);
  // overallRiskScore is a 0-100 composite and isBreach is the final call.
  INCIDENT_BREACH_DETERMINED: {
    1: z.object({
      incidentId: z.string().min(1),
      factor1Score: z.number().int().min(1).max(5),
      factor2Score: z.number().int().min(1).max(5),
      factor3Score: z.number().int().min(1).max(5),
      factor4Score: z.number().int().min(1).max(5),
      overallRiskScore: z.number().int().min(0).max(100),
      isBreach: z.boolean(),
      affectedCount: z.number().int().min(0),
      ocrNotifyRequired: z.boolean(),
    }),
  },
  INCIDENT_RESOLVED: {
    1: z.object({
      incidentId: z.string().min(1),
      resolution: z.string().max(2000).nullable().optional(),
    }),
  },
  // Granular post-determination notification events. Each one updates a
  // dedicated timestamp column on Incident and triggers rederivation of
  // any requirement whose acceptedEvidenceTypes match the matching code
  // (e.g. INCIDENT:NOTIFIED_AFFECTED_INDIVIDUALS for the CA 15-business-
  // day overlay). notifiedAt is the wall-clock time the notice was sent
  // (not necessarily "now") so backdated entries are supported.
  INCIDENT_NOTIFIED_HHS: {
    1: z.object({
      incidentId: z.string().min(1),
      notifiedAt: z.string().datetime(),
    }),
  },
  INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS: {
    1: z.object({
      incidentId: z.string().min(1),
      notifiedAt: z.string().datetime(),
    }),
  },
  INCIDENT_NOTIFIED_MEDIA: {
    1: z.object({
      incidentId: z.string().min(1),
      notifiedAt: z.string().datetime(),
    }),
  },
  INCIDENT_NOTIFIED_STATE_AG: {
    1: z.object({
      incidentId: z.string().min(1),
      notifiedAt: z.string().datetime(),
      stateCode: z
        .string()
        .length(2)
        .regex(/^[A-Z]{2}$/),
    }),
  },
  // Practice compliance profile upsert. Emitted by the onboarding
  // compliance-profile step and the /settings/practice surface.
  // Projection writes PracticeComplianceProfile AND flips
  // PracticeFramework.enabled per the applicability matrix.
  PRACTICE_PROFILE_UPDATED: {
    1: z.object({
      hasInHouseLab: z.boolean(),
      dispensesControlledSubstances: z.boolean(),
      medicareParticipant: z.boolean(),
      billsMedicaid: z.boolean(),
      subjectToMacraMips: z.boolean(),
      sendsAutomatedPatientMessages: z.boolean(),
      specialtyCategory: z
        .enum([
          "PRIMARY_CARE",
          "SPECIALTY",
          "DENTAL",
          "BEHAVIORAL",
          "ALLIED",
          "OTHER",
        ])
        .nullable()
        .optional(),
      providerCount: z.number().int().min(0).nullable().optional(),
    }),
  },
  // Compliance Track auto-generation. Fired by generateTrackIfMissing
  // when PRACTICE_PROFILE_UPDATED runs and the practice has no track yet.
  TRACK_GENERATED: {
    1: z.object({
      templateCode: z.enum([
        "GENERAL_PRIMARY_CARE",
        "DENTAL",
        "BEHAVIORAL",
        "GENERIC",
      ]),
      taskCount: z.number().int().min(0),
    }),
  },
  // Track task lifecycle. reason="USER" when a user clicks Mark done;
  // "DERIVED" when the rederive hook auto-completes via requirementCode.
  TRACK_TASK_COMPLETED: {
    1: z.object({
      trackTaskId: z.string().min(1),
      completedByUserId: z.string().nullable(),
      reason: z.enum(["USER", "DERIVED"]),
    }),
  },
  TRACK_TASK_REOPENED: {
    1: z.object({
      trackTaskId: z.string().min(1),
    }),
  },
} as const;

export type PayloadFor<
  T extends EventType,
  V extends keyof (typeof EVENT_SCHEMAS)[T] = 1,
> = z.infer<(typeof EVENT_SCHEMAS)[T][V]>;

export function getEventSchema<T extends EventType>(
  type: T,
  version: number = 1,
) {
  const schemas = EVENT_SCHEMAS[type] as Record<number, z.ZodTypeAny>;
  const schema = schemas[version];
  if (!schema) {
    throw new Error(
      `No schema registered for event type=${type} version=${version}`,
    );
  }
  return schema;
}
