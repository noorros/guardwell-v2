# HIPAA Surface Inventory — GuardWell v2

**Date:** 2026-04-29
**Source:** Explore agent run, working dir `D:/GuardWell/guardwell-v2/`
**Purpose:** Input for code-reviewer pass + Chrome interactive verify

## Totals
- ~180 files directly touching HIPAA across modules / incidents / vendors / policies / training / SRA / API / projections / tests
- ~8,000 LOC: derivation rules ~560, incident/breach ~2,200, SRA ~1,800, vendors/BAA ~1,900, policies ~1,200, training ~800, projections ~1,200, tests ~3,500

## 1. Module page & UI components
- `src/app/(dashboard)/modules/[code]/page.tsx` — HIPAA module detail view with requirement grid
- `src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx` — Requirement status checklist item renderer
- `src/app/(dashboard)/modules/[code]/RequirementAiHelp.tsx` — AI-generated requirement explanation drawer
- `src/app/(dashboard)/modules/[code]/actions.ts` — Requirement status update, mark not-applicable
- `src/app/(dashboard)/modules/[code]/ai-actions.ts` — AI prompt generation for requirement details
- `src/components/gw/Extras/HipaaExtras.tsx` — HIPAA-specific UI extras (breach banner, officer cards)
- `src/components/gw/Extras/registry.tsx` — Component registry for module overlay sections
- `src/components/gw/MajorBreachBanner/index.tsx` — >500-individual breach alert banner (MAJOR_BREACH_THRESHOLD)
- `src/components/gw/MajorBreachBanner/MajorBreachBanner.test.tsx`
- `src/components/gw/MajorBreachBanner/MajorBreachBanner.stories.tsx`
- `src/components/gw/AiAssistDrawer/AiAssistDrawer.tsx` — Requirement help drawer with AI

## 2. Prisma schema models (HIPAA-relevant)
- `Practice` — id, name, primaryState, operatingStates[], specialty, npiNumber, ehrSystem, phone, address*
- `PracticeUser` — practiceId, userId, isPrivacyOfficer, isSecurityOfficer, mfaEnrolledAt, role, removedAt
- `Incident` — type, severity, status, isBreach, phiInvolved, affectedCount, patientState, discoveredAt, reportedAt, affectedIndividualsNotifiedAt, resolvedAt
- `Vendor` — name, type, service, processesPhi, baaExecutedAt, baaExpiresAt, retiredAt
- `BaaRequest` — status (DRAFT|SENT|ACCEPTED|EXECUTED|EXPIRED), draftEvidenceId, recipientEmail, sentAt, acceptedAt, signedAt, expiresAt
- `BaaAcceptanceToken` — token, email, acceptedAt, expiresAt
- `PracticePolicy` — policyCode, version, adoptedAt, retiredAt, lastReviewedAt, currentContent
- `PolicyVersion` — practicePolicyId, version, content
- `PolicyAcknowledgment` — practicePolicyId, userId, policyVersion, acknowledgedAt
- `PracticeSraAssessment` — completedByUserId, framework, completedAt, scoreSnapshot, capGenerated, capReviewedAt
- `PracticeSraAnswer` — sraAssessmentId, questionId, selectedValue, notes
- `PracticeSraDraft` — practiceId, draftData (JSON), savedAt, expiresAt
- `TrainingCourse` — code, framework, title, duration
- `TrainingCompletion` — userId, courseId, completedAt, expiresAt, certificateUrl
- `RegulatoryFramework`, `RegulatoryRequirement` — framework registry
- `ComplianceItem` — practiceId, requirementId, status, evidence, lastStatusAt
- `EventLog` — practiceId, eventType, eventData, createdAt
- `DestructionLog`, `PhishingDrill`, `BackupVerification` — supporting evidence rows

## 3. Derivation rules + framework registration
- `src/lib/compliance/derivation/hipaa.ts` — 16 wired rules: hipaaPrivacyOfficerRule, hipaaSecurityOfficerRule, hipaaPoliciesProceduresRule, hipaaPoliciesReviewCurrentRule, hipaaBreachResponseRule, hipaaWorkforceTrainingRule, hipaaBaaRule, hipaaCyberTrainingCompleteRule, hipaaMfaCoverageRule, hipaaPhishingDrillRecentRule, hipaaBackupVerifiedRecentRule, hipaaDocumentationRetentionRule, hipaaPolicyAcknowledgmentCoverageRule + 50-state breach notification overlays
- `src/lib/compliance/derivation/hipaaSra.ts` — hipaaSraRule (PracticeSraAssessment.completedAt within 365 days)
- `src/lib/compliance/derivation/index.ts` — Rule registry & rederive orchestration
- `src/lib/compliance/derivation/shared.ts` — courseCompletionThresholdRule + multipleCoursesCompletionThresholdRule factories
- `src/lib/compliance/policies.ts` — HIPAA_PP_POLICY_SET
- `src/lib/events/registry.ts` — Event type enum (PolicyAdopted, IncidentReported, BreachDetermined, BaaSent/Accepted/Executed, SraCompleted/SraDraftSaved, TrainingCompleted, VendorAdded/Retired, etc.)
- `src/lib/events/projections/` — per-event projection handlers

## 4. Policy templates + seed data
- `scripts/seed-hipaa.ts` — HIPAA_PRIVACY_POLICY, HIPAA_SECURITY_POLICY, HIPAA_BREACH_RESPONSE_POLICY, HIPAA_NPP_POLICY, HIPAA_MINIMUM_NECESSARY_POLICY, HIPAA_WORKSTATION_POLICY
- `scripts/seed-training.ts` — HIPAA_BASICS, HIPAA_BREACH_RESPONSE, HIPAA_BAA_MGMT, HIPAA_MINIMUM_NECESSARY, HIPAA_DOCUMENTATION + cybersecurity courses
- `scripts/_v1-policy-templates-export.json` — Legacy v1 policy template content
- `src/lib/compliance/policies.ts` — Policy metadata
- `src/lib/compliance/policy-prereqs.ts` — Prerequisite enforcement (breach response requires privacy + security)

## 5. Training + onboarding
- `src/app/(dashboard)/programs/training/page.tsx` — Training dashboard
- `src/app/(dashboard)/programs/training/[courseId]/page.tsx` — Course detail
- `src/app/(dashboard)/programs/training/[courseId]/QuizRunner.tsx` — Quiz execution
- `src/app/(dashboard)/programs/training/actions.ts` — completeTrainingAction, reassignCourseAction
- `src/app/(dashboard)/programs/training/TrainingStatusBadge.tsx`
- `src/lib/onboarding/drip-content.ts` — Drip email content (HIPAA modules in week 1-2)
- `src/lib/onboarding/run-drip.ts` — Daily drip executor
- `src/lib/track/templates.ts` — HIPAA_MANDATORY_TRACK
- `src/lib/events/projections/trainingCompleted.ts`

## 6. Incidents / breach determination
- `src/app/(dashboard)/programs/incidents/page.tsx` — Incidents list
- `src/app/(dashboard)/programs/incidents/new/IncidentReportForm.tsx`
- `src/app/(dashboard)/programs/incidents/new/page.tsx`
- `src/app/(dashboard)/programs/incidents/[id]/page.tsx` — Incident detail
- `src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx` — 4-factor wizard
- `src/app/(dashboard)/programs/incidents/[id]/NotificationLog.tsx`
- `src/app/(dashboard)/programs/incidents/[id]/ResolveButton.tsx`
- `src/app/(dashboard)/programs/incidents/actions.ts` — incidentReportAction, markBreachAction, recordNotificationAction, resolveIncidentAction
- `src/lib/events/projections/incident.ts`
- `src/lib/audit/incident-breach-memo-pdf.tsx` — Breach memo PDF template
- `src/lib/severity.ts` — Severity computation
- `src/lib/notifications/critical-alert.ts` — 500+ alert
- `src/lib/notifications/generators.ts` — NotificationOfBreach template

## 7. Risk / SRA — HIPAA-only
- `src/app/(dashboard)/programs/risk/page.tsx` — SRA list
- `src/app/(dashboard)/programs/risk/new/SraWizard.tsx` — 80q wizard
- `src/app/(dashboard)/programs/risk/new/page.tsx`
- `src/app/(dashboard)/programs/risk/[id]/page.tsx` — Result + score breakdown
- `src/app/(dashboard)/programs/risk/actions.ts` — startSraAction, saveSraDraftAction, completeSraAction, generateCapAction
- `src/app/(dashboard)/programs/risk/SraAssessmentBadge.tsx`
- `src/lib/compliance/derivation/hipaaSra.ts`
- `src/lib/events/projections/sraDraftSaved.ts`
- `src/lib/events/projections/sraCompleted.ts`
- `scripts/_v1-hipaa-101-export.json` — Seeded 80q questions (ported from v1)

## 8. Vendors / BAAs — HIPAA-only
- `src/app/(dashboard)/programs/vendors/page.tsx`
- `src/app/(dashboard)/programs/vendors/[id]/page.tsx`
- `src/app/(dashboard)/programs/vendors/[id]/VendorDetail.tsx`
- `src/app/(dashboard)/programs/vendors/[id]/actions.ts` — updateVendorAction, sendBaaAction, executeBaaAction, retireVendorAction
- `src/app/(dashboard)/programs/vendors/AddVendorForm.tsx`
- `src/app/(dashboard)/programs/vendors/VendorActions.tsx`
- `src/app/(dashboard)/programs/vendors/BaaStatusBadge.tsx`
- `src/app/(dashboard)/programs/vendors/bulk-import/VendorBulkImport.tsx`
- `src/app/(dashboard)/programs/vendors/bulk-import/page.tsx`
- `src/app/accept-baa/[token]/page.tsx` — Public route, token-validated
- `src/app/accept-baa/[token]/AcceptBaaForm.tsx` — E-signature form
- `src/app/accept-baa/[token]/actions.ts` — acceptBaaAction
- `src/app/api/baa-document/[token]/route.ts` — Unauth GET endpoint for BAA PDF
- `src/lib/events/projections/baa.ts`

## 9. Policies
- `src/app/(dashboard)/programs/policies/page.tsx` — Policy template library
- `src/app/(dashboard)/programs/policies/[id]/page.tsx`
- `src/app/(dashboard)/programs/policies/[id]/PolicyEditor.tsx` — Rich editor
- `src/app/(dashboard)/programs/policies/[id]/AcknowledgeForm.tsx`
- `src/app/(dashboard)/programs/policies/[id]/acknowledgments/page.tsx`
- `src/app/(dashboard)/programs/policies/[id]/history/page.tsx` — Version diffs
- `src/app/(dashboard)/programs/policies/actions.ts` — adoptPolicyAction, retirePolicyAction, acknowledgePolicyAction, updatePolicyAction
- `src/app/(dashboard)/programs/policies/TemplateAdoptButton.tsx`
- `src/app/(dashboard)/programs/policies/AdoptedBadge.tsx`
- `src/lib/events/projections/policyAdopted.ts`
- `src/lib/events/projections/policyAcknowledged.ts`
- `src/lib/events/projections/policyContentUpdated.ts`
- `src/lib/policy/diff.ts` — Version diff utility

## 10. Server actions + API routes
- All `src/app/(dashboard)/programs/*/actions.ts` (incidents, risk, vendors, training, policies, staff)
- `src/app/(dashboard)/modules/[code]/actions.ts` — updateRequirementStatusAction, markNotApplicableAction
- `src/app/accept-baa/[token]/actions.ts` — acceptBaaAction
- `src/app/api/audit/incident-breach-memo/[id]/route.tsx` — Breach memo PDF
- `src/app/api/audit/incident-summary/route.tsx`
- `src/app/api/audit/training-summary/route.tsx`
- `src/app/api/audit/vendor-baa-register/route.tsx`
- `src/app/api/baa-document/[token]/route.ts` — Unauth BAA PDF for token holder
- `src/lib/events/append.ts` / `replay.ts`

## 11. Tests
- `tests/integration/incident-lifecycle.test.ts`
- `tests/integration/incident-breach-memo-pdf.test.ts`
- `tests/integration/incident-notifications.test.ts`
- `tests/integration/critical-breach-alert.test.ts`
- `tests/integration/baa-send-action.test.ts`
- `tests/integration/baa-accept-flow.test.ts`
- `tests/integration/baa-projection.test.ts`
- `tests/integration/vendor-baa.test.ts`
- `tests/integration/sra-completion.test.ts`
- `tests/integration/sra-draft.test.ts`
- `tests/integration/training-completion.test.ts`
- `tests/integration/policy-adoption.test.ts`
- `tests/integration/audit-prep.test.ts`
- `tests/integration/state-overlays.test.ts`
- `src/components/gw/MajorBreachBanner/MajorBreachBanner.test.tsx`
- `src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx`
- `src/lib/audit/format-event.test.ts`
- `src/lib/severity.test.ts`

## 12. Help articles + AI copy
- `src/lib/ai/prompts/requirement-help.ts` — Requirement explanation
- `src/lib/ai/prompts/assistant-page-help.ts` — Module overview help
- `src/lib/ai/prompts/concierge-chat.ts` — Concierge AI (HIPAA-aware via tools)
- `src/lib/ai/conciergeTools.ts` — Compliance summary + evidence search tools
- `src/lib/ai/registry.ts`
- `tests/fixtures/prompts/hipaa.assess.v1/solo-pcp-az.json`
- `tests/fixtures/prompts/concierge.chat/hipaa-score-question.json`

## 13. State overlays + projections
- `src/lib/compliance/jurisdictions.ts` — State → HIPAA state-specific requirement codes
- `src/lib/compliance/derivation/hipaa.ts` — 50-state + DC breach notification deadlines (CA 15 biz-days; TX/CT/LA/SD 60d; FL/WA/CO/ME 30d; OR/OH/MD/TN/WI/AZ/NM/RI 45d; remainder "expedient time")
- `src/lib/events/projections/requirementStatus.ts`
- `src/lib/events/projections/frameworkScore.ts`
- `src/lib/track/applicability.ts`
- `tests/integration/state-overlays.test.ts`

## Pre-audit gaps flagged
- State overlay tests are blanket `state-overlays.test.ts` — not per-state
- `Vendor.processesPhi` Boolean toggle has no audit-trail history (snapshot only)
- Policy prerequisite enforcement only tested as part of adoption flow, not standalone
- No live HIPAA-requirements export endpoint (PDFs only)

This inventory feeds the code-reviewer pass and Chrome verify checklist.
