# Allergy Framework Surface Inventory

**Date:** 2026-04-29
**Source:** Glob + grep verification, working dir D:/GuardWell/guardwell-v2/
**Purpose:** 4th & final area audit input (HIPAA, OSHA, Credentials, Allergy)

## Totals

- 17 files directly touching Allergy
- 2,228 LOC UI + actions + projections (wc -l verified)
- Add 394 LOC derivations + 699 LOC tests + 248 LOC seed = 3,569 LOC total
- **Smaller than Credentials** (4 model-driven + 5 policy-driven rules)

## 1. Module page & UI components

8 files, 2,228 LOC total:

| File | LOC | Description |
|------|-----|-------------|
| src/app/(dashboard)/programs/allergy/page.tsx | 117 | Server entry; fetches competency + equipment checks + drills; gated to ALLERGY framework enabled |
| src/app/(dashboard)/programs/allergy/AllergyDashboard.tsx | 45 | Client shell with 3 tabs |
| src/app/(dashboard)/programs/allergy/CompetencyTab.tsx | 522 | **Largest.** Per-staff matrix: quiz passed, fingertip passes (count/required), media fill passed, isFullyQualified badge. Actions: Take Quiz, Attest Fingertip, Attest Media Fill. Supervisor-only (requireAdmin). |
| src/app/(dashboard)/programs/allergy/EquipmentTab.tsx | 408 | Equipment check logger form (EMERGENCY_KIT / REFRIGERATOR_TEMP / SKIN_TEST_SUPPLIES) |
| src/app/(dashboard)/programs/allergy/DrillTab.tsx | 407 | Anaphylaxis drill logger form |
| src/app/(dashboard)/programs/allergy/QuizRunner.tsx | 345 | Embedded quiz client component |
| src/app/(dashboard)/programs/allergy/quiz/page.tsx | 105 | Standalone quiz route for full-screen re-take |
| src/app/(dashboard)/programs/allergy/actions.ts | 279 | **6 server actions** (all requireAdmin): submitQuizAttemptAction, attestFingertipTestAction, attestMediaFillTestAction, logEquipmentCheckAction, logDrillAction, toggleStaffAllergyRequirementAction |

**Note:** /modules/allergy uses src/components/gw/Extras/AllergyExtras.tsx (BUD reference + vial label generator). Framework activation gate: PracticeFramework.enabled=true AND framework.code='ALLERGY'.

## 2. Prisma schema models

7 models + 2 field additions verified from prisma/schema.prisma lines 1575–1725:

- **AllergyCompetency:** Per-staff, per-year. practiceUserId_year unique. Fields: quizPassedAt, fingertipPassCount (0–3 initial, 0–1 renewal), mediaFillPassedAt, isFullyQualified (computed), lastCompoundedAt (inactivity gate: if set + >6 months old, isFullyQualified flips false).
- **AllergyQuizQuestion:** Static catalog, 44 questions across 8 categories (ASEPTIC_TECHNIQUE, CALCULATIONS, LABELING, BEYOND_USE_DATES, DOCUMENTATION, EMERGENCY_RESPONSE, STORAGE_STABILITY, REGULATIONS). Seeded from _v1-allergy-quiz-export.json.
- **AllergyQuizAttempt:** One quiz attempt. Tracks: practiceId, practiceUserId, year, score (0–100), passed (score >= 80).
- **AllergyQuizAnswer:** Per-question answer record. Unique on (attemptId, questionId).
- **AllergyEquipmentCheck:** Equipment check log. Discriminator: checkType (EMERGENCY_KIT / REFRIGERATOR_TEMP / SKIN_TEST_SUPPLIES). Conditional fields per type.
- **AllergyDrill:** Anaphylaxis drill log. Fields: conductedAt, scenario, participantIds[], durationMinutes, observations, correctiveActions, nextDrillDue. Append-only.
- **PracticeComplianceProfile:** Field addition: compoundsAllergens (Boolean, gate for ALLERGY framework).
- **PracticeUser:** Field addition: requiresAllergyCompetency (Boolean, per-user gate for annual 3-component competency).

## 3. Derivation rules + framework registration

**4 model-driven rules** (src/lib/compliance/derivation/allergy.ts lines 15–96):

| Rule | Window | Compliant If |
|------|--------|------|
| ALLERGY_COMPETENCY | Annual (calendar year) | All users with requiresAllergyCompetency=true have isFullyQualified=true for current year |
| ALLERGY_EMERGENCY_KIT_CURRENT | 90 days | Latest AllergyEquipmentCheck (type EMERGENCY_KIT) within 90d + allItemsPresent=true + epi unexpired |
| ALLERGY_REFRIGERATOR_LOG | 30 days | Latest AllergyEquipmentCheck (type REFRIGERATOR_TEMP) within 30d + inRange=true (2.0–8.0°C) |
| ALLERGY_ANNUAL_DRILL | 365 days | Latest AllergyDrill within 365d exists |

**5 policy-driven rules** (pre-wired, attestation-based):
- ALLERGY_DESIGNATED_COMPOUNDING_AREA <- POLICY:ALLERGY_COMPOUNDING_AREA_SOP
- ALLERGY_HAND_HYGIENE_GARBING <- POLICY:ALLERGY_HAND_HYGIENE_GARBING_SOP
- ALLERGY_BUD_LABELING_PROCEDURE <- POLICY:ALLERGY_BUD_LABELING_SOP
- ALLERGY_VIAL_LABELING_PROCEDURE <- POLICY:ALLERGY_VIAL_LABELING_SOP
- ALLERGY_RECORDS_RETENTION_3YR <- POLICY:ALLERGY_RECORDS_RETENTION_SOP

**Competency recompute logic:** recomputeIsFullyQualified() called after every quiz/fingertip/media fill projection. **Initial year:** 3 fingertip + quiz + media fill. **Renewal year** (prior isFullyQualified=true): 1 fingertip + quiz + media fill. **Inactivity:** lastCompoundedAt set + >6 months old -> force full re-qual.

**Registration:** backfillFrameworkDerivations(db, 'ALLERGY') in seed-allergy.ts for idempotent backfill of existing competency/equipment/drill rows.

## 4. Policy templates + seed data

- **scripts/seed-allergy.ts** (248 LOC) — Idempotent seeder for the ALLERGY framework. Creates 1 RegulatoryFramework + 9 RegulatoryRequirements + 44 AllergyQuizQuestion rows. Calls backfillFrameworkDerivations(db, 'ALLERGY').
- **scripts/_v1-allergy-quiz-export.json** — v1 quiz export, 44 questions across 8 categories. Read-only seed input.
- **scripts/_v2-allergy-courses.json** — Linked training courses (future; not yet wired to auto-gate quiz).

## 5. Training + onboarding

**No drip emails specific to Allergy** (unlike HIPAA/OSHA). The ALLERGY_COMPETENCY evidence is produced by the quiz + supervisor attestations on /programs/allergy/, not auto-wired from training completion.

**Quiz eligibility gate:** CompetencyTab conditionally shows 'Take Quiz' button; no prerequisite training enforced. Per memory, a future task will auto-gate: completed training course -> unlock quiz for that year. Currently manual.

**Staff onboarding flag:** src/app/(dashboard)/programs/staff/page.tsx has a 'Requires §21 competency' toggle column (visible when ALLERGY framework enabled). Toggling true sets PracticeUser.requiresAllergyCompetency.

## 6-8. (skipped — incidents, SRA, vendors)

## 9. (covered by section 4)

## 10. Server actions + API routes

**src/app/(dashboard)/programs/allergy/actions.ts** (279 LOC, 6 actions, all require OWNER/ADMIN role):

- **submitQuizAttemptAction:** Finalizes a quiz attempt. Validation: score 0–100, passed = score >= 80. Emits ALLERGY_QUIZ_COMPLETED. Rederive ALLERGY_COMPETENCY.
- **attestFingertipTestAction:** Supervisor attests a gloved-fingertip + thumb sampling pass. Emits ALLERGY_FINGERTIP_TEST_PASSED. Increment fingertipPassCount. Recompute isFullyQualified. Rederive ALLERGY_COMPETENCY.
- **attestMediaFillTestAction:** Supervisor attests media fill pass (14-day incubation, no turbidity). Emits ALLERGY_MEDIA_FILL_PASSED. Set mediaFillPassedAt (idempotent). Rederive ALLERGY_COMPETENCY.
- **logEquipmentCheckAction:** Log equipment check (EMERGENCY_KIT / REFRIGERATOR_TEMP / SKIN_TEST_SUPPLIES). Emits ALLERGY_EQUIPMENT_CHECK_LOGGED. Conditional rederive (KIT -> ALLERGY_EMERGENCY_KIT_CURRENT; FRIDGE -> ALLERGY_REFRIGERATOR_LOG).
- **logDrillAction:** Log anaphylaxis drill. Emits ALLERGY_DRILL_LOGGED. Rederive ALLERGY_ANNUAL_DRILL.
- **toggleStaffAllergyRequirementAction:** Direct DB mutation (non-event action). Toggle PracticeUser.requiresAllergyCompetency flag. Used by staff list page.

**All actions:**
- Gate via requireAdmin() (OWNER/ADMIN only). Returns { user, pu } for tenant scoping.
- Validate tenant via getPracticeUser().
- Wrap event emission in appendEventAndApply() (existing pattern from Credentials/HIPAA).
- Revalidate /programs/allergy + /modules/allergy paths post-action.
- Date inputs use dateOnlyString Zod regex (YYYY-MM-DD) and are converted to ISO datetime before event emission.

## 11. Tests

**4 integration test files (699 LOC total):**

| File | LOC | Coverage |
|------|-----|----------|
| allergy-competency.test.ts | 374 | Competency lifecycle: quiz completion, fingertip attestation, media fill attestation, inactivity rule (6+ months), isFullyQualified state transitions. |
| allergy-equipment.test.ts | 97 | Equipment check projection + rederive (EMERGENCY_KIT, REFRIGERATOR_TEMP); window compliance (90d, 30d). |
| allergy-drill.test.ts | 53 | Drill projection + rederive ALLERGY_ANNUAL_DRILL; 365-day window. |
| allergy-derivation.test.ts | 175 | End-to-end derivation rules: seed framework + 9 requirements; create competency/equipment/drill rows; rederive; assert ComplianceItem status. |

**Test result (2026-04-29):** 4 files, ~18 tests, all passing.

**Test gaps:**
- No test of toggleStaffAllergyRequirementAction (non-event action).
- No test of quiz pass/fail boundary (score = 79 vs 80).
- No test of initial-vs-renewal fingertip count difference (3 vs 1).
- No test of inactivity rule with actual 6-month date arithmetic.
- No test of role-gate (can a non-OWNER/non-ADMIN call an action?).

## 12. Help articles + AI copy

**No dedicated /help/allergy article yet** (unlike /help/credentials on roadmap).

**UI copy embedded:**
- src/components/gw/Extras/AllergyExtras.tsx (Section G extras — inline on /modules/allergy):
  - BudQuickReference — Beyond-Use Date rules per storage type (aqueous 7d room / 14d fridge, non-aqueous 14d room / 30d fridge, frozen 45d at -20°C). Cites USP §797 §21.4.
  - VialLabelGenerator — Interactive BUD calculator + label template. Hard-coded BUD rules; no regulatory citation visible in component.

**No Concierge tool for Allergy** (unlike Credentials' list_credentials). Allergy is practice-dashboard-only.

## 13. State overlays + projections

**Projection files (291 LOC total):**

| File | LOC | Role |
|------|-----|------|
| src/lib/events/projections/allergyCompetency.ts | 190 | 3 projections: projectAllergyQuizCompleted, projectAllergyFingertipTestPassed, projectAllergyMediaFillPassed. All call recomputeIsFullyQualified() + rederiveRequirementStatus. **Inactivity logic:** 6-month window check on recompute. |
| src/lib/events/projections/allergyEquipment.ts | 59 | projectAllergyEquipmentCheckLogged: upsert AllergyEquipmentCheck row. Conditional rederive: EMERGENCY_KIT -> ALLERGY_EMERGENCY_KIT_CURRENT; REFRIGERATOR_TEMP -> ALLERGY_REFRIGERATOR_LOG; SKIN_TEST_SUPPLIES -> no rederive. |
| src/lib/events/projections/allergyDrill.ts | 42 | projectAllergyDrillLogged: upsert AllergyDrill row + rederiveRequirementStatus(..., 'ALLERGY_ANNUAL_DRILL'). |

**No state overlays** — Allergy is practice-wide, not state-specific. All 9 requirements apply uniformly; no jurisdiction filtering.

## Notification surface

**2 notification generators** (in src/lib/notifications/generators.ts):

| Generator | Event Types Proposed | Trigger |
|---|---|---|
| generateAllergyNotifications() | ALLERGY_DRILL_DUE (WARNING), ALLERGY_FRIDGE_OVERDUE (CRITICAL), ALLERGY_KIT_EXPIRING (WARNING) | Drill: if latest >365d old or no drill, WARNING. Fridge: if no check in last 30d, CRITICAL. Kit: if no check in last 90d or epi expired, WARNING. |
| generateAllergyCompetencyDueNotifications() | ALLERGY_COMPETENCY_DUE (WARNING) | Per-user with requiresAllergyCompetency=true: if isFullyQualified=false for current year, WARNING. |

**NotificationType enum values** (from schema.prisma lines 380-383):
- ALLERGY_DRILL_DUE
- ALLERGY_FRIDGE_OVERDUE
- ALLERGY_KIT_EXPIRING
- ALLERGY_COMPETENCY_DUE

Generators are registered in the daily digest cron (/api/notifications/digest/run); no dedicated allergy cron.

## Event types (5 total, registered in src/lib/events/registry.ts lines 68-72, schemas 922-1004)

| Event Type | Payload (v1 schema) | Emitted By | Projection Target |
|---|---|---|---|
| ALLERGY_QUIZ_COMPLETED | attemptId, practiceUserId, year, score, passed, correctAnswers, totalQuestions, answers[] | submitQuizAttemptAction | AllergyQuizAttempt + AllergyCompetency (if passed) |
| ALLERGY_FINGERTIP_TEST_PASSED | practiceUserId, year, attestedByUserId, notes | attestFingertipTestAction | AllergyCompetency (increment fingertipPassCount) |
| ALLERGY_MEDIA_FILL_PASSED | practiceUserId, year, attestedByUserId, notes | attestMediaFillTestAction | AllergyCompetency (set mediaFillPassedAt) |
| ALLERGY_EQUIPMENT_CHECK_LOGGED | equipmentCheckId, checkType, checkedByUserId, checkedAt, [conditional fields] | logEquipmentCheckAction | AllergyEquipmentCheck + conditional rederive (KIT/FRIDGE) |
| ALLERGY_DRILL_LOGGED | drillId, conductedByUserId, conductedAt, scenario, participantIds[], [optional fields] | logDrillAction | AllergyDrill + rederive ALLERGY_ANNUAL_DRILL |

All events use v1 versioning (future-safe for schema evolution). Zod schemas validate boundary conditions (score 0-100, dates as ISO datetime, temperature in -20 to 40°C range).

## Cross-framework dependencies summary

**None identified.** Allergy is self-contained:
- Does NOT query Credential rows (unlike DEA/CLIA/CMS rules which check CredentialType).
- Does NOT gate on HIPAA/OSHA/other compliance status.
- Is NOT a prerequisite for any other framework.
- IS a prerequisite for nothing; practices can enable Allergy independently.

If a practice disables ALLERGY framework, existing AllergyCompetency/AllergyEquipmentCheck/AllergyDrill rows remain in the DB but ComplianceItems flip to NOT_APPLICABLE (per rederive logic). No cascade delete.

## Open questions for the auditor (Chrome verify priorities)

1. **HIGH PRIORITY: Role gate on toggleStaffAllergyRequirementAction** — Does it call requireAdmin()? If not, exploitable (staff member can toggle own/peer requirement status).
2. **Framework activation:** Can a non-OWNER/non-ADMIN user toggle compoundsAllergens on the compliance profile? (Expected: OWNER/ADMIN only, gated at action level).
3. **Staff requirement flag:** Does the staff page's toggle respect role gates? Can a junior staff member toggle their own requirement status?
4. **Quiz pass threshold:** Is 80% hardcoded? No config for per-practice threshold? (Expected: hardcoded per v1 port)
5. **Inactivity rule:** How is lastCompoundedAt set? No visible action in the UI to log a compounding session. Is this a future backfill from patient records?
6. **Fingertip pass count persistence:** Does count reset on Jan 1 of next year, or accumulate year-over-year? (Expected: per-year reset via unique constraint)
7. **Dual role staff:** If a compounder switches requiresAllergyCompetency=true to false, does the prior year's AllergyCompetency row remain?
8. **Equipment check discriminator:** If logged with wrong optional fields, does projection ignore or reject?
9. **Drill date arithmetic:** Is it exactly 365 days or does it account for leap years? (Expected: 365 days)
10. **Equipment window constants:** Are 90d/30d hardcoded in allergy.ts or configurable elsewhere?
11. **Tenant isolation:** Can a user from one practice see/modify another practice's allergy competency/equipment/drills?
12. **Quiz attempt idempotency:** If same user submits same attemptId twice, does projection upsert (update) or error?
13. **Module extras:** Are BUD reference + vial label generator required by policy-driven requirements, or nice-to-have?
14. **Aria attributes:** Does CompetencyTab have proper role='table' / aria-label? Do date pickers have labels?
15. **Cross-site state:** If a practice has multiple physical locations (sites), are competency requirements per-site or per-practice?

## Patterns expected to re-find from HIPAA + OSHA

Per the audit playbook, these cross-area patterns from HIPAA + OSHA findings should be confirmed or ruled out on Allergy:

- **C-1 cross-tenant guard gap on projections** — verify projections validate practiceId.
- **C-2 OWNER/ADMIN role gate gap on actions** — verify all event-emitting actions gate on requireAdmin(). Flag toggleStaffAllergyRequirementAction if NOT gated.
- **I-1 dates rendered in UTC** — equipment/drill log dates use ISO datetime; verify display matches entry across timezone boundary.
- **I-7/I-8 hardcoded citations** — Allergy code is rich in regulatory citations; verify citations not baked in where configurable per jurisdiction.
- **I-8/I-9 missing aria on radio groups** — CompetencyTab uses buttons + badges (no radios visible). EquipmentTab/DrillTab use date pickers + selects + textareas. Verify labels on date pickers.

---

**Legend:**
- LOC = Lines of Code (verified via wc -l)
- Derived = evidence code derives from model queries (not policy attestation)
- Projection = event handler that writes to DB tables
- Rederive = triggered re-evaluation of ComplianceItem status
- Gate = role/permission check
