# OSHA Surface Inventory — GuardWell v2

**Date:** 2026-04-29
**Scope:** File-level OSHA & incident-related surface (read-only audit)
**Total OSHA-touching files:** 53 source files | ~13,130 LOC
**Integration tests:** 11 OSHA-specific

## 1. Module Page & UI Components
- `src/components/gw/Extras/OshaExtras.tsx` — Form 300A worksheet calculator, posting checklist, BBP ECP template
- `src/app/(dashboard)/programs/incidents/new/IncidentReportForm.tsx` — Multi-type incident form with OSHA fields (bodyPart, outcome, daysAway/Restricted, sharpsDeviceType)
- `src/app/(dashboard)/programs/incidents/page.tsx` — Filterable list view
- `src/app/(dashboard)/programs/incidents/[id]/page.tsx` — Detail + breach wizard + notifications
- `src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx` — 4-factor (HIPAA-focused, incident-agnostic rendering)
- `src/app/(dashboard)/programs/incidents/[id]/NotificationLog.tsx`
- `src/app/(dashboard)/programs/incidents/[id]/ResolveButton.tsx`
- `src/app/(dashboard)/programs/incidents/IncidentBadges.tsx`
- `src/app/(dashboard)/audit/reports/page.tsx`

## 2. Prisma Schema Models (OSHA-Relevant)
**Incident** (primary OSHA container):
- `type: IncidentType` (enum incl. `OSHA_RECORDABLE`)
- `oshaBodyPart: String?`, `oshaInjuryNature: String?`
- `oshaOutcome: String?` (DEATH | DAYS_AWAY | RESTRICTED | OTHER_RECORDABLE | FIRST_AID)
- `oshaDaysAway: Int?`, `oshaDaysRestricted: Int?` (§1904.7(b))
- `sharpsDeviceType: String?` for §1910.1030(g)(7) sharps log
- Shared: title, description, severity, status, discoveredAt, reportedAt, resolvedAt, practiceId

**PracticePolicy** (OSHA codes): OSHA_BBP_EXPOSURE_CONTROL_PLAN, OSHA_HAZCOM_PROGRAM, OSHA_EMERGENCY_ACTION_PLAN

**TrainingCourse**: code unique (e.g., BLOODBORNE_PATHOGEN_TRAINING), type "OSHA"

**EventLog**: includes `POSTER_ATTESTATION`, `PPE_ASSESSMENT_COMPLETED`

## 3. Derivation Rules + Framework Registration
**File:** `src/lib/compliance/derivation/osha.ts` — 8/8 wired:
1. `OSHA_BBP_EXPOSURE_CONTROL` — BBP policy adoption
2. `OSHA_BBP_TRAINING` — ≥95% completion of BLOODBORNE_PATHOGEN_TRAINING within 365d
3. `OSHA_HAZCOM` — HazCom policy adoption
4. `OSHA_EMERGENCY_ACTION_PLAN` — EAP policy adoption
5. `OSHA_300_LOG` — ≥1 OSHA_RECORDABLE incident in last 365d
6. `OSHA_REQUIRED_POSTERS` — ≥1 POSTER_ATTESTATION in current calendar year
7. `OSHA_PPE` — ≥1 PPE_ASSESSMENT_COMPLETED in last 365d
8. `OSHA_GENERAL_DUTY` — composite: 3 core policies + ≥1 SRA

## 4. Policy Templates + Seed Data
- `scripts/seed-policy-templates.ts` — 3 OSHA policies (BBP ECP, HazCom, EAP)
- `scripts/_v1-osha-training-export.json` — BLOODBORNE_PATHOGEN_TRAINING (30 min, 8q, 80%, clinical roles)

## 5. Training + Onboarding
- BLOODBORNE_PATHOGEN_TRAINING seeded
- HAZCOM_TRAINING + PPE_ASSESSMENT_TRAINING referenced in rules but **not yet seeded** (gap)
- TrainingCompletion model + `courseCompletionThresholdRule(courseCode, threshold)` helper

## 6. Incidents — OSHA-Specific
- `OSHA_RECORDABLE` incident type
- IncidentReportForm.tsx renders OSHA-only fields conditionally
- Events project via `src/lib/events/projections/incident.ts`
- Recordability filtering (FIRST_AID exclusion) implied but not explicit

## 7. Policies — OSHA-Specific Adoption
- adoptPolicyAction creates PracticePolicy + emits POLICY_ADOPTED
- Annual review via lastReviewedAt (POLICY_REVIEWED event TBD)
- OSHA policies do not yet require staff sign-off (HIPAA does)

## 8. Server Actions + API Routes
- `programs/incidents/actions.ts` — reportIncidentAction
- `programs/policies/actions.ts` — adoptPolicyAction, reviewPolicyAction
- `audit/prep/actions.ts` — generateAuditPrepSessionAction
- `/api/audit/osha-300/route.tsx` — Form 300 PDF (calendar-year filter)
- `/api/audit/osha-301/[id]/route.tsx` — Form 301 PDF
- `/api/audit/incident-breach-memo/[id]/route.tsx`
- `/api/audit/incident-summary/route.tsx`

## 9. Tests (11 OSHA-specific)
- `osha-derivation.test.ts` — Rule evaluation
- `osha-300-log.test.ts` — 300 Log compliance window
- `osha-300-pdf.test.ts` — Form 300 rendering
- `osha-301-pdf.test.ts` — Form 301 rendering
- `osha-policy-adoption.test.ts` — Adoption flow
- `incident-lifecycle.test.ts` — Cross-framework
- `incident-breach-memo-pdf.test.ts`
- `notification-completeness-a/b.test.ts`
- `credential-projection.test.ts`
- `practice-profile.test.ts`

## 10. Help Articles + AI Copy
- `lib/ai/conciergeTools.ts` — incident-reporting, policy-adoption helpers
- `lib/notifications/generators.ts` — audit reminders incl. Form 300A
- `lib/audit-prep/evidence-loaders.ts` — OSHA recordable + policy evidence
- `lib/audit-prep/protocols.ts` — OSHA inspection protocols (5-year retention)

## 11. State Overlays + Projections
- `lib/compliance/jurisdictions.ts` — getPracticeJurisdictions, jurisdictionRequirementFilter
- Federal OSHA only at present (no state-plan overlays seeded)
- `lib/events/projections/incident.ts` — INCIDENT_REPORTED + notification events
- `lib/events/projections/oshaAttestation.ts` — POSTER_ATTESTATION calendar-year scoping

## Summary
- 53 files, ~13,130 LOC
- 8/8 derivation rules wired
- 3 OSHA policies seeded
- 1 training course seeded (BBP) — HazCom + PPE training NOT seeded
- 11 OSHA-specific integration tests

## Pre-audit gaps flagged
1. **Sharps-injury log filtering** — column exists, no UI toggle for §1910.1030(g)(7) separate log
2. **Osha300AReminder banner not yet implemented** — Feb 1–Apr 30 window logic in templates only (Phase 2 PR B1 pending)
3. **State-plan overlays not seeded** — federal only
4. **HazCom + PPE training courses not seeded** — rules reference them but courses missing
5. **Post-exposure prophylaxis tracking** — BBP exposure incidents lack medical eval/PEP attestation fields (template mentions 2-hour HIV PEP window; no form capture)
6. **Exposure incident vs. recordable** — sharps auto-recordable; no pre-recordability assessment workflow

This inventory feeds the code-reviewer pass and Chrome verify checklist.
