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
  "POLICY_REVIEWED",
  "TRAINING_COMPLETED",
  "VENDOR_UPSERTED",
  "VENDOR_BAA_EXECUTED",
  "VENDOR_REMOVED",
  "CREDENTIAL_UPSERTED",
  "CREDENTIAL_REMOVED",
  "CEU_ACTIVITY_LOGGED",
  "CEU_ACTIVITY_REMOVED",
  "CREDENTIAL_REMINDER_CONFIG_UPDATED",
  "SRA_COMPLETED",
  "SRA_DRAFT_SAVED",
  "INCIDENT_REPORTED",
  "INCIDENT_BREACH_DETERMINED",
  "INCIDENT_RESOLVED",
  "INCIDENT_NOTIFIED_HHS",
  "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
  "INCIDENT_NOTIFIED_MEDIA",
  "INCIDENT_NOTIFIED_STATE_AG",
  "INCIDENT_BREACH_MEMO_GENERATED",
  "INCIDENT_OSHA_LOG_GENERATED",
  "DEA_INVENTORY_RECORDED",
  "DEA_ORDER_RECEIVED",
  "DEA_DISPOSAL_COMPLETED",
  "DEA_THEFT_LOSS_REPORTED",
  "DEA_PDF_GENERATED",
  "INVITATION_ACCEPTED",
  "INVITATION_REVOKED",
  "INVITATION_RESENT",
  "MEMBER_REMOVED",
  "PRACTICE_PROFILE_UPDATED",
  "TRACK_GENERATED",
  "TRACK_TASK_COMPLETED",
  "TRACK_TASK_REOPENED",
  "DESTRUCTION_LOGGED",
  "TECH_ASSET_UPSERTED",
  "TECH_ASSET_RETIRED",
  "AUDIT_PREP_SESSION_OPENED",
  "AUDIT_PREP_STEP_COMPLETED",
  "AUDIT_PREP_STEP_REOPENED",
  "AUDIT_PREP_PACKET_GENERATED",
  "PHISHING_DRILL_LOGGED",
  "MFA_ENROLLMENT_RECORDED",
  "BACKUP_VERIFICATION_LOGGED",
  "POLICY_CONTENT_UPDATED",
  "POLICY_ACKNOWLEDGED",
  // Onboarding / billing — see docs/specs/onboarding-flow.md
  "SUBSCRIPTION_STARTED",
  "SUBSCRIPTION_STATUS_CHANGED",
  "PROMO_APPLIED",
  "ONBOARDING_FIRST_RUN_COMPLETED",
  // Allergy / USP 797 §21 — see docs/plans/2026-04-27-allergy-module.md
  "ALLERGY_QUIZ_COMPLETED",
  "ALLERGY_FINGERTIP_TEST_PASSED",
  "ALLERGY_MEDIA_FILL_PASSED",
  "ALLERGY_EQUIPMENT_CHECK_LOGGED",
  "ALLERGY_DRILL_LOGGED",
  // Evidence / file uploads — polymorphic across credentials, vendors, etc.
  // see docs/plans/2026-04-27-evidence-ceu-reminders.md
  "EVIDENCE_UPLOAD_REQUESTED",
  "EVIDENCE_UPLOAD_CONFIRMED",
  "EVIDENCE_DELETED",
  // BAA (Business Associate Agreement) lifecycle — see chunk 6 plan
  "BAA_DRAFT_UPLOADED",
  "BAA_SENT_TO_VENDOR",
  "BAA_ACKNOWLEDGED_BY_VENDOR",
  "BAA_EXECUTED_BY_VENDOR",
  "BAA_REJECTED_BY_VENDOR",
  // OSHA poster + PPE attestation — feeds OSHA_REQUIRED_POSTERS + OSHA_PPE
  // derivation rules (see src/lib/compliance/derivation/osha.ts).
  "POSTER_ATTESTATION",
  "PPE_ASSESSMENT_COMPLETED",
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
  // Annual review attestation. Bumps PracticePolicy.lastReviewedAt to
  // now and rederives HIPAA_POLICIES_REVIEW_CURRENT.
  POLICY_REVIEWED: {
    1: z.object({
      practicePolicyId: z.string().min(1),
      policyCode: z.string().min(1),
      reviewedByUserId: z.string().min(1),
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
  // Continuing-education activity logged against a credential. Counts
  // toward CredentialType.ceuRequirementHours within the renewal window.
  CEU_ACTIVITY_LOGGED: {
    1: z.object({
      ceuActivityId: z.string().min(1),
      credentialId: z.string().min(1),
      activityName: z.string().min(1).max(300),
      provider: z.string().max(200).nullable().optional(),
      activityDate: z.string().datetime(),
      hoursAwarded: z.number().min(0).max(1000),
      category: z.string().max(100).nullable().optional(),
      certificateEvidenceId: z.string().min(1).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Soft-delete of a CEU activity (sets retiredAt).
  CEU_ACTIVITY_REMOVED: {
    1: z.object({
      ceuActivityId: z.string().min(1),
      removedReason: z.string().max(500).nullable().optional(),
    }),
  },
  // Per-credential renewal-reminder schedule. Upserts the
  // CredentialReminderConfig row.
  CREDENTIAL_REMINDER_CONFIG_UPDATED: {
    1: z.object({
      configId: z.string().min(1),
      credentialId: z.string().min(1),
      enabled: z.boolean(),
      milestoneDays: z.array(z.number().int().min(0).max(365)).max(20),
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
      // 29 CFR §1910.1030 BBP sharps device type (needle / scalpel /
      // lancet / other). Required for the sharps injury log; the OSHA
      // 300 log doesn't surface it. Optional in v1 — older events and
      // non-sharps incidents omit.
      sharpsDeviceType: z.string().max(200).nullable().optional(),
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
      // HIPAA §164.402 documented memo. Optional in v1 for backward
      // compat with events written before 2026-04-27; UI requires it
      // for new determinations going forward.
      // NOTE: stricter `.min(40)` validation lives in the
      // `BreachInput` Zod schema in actions.ts — server actions are
      // the single source of truth for "substantive memo" enforcement.
      // Don't relax that without coordinating here.
      memoText: z.string().max(10000).optional(),
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
  // HIPAA audit-trail event: a breach memo PDF was generated and
  // delivered to a signed-in user. PHI-bearing read; the EventLog row
  // itself IS the audit trail (no projection state to update).
  INCIDENT_BREACH_MEMO_GENERATED: {
    1: z.object({
      incidentId: z.string().min(1),
      generatedByUserId: z.string().min(1),
    }),
  },
  // OSHA / employee-privacy audit-trail event: an OSHA Form 300 (annual
  // log) or Form 301 (single-incident report) PDF was generated. These
  // forms reveal employee identity + injury detail and are confidential
  // under 29 CFR §1904.35 + many state employment-record laws. Same
  // best-effort pattern as INCIDENT_BREACH_MEMO_GENERATED — the EventLog
  // row IS the audit trail; no projection state to update.
  INCIDENT_OSHA_LOG_GENERATED: {
    1: z.object({
      form: z.enum(["300", "301"]),
      incidentId: z.string().min(1).nullable().optional(),
      year: z.number().int().min(2000).max(2100).nullable().optional(),
      generatedByUserId: z.string().min(1),
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
      compoundsAllergens: z.boolean(),
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
  // Document retention destruction event. Each row = one batch of
  // documents destroyed; the projection writes a DestructionLog row +
  // rederives HIPAA_DOCUMENTATION_RETENTION (COMPLIANT when ≥1 entry
  // within last 365 days).
  DESTRUCTION_LOGGED: {
    1: z.object({
      destructionLogId: z.string().min(1),
      documentType: z.enum([
        "MEDICAL_RECORDS",
        "BILLING",
        "HR",
        "EMAIL_BACKUPS",
        "OTHER",
      ]),
      description: z.string().min(1).max(2000),
      volumeEstimate: z.string().max(200).nullable().optional(),
      method: z.enum([
        "SHREDDING",
        "SECURE_WIPE",
        "DEIDENTIFICATION",
        "INCINERATION",
        "OTHER",
      ]),
      performedByUserId: z.string().min(1),
      witnessedByUserId: z.string().nullable().optional(),
      certificateUrl: z.string().max(500).nullable().optional(),
      destroyedAt: z.string().datetime(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Technology asset inventory upsert (create + edit). Retirement uses
  // TECH_ASSET_RETIRED so the row is preserved for audit history.
  TECH_ASSET_UPSERTED: {
    1: z.object({
      techAssetId: z.string().min(1),
      name: z.string().min(1).max(200),
      assetType: z.enum([
        "SERVER",
        "LAPTOP",
        "DESKTOP",
        "MOBILE",
        "EMR",
        "NETWORK_DEVICE",
        "CLOUD_SERVICE",
        "OTHER",
      ]),
      processesPhi: z.boolean(),
      encryption: z.enum([
        "FULL_DISK",
        "FIELD_LEVEL",
        "NONE",
        "UNKNOWN",
      ]),
      vendor: z.string().max(200).nullable().optional(),
      location: z.string().max(200).nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  TECH_ASSET_RETIRED: {
    1: z.object({
      techAssetId: z.string().min(1),
    }),
  },
  // Audit Prep wizard lifecycle. See docs/specs/v1-ideas-survey.md §1.1
  // and docs/plans/2026-04-23-audit-prep-wizard.md.
  AUDIT_PREP_SESSION_OPENED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      mode: z.enum(["HHS_OCR_HIPAA", "OSHA", "CMS", "DEA"]),
      protocolCount: z.number().int().min(1),
      startedByUserId: z.string().min(1),
    }),
  },
  AUDIT_PREP_STEP_COMPLETED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      stepCode: z.string().min(1),
      status: z.enum(["COMPLETE", "NOT_APPLICABLE"]),
      completedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  AUDIT_PREP_STEP_REOPENED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      stepCode: z.string().min(1),
      reopenedByUserId: z.string().min(1),
    }),
  },
  AUDIT_PREP_PACKET_GENERATED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      generatedByUserId: z.string().min(1),
    }),
  },
  // ────────────────────────────────────────────────────────────────────
  // DEA controlled-substance recordkeeping (21 CFR Parts 1304, 1311)
  // ────────────────────────────────────────────────────────────────────
  // 21 CFR §1304.11 biennial inventory snapshot. Items list is the
  // count at the moment of inventory; subsequent dispense/order/disposal
  // events evolve the on-hand count as a derivation, not as a mutation
  // of inventory items themselves.
  DEA_INVENTORY_RECORDED: {
    1: z.object({
      inventoryId: z.string().min(1),
      asOfDate: z.string().datetime(),
      conductedByUserId: z.string().min(1),
      witnessUserId: z.string().min(1).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      items: z
        .array(
          z.object({
            drugName: z.string().min(1).max(200),
            ndc: z.string().max(50).nullable().optional(),
            schedule: z.enum([
              "CI",
              "CII",
              "CIIN",
              "CIII",
              "CIIIN",
              "CIV",
              "CV",
            ]),
            strength: z.string().max(100).nullable().optional(),
            quantity: z.number().int().min(0),
            unit: z.string().max(50),
          }),
        )
        .min(1),
    }),
  },
  // Form 222 / CSOS receipt of controlled-substance order. One event per
  // line item received (a multi-drug Form 222 fires multiple events).
  DEA_ORDER_RECEIVED: {
    1: z.object({
      orderRecordId: z.string().min(1),
      // Optional grouping key for multi-drug Form 222 orders. All line
      // items belonging to one order share the same orderBatchId so the
      // orders tab + Form 222 PDF can group them together.
      orderBatchId: z.string().min(1).nullable().optional(),
      orderedByUserId: z.string().min(1),
      supplierName: z.string().min(1).max(200),
      supplierDeaNumber: z.string().max(50).nullable().optional(),
      orderedAt: z.string().datetime(),
      receivedAt: z.string().datetime().nullable().optional(),
      form222Number: z.string().max(50).nullable().optional(),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantity: z.number().int().min(1),
      unit: z.string().max(50),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Surrender to reverse distributor / DEA take-back / on-site
  // destruction. One event per drug disposed. Generates Form 41.
  DEA_DISPOSAL_COMPLETED: {
    1: z.object({
      disposalRecordId: z.string().min(1),
      // Optional grouping key for multi-drug disposals (one reverse-
      // distributor pickup of several drugs). Form 41 PDF renders all
      // surrendered drugs under one filing when this key matches.
      disposalBatchId: z.string().min(1).nullable().optional(),
      disposedByUserId: z.string().min(1),
      witnessUserId: z.string().min(1).nullable().optional(),
      reverseDistributorName: z.string().min(1).max(200),
      reverseDistributorDeaNumber: z.string().max(50).nullable().optional(),
      disposalDate: z.string().datetime(),
      disposalMethod: z.enum([
        "REVERSE_DISTRIBUTOR",
        "DEA_TAKE_BACK",
        "DEA_DESTRUCTION",
        "OTHER",
      ]),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantity: z.number().int().min(1),
      unit: z.string().max(50),
      form41Filed: z.boolean(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Theft or loss event. Federal Form 106 must be filed within 1
  // business day of discovery. Optional incidentId links to a broader
  // Incident if the practice already opened a DEA_THEFT_LOSS incident.
  DEA_THEFT_LOSS_REPORTED: {
    1: z.object({
      reportId: z.string().min(1),
      // Optional grouping key for multi-drug theft/loss events (one
      // break-in or shipment loss involving several drugs). Form 106 PDF
      // renders the entire event as one filing when this key matches.
      reportBatchId: z.string().min(1).nullable().optional(),
      incidentId: z.string().min(1).nullable().optional(),
      reportedByUserId: z.string().min(1),
      discoveredAt: z.string().datetime(),
      lossType: z.enum([
        "THEFT",
        "LOSS",
        "IN_TRANSIT_LOSS",
        "DESTRUCTION_DURING_THEFT",
      ]),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantityLost: z.number().int().min(1),
      unit: z.string().max(50),
      methodOfDiscovery: z.string().max(2000).nullable().optional(),
      lawEnforcementNotified: z.boolean(),
      lawEnforcementAgency: z.string().max(200).nullable().optional(),
      lawEnforcementCaseNumber: z.string().max(100).nullable().optional(),
      deaNotifiedAt: z.string().datetime().nullable().optional(),
      form106SubmittedAt: z.string().datetime().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // DEA audit-trail event: every DEA PDF read (Inventory, Form 41, Form
  // 106) leaves an EventLog row. Same best-effort pattern as
  // INCIDENT_BREACH_MEMO_GENERATED + INCIDENT_OSHA_LOG_GENERATED — the
  // EventLog row IS the audit trail; no projection state to update.
  DEA_PDF_GENERATED: {
    1: z.object({
      form: z.enum(["INVENTORY", "FORM_41", "FORM_106"]),
      recordId: z.string().min(1),
      generatedByUserId: z.string().min(1),
    }),
  },
  // Cybersecurity emphasis (2026-04-23) — feeds /programs/cybersecurity
  // and HIPAA_PHISHING_DRILL_RECENT requirement.
  PHISHING_DRILL_LOGGED: {
    1: z.object({
      phishingDrillId: z.string().min(1),
      conductedAt: z.string().datetime(),
      vendor: z.string().max(200).nullable().optional(),
      totalRecipients: z.number().int().min(1),
      clickedCount: z.number().int().min(0),
      reportedCount: z.number().int().min(0),
      attachmentUrl: z.string().max(500).nullable().optional(),
      loggedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Officer-attested MFA enrollment for a specific user. We deliberately
  // do NOT integrate IdP webhooks for v2 launch — too many EHR/email
  // combos. Instead, an officer attests once per user (auditable event).
  MFA_ENROLLMENT_RECORDED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      enrolled: z.boolean(),
      recordedByUserId: z.string().min(1),
      notes: z.string().max(1000).nullable().optional(),
    }),
  },
  BACKUP_VERIFICATION_LOGGED: {
    1: z.object({
      backupVerificationId: z.string().min(1),
      verifiedAt: z.string().datetime(),
      scope: z.string().min(1).max(200),
      success: z.boolean(),
      restoreTimeMinutes: z.number().int().min(0).nullable().optional(),
      loggedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Saving the body of an adopted policy. Treated as both a content
  // edit AND an implicit review (save = read = review). Bumps version,
  // updates content, sets lastReviewedAt = now, and rederives the
  // cross-policy review-current rule. Emitted by /programs/policies/[id]
  // when the user clicks Save.
  POLICY_CONTENT_UPDATED: {
    1: z.object({
      practicePolicyId: z.string().min(1),
      policyCode: z.string().min(1).max(200),
      newVersion: z.number().int().positive(),
      contentLength: z.number().int().min(0),
      editedByUserId: z.string().min(1),
    }),
  },
  // Per-user policy acknowledgment. Captured when a workforce member
  // clicks Acknowledge on a policy detail page. policyVersion freezes
  // which version they signed; later edits to the policy bump the
  // current version and make this acknowledgment stale.
  POLICY_ACKNOWLEDGED: {
    1: z.object({
      practicePolicyId: z.string().min(1),
      policyCode: z.string().min(1).max(200),
      acknowledgingUserId: z.string().min(1),
      policyVersion: z.number().int().positive(),
      // Free-form signature text typed by the user — e.g. "I have read
      // and will comply with the HIPAA Privacy Policy. — Jane Doe"
      signatureText: z.string().min(1).max(500),
    }),
  },
  // ────────────────────────────────────────────────────────────────────
  // Onboarding / Billing — see docs/specs/onboarding-flow.md
  // ────────────────────────────────────────────────────────────────────
  // Stripe Checkout completed → subscription created. Fired once per
  // practice from the /api/stripe/webhook handler on
  // checkout.session.completed.
  SUBSCRIPTION_STARTED: {
    1: z.object({
      stripeCustomerId: z.string().min(1),
      stripeSubscriptionId: z.string().min(1),
      stripeCheckoutSessionId: z.string().min(1),
      priceId: z.string().min(1),
      billingInterval: z.enum(["month", "year"]),
      trialEndsAt: z.string().datetime().nullable(),
      promotionCodeId: z.string().nullable(),
      promotionCode: z.string().nullable(),
    }),
  },
  // Subscription state change from Stripe webhooks: customer.subscription.*
  // + invoice.payment_succeeded/failed. Captures the new status + window.
  SUBSCRIPTION_STATUS_CHANGED: {
    1: z.object({
      stripeSubscriptionId: z.string().min(1),
      previousStatus: z.enum([
        "INCOMPLETE",
        "TRIALING",
        "ACTIVE",
        "PAST_DUE",
        "CANCELED",
      ]),
      nextStatus: z.enum([
        "INCOMPLETE",
        "TRIALING",
        "ACTIVE",
        "PAST_DUE",
        "CANCELED",
      ]),
      currentPeriodEnd: z.string().datetime().nullable(),
      reason: z.string().max(200).nullable(),
    }),
  },
  // Independent record that a promotion code was applied to the
  // practice's subscription. Useful for audit trail + counting beta
  // enrollments without joining Stripe.
  PROMO_APPLIED: {
    1: z.object({
      stripeCustomerId: z.string().min(1),
      stripeSubscriptionId: z.string().min(1),
      promotionCodeId: z.string().min(1),
      promotionCode: z.string().min(1).max(200),
      percentOff: z.number().min(0).max(100).nullable(),
      durationLabel: z.string().max(40).nullable(), // "forever" | "once" | "repeating"
    }),
  },
  // Set on completion of the 4-step first-run wizard.
  ONBOARDING_FIRST_RUN_COMPLETED: {
    1: z.object({
      completedByUserId: z.string().min(1),
      stepsCompleted: z.array(z.string().min(1)),
      durationSeconds: z.number().int().min(0),
    }),
  },
  // ALLERGY_QUIZ_COMPLETED — emitted on quiz submission. Carries the
  // attempt id + score so the projection can update both the attempt row
  // and (if passed) the AllergyCompetency row for the year.
  ALLERGY_QUIZ_COMPLETED: {
    1: z.object({
      attemptId: z.string().min(1),
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      score: z.number().int().min(0).max(100),
      passed: z.boolean(),
      correctAnswers: z.number().int().min(0),
      totalQuestions: z.number().int().min(1),
      answers: z.array(
        z.object({
          questionId: z.string().min(1),
          selectedId: z.string().min(1),
          isCorrect: z.boolean(),
        }),
      ),
    }),
  },
  // ALLERGY_FINGERTIP_TEST_PASSED — supervisor attests a passing
  // gloved-fingertip + thumb sampling. Projection increments
  // fingertipPassCount on the year's AllergyCompetency (creates row
  // if missing) and recomputes isFullyQualified.
  ALLERGY_FINGERTIP_TEST_PASSED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      attestedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_MEDIA_FILL_PASSED — supervisor attests a passing media
  // fill test (incubated 14 days, no turbidity). Idempotent — the
  // projection only sets mediaFillPassedAt if currently null OR the
  // event date is more recent.
  ALLERGY_MEDIA_FILL_PASSED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      attestedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_EQUIPMENT_CHECK_LOGGED — emergency kit / fridge / supplies
  // check. Projection writes the AllergyEquipmentCheck row + triggers
  // rederive of ALLERGY_EMERGENCY_KIT_CURRENT + ALLERGY_REFRIGERATOR_LOG.
  ALLERGY_EQUIPMENT_CHECK_LOGGED: {
    1: z.object({
      equipmentCheckId: z.string().min(1),
      checkType: z.enum([
        "EMERGENCY_KIT",
        "REFRIGERATOR_TEMP",
        "SKIN_TEST_SUPPLIES",
      ]),
      checkedByUserId: z.string().min(1),
      checkedAt: z.string().datetime(),
      epiExpiryDate: z.string().datetime().nullable().optional(),
      epiLotNumber: z.string().max(100).nullable().optional(),
      allItemsPresent: z.boolean().nullable().optional(),
      itemsReplaced: z.string().max(2000).nullable().optional(),
      temperatureC: z.number().min(-20).max(40).nullable().optional(),
      inRange: z.boolean().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_DRILL_LOGGED — anaphylaxis emergency drill conducted at
  // the practice. Projection writes the AllergyDrill row + rederives
  // ALLERGY_ANNUAL_DRILL.
  ALLERGY_DRILL_LOGGED: {
    1: z.object({
      drillId: z.string().min(1),
      conductedByUserId: z.string().min(1),
      conductedAt: z.string().datetime(),
      scenario: z.string().min(1).max(2000),
      participantIds: z.array(z.string().min(1)).min(1),
      durationMinutes: z.number().int().min(0).nullable().optional(),
      observations: z.string().max(2000).nullable().optional(),
      correctiveActions: z.string().max(2000).nullable().optional(),
      nextDrillDue: z.string().datetime().nullable().optional(),
    }),
  },
  // ────────────────────────────────────────────────────────────────────
  // Evidence / file uploads — polymorphic, see Evidence model in schema.prisma
  // ────────────────────────────────────────────────────────────────────
  // Client requested a signed upload URL; Evidence row created with PENDING.
  EVIDENCE_UPLOAD_REQUESTED: {
    1: z.object({
      evidenceId: z.string().min(1),
      entityType: z.string().min(1).max(50),
      entityId: z.string().min(1),
      fileName: z.string().min(1).max(500),
      gcsKey: z.string().min(1).max(1000),
      mimeType: z.string().min(1).max(200),
      fileSizeBytes: z.number().int().min(0),
      uploadedById: z.string().min(1), // PracticeUser.id
    }),
  },
  // Client confirmed the file landed in GCS; status flips to UPLOADED.
  EVIDENCE_UPLOAD_CONFIRMED: {
    1: z.object({
      evidenceId: z.string().min(1),
    }),
  },
  // Soft-delete — status flips to DELETED; GCS lifecycle handles physical removal.
  EVIDENCE_DELETED: {
    1: z.object({
      evidenceId: z.string().min(1),
      reason: z.string().max(500).optional(),
    }),
  },
  // ────────────────────────────────────────────────────────────────────
  // BAA (Business Associate Agreement) lifecycle — see chunk 6 plan
  // ────────────────────────────────────────────────────────────────────
  // Practice uploaded a BAA draft document via the Evidence subsystem
  // and created a BaaRequest in DRAFT state.
  BAA_DRAFT_UPLOADED: {
    1: z.object({
      baaRequestId: z.string().min(1),
      vendorId: z.string().min(1),
      draftEvidenceId: z.string().min(1).nullable().optional(),
    }),
  },
  // Practice sent the BAA token link to the vendor's email. State moves
  // DRAFT → SENT. A new BaaAcceptanceToken is generated; older tokens
  // for this BaaRequest are revoked.
  BAA_SENT_TO_VENDOR: {
    1: z.object({
      baaRequestId: z.string().min(1),
      tokenId: z.string().min(1),
      token: z.string().min(1),
      tokenExpiresAt: z.string().datetime(),
      recipientEmail: z.string().email(),
      recipientMessage: z.string().max(2000).nullable().optional(),
    }),
  },
  // Vendor opened the accept-baa/[token] page; state moves SENT →
  // ACKNOWLEDGED. Idempotent — re-opens are no-ops.
  BAA_ACKNOWLEDGED_BY_VENDOR: {
    1: z.object({
      baaRequestId: z.string().min(1),
      tokenId: z.string().min(1),
      acknowledgedAt: z.string().datetime(),
    }),
  },
  // Vendor typed signature + agreed on the accept-baa/[token] page.
  // State moves ACKNOWLEDGED → EXECUTED. Captures HIPAA §164.504(e)
  // text e-signature + IP + user agent. Sets Vendor.baaExecutedAt
  // and (if provided) Vendor.baaExpiresAt as a side effect of the
  // projection.
  BAA_EXECUTED_BY_VENDOR: {
    1: z.object({
      baaRequestId: z.string().min(1),
      tokenId: z.string().min(1),
      executedAt: z.string().datetime(),
      vendorSignatureName: z.string().min(1).max(200),
      vendorSignatureIp: z.string().max(45).nullable().optional(), // IPv6 max
      vendorSignatureUserAgent: z.string().max(1000).nullable().optional(),
      // Optional expiry — practice can configure when sending; vendor
      // doesn't change it. Most BAAs are perpetual ("evergreen").
      expiresAt: z.string().datetime().nullable().optional(),
    }),
  },
  // Vendor declined the BAA. Modeled now for the post-launch UI but
  // not exposed in v1 forms. State moves ACKNOWLEDGED → REJECTED.
  BAA_REJECTED_BY_VENDOR: {
    1: z.object({
      baaRequestId: z.string().min(1),
      tokenId: z.string().min(1),
      rejectedAt: z.string().datetime(),
      reason: z.string().max(2000).nullable().optional(),
    }),
  },
  // Annual poster attestation — officer attests that required OSHA + state
  // workplace posters are posted in a conspicuous location. One attestation
  // per calendar year satisfies OSHA_REQUIRED_POSTERS (29 CFR §1903.2).
  POSTER_ATTESTATION: {
    1: z.object({
      attestationId: z.string().min(1),
      attestedByUserId: z.string().min(1),
      attestedAt: z.string().datetime(),
      posters: z.array(z.string().min(1)),
    }),
  },
  // PPE hazard assessment completion — officer or safety coordinator records
  // a completed PPE hazard assessment per 29 CFR §1910.132(d). One
  // assessment within the last 365 days satisfies OSHA_PPE.
  PPE_ASSESSMENT_COMPLETED: {
    1: z.object({
      assessmentId: z.string().min(1),
      conductedByUserId: z.string().min(1),
      conductedAt: z.string().datetime(),
      hazardsIdentified: z.array(z.string().min(1)),
      ppeRequired: z.array(z.string().min(1)),
      notes: z.string().max(2000).nullable(),
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
