# Phase 1 — Cross-framework derivation completeness Implementation Plan

> For agentic workers: REQUIRED PRE-FLIGHT — before touching any file run:
> `npx tsc --noEmit && npm run lint && npm run test:run -- --reporter=verbose 2>&1 | tail -5`
> All three must be green before the first commit. If they are not, stop and fix Phase 0 issues first.

**Goal:** Wire derivation rules for every regulatory framework so evidence-driven compliance is real across the platform, not just HIPAA. A practice doing its operational work in `/programs/*` must automatically see `/modules/*` scores move without manually flipping any radio.

**Architecture:** Per-framework derivation rules live in `src/lib/compliance/derivation/<framework>.ts`. Each file exports a `<FRAMEWORK>_DERIVATION_RULES` record keyed by `RegulatoryRequirement.code`. Rules are spread into the global `DERIVATION_RULES` map in `src/lib/compliance/derivation/index.ts`. After any evidence event is appended via `appendEventAndApply`, its projection calls `rederiveRequirementStatus(tx, practiceId, evidenceCode)` which looks up `acceptedEvidenceTypes` on each requirement, runs the matching rule, and writes the result to `ComplianceItem` plus triggers `recomputeFrameworkScore`. New event types follow the 3-step pattern in `registry.ts` (literal in `EVENT_TYPES` → Zod schema in `EVENT_SCHEMAS` → optional projection handler). At the end of each framework seed the `backfillFrameworkDerivations(db, frameworkCode)` call retro-derives state for all existing practices.

**Tech stack:** Prisma · TypeScript · Zod · Vitest · `appendEventAndApply` · `rederiveRequirementStatus` · `recomputeFrameworkScore` · `courseCompletionThresholdRule` · `credentialTypePresentRule` · `backfillFrameworkDerivations`

---

## Open questions + already-shipped items (resolve before execution)

### Already shipped (confirmed by investigation)

1. **Allergy derivation — fully shipped.** `src/lib/compliance/derivation/allergy.ts` exists with 4 rules (`ALLERGY_COMPETENCY`, `ALLERGY_EMERGENCY_KIT_CURRENT`, `ALLERGY_REFRIGERATOR_LOG`, `ALLERGY_ANNUAL_DRILL`). All 5 allergy events are in `registry.ts` (`ALLERGY_QUIZ_COMPLETED`, `ALLERGY_FINGERTIP_TEST_PASSED`, `ALLERGY_MEDIA_FILL_PASSED`, `ALLERGY_EQUIPMENT_CHECK_LOGGED`, `ALLERGY_DRILL_LOGGED`). The allergy module plan (PR #136 / `2026-04-27-allergy-module.md`) already landed. Phase 1 for Allergy = seed `acceptedEvidenceTypes` where empty + verify backfill runs. No new derivation rules to write.

2. **DEA_REGISTRATION already wired.** `dea.ts` has the `credentialTypePresentRule("DEA_CONTROLLED_SUBSTANCE_REGISTRATION")` rule. `seed-dea.ts` already has `acceptedEvidenceTypes: ["CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION"]` for `DEA_REGISTRATION`. DEA_REGISTRATION is the only wired DEA rule; 7 more needed.

3. **CMS three credential rules already wired.** `cms.ts` has `CMS_PECOS_ENROLLMENT`, `CMS_NPI_REGISTRATION`, `CMS_MEDICARE_PROVIDER_ENROLLMENT` via `credentialTypePresentRule`. Seeds already have the matching `acceptedEvidenceTypes`. 4 more CMS rules needed.

4. **CLIA_CERTIFICATE already wired.** `clia.ts` has `credentialTypePresentRule("CLIA_WAIVER_CERTIFICATE")`. Seed has `acceptedEvidenceTypes: ["CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE"]`. Per locked decisions, CLIA operational depth is HOLD.

5. **OIG_COMPLIANCE_OFFICER already wired.** `oig.ts` has the rule; seed already has `acceptedEvidenceTypes: ["OFFICER_DESIGNATION:COMPLIANCE"]`. 6 more OIG rules needed.

6. **OSHA four rules already wired.** `osha.ts` has `OSHA_BBP_EXPOSURE_CONTROL`, `OSHA_BBP_TRAINING`, `OSHA_HAZCOM`, `OSHA_EMERGENCY_ACTION_PLAN`, `OSHA_300_LOG`. Seeds match. **OSHA_300_LOG is already wired** (rule exists in `osha.ts`, seed has `acceptedEvidenceTypes: ["INCIDENT:OSHA_RECORDABLE"]`). Revised gap: only 3 missing OSHA rules (`OSHA_REQUIRED_POSTERS`, `OSHA_PPE`, `OSHA_GENERAL_DUTY`).

7. **DEA event types already exist.** `DEA_INVENTORY_RECORDED`, `DEA_ORDER_RECEIVED`, `DEA_DISPOSAL_COMPLETED`, `DEA_THEFT_LOSS_REPORTED` all registered in `registry.ts` with full Zod schemas. Projection handlers exist in `src/lib/events/projections/dea.ts`. No new DEA event types needed except `EPCS_ATTESTATION` for `DEA_PRESCRIPTION_SECURITY`.

8. **OSHA seed has backfill.** `seed-osha.ts` line 232: `await backfillFrameworkDerivations(db, "OSHA")`. All other seeds (DEA, CMS, CLIA, OIG, MACRA, TCPA) also already have the backfill call. The allergy seed is the exception — it does NOT call `backfillFrameworkDerivations`. That call must be added in this phase.

9. **`evidenceCodeForPolicy` helper exists** in `src/lib/compliance/policies.ts`. Policy evidence codes follow the pattern `POLICY:<policyCode>`. Policies for new frameworks (DEA, CMS, OIG, TCPA) must be added to `policies.ts` for the policy derivation pipeline to work.

10. **`MACRA` seed has 7 requirements, not 4.** The master roadmap said "4 requirements" but investigation found 7: `MACRA_MIPS_EXEMPTION_VERIFIED`, `MACRA_QUALITY_MEASURES`, `MACRA_IMPROVEMENT_ACTIVITIES`, `MACRA_PROMOTING_INTEROPERABILITY`, `MACRA_SECURITY_RISK_ANALYSIS`, `MACRA_CERTIFIED_EHR_TECHNOLOGY`, `MACRA_ANNUAL_DATA_SUBMISSION`. The plan scopes rules to match the actual 7 seeded codes.

11. **`TCPA` seed has 7 requirements, not 5.** The master roadmap said "5 requirements" but investigation found 7: `TCPA_WRITTEN_CONSENT_POLICY`, `TCPA_MARKETING_CONSENT`, `TCPA_INFORMATIONAL_CONSENT`, `TCPA_OPT_OUT_MECHANISM`, `TCPA_DNC_COMPLIANCE`, `TCPA_CONSENT_RECORDS`, `TCPA_CALLING_HOURS`. All are currently manual-only.

### Open questions for implementer

**OQ-1 — `OIG_RESPONSE_VIOLATIONS` model choice.** Do we add a minimal `OigCorrectiveAction` model (new Prisma model + schema migration) or derive from a simpler new event type `OIG_CORRECTIVE_ACTION_RESOLVED`? Investigation reveals no existing `OigCorrectiveAction` model in scope. To avoid a schema migration, Phase 1 **uses a new event type** `OIG_CORRECTIVE_ACTION_RESOLVED` with payload `{ actionId: string, resolvedAt: string, description: string }` and a simple `EventLog.count` check. A full `OigCorrectiveAction` model with an audit trail UI is deferred to Phase 9. Document this as a known simplification.

**OQ-2 — MACRA SRA cross-framework derivation.** `MACRA_SECURITY_RISK_ANALYSIS` "cross-checks with HIPAA_SRA; completing the HIPAA SRA also satisfies this." The simplest Phase 1 implementation is: add `SRA_COMPLETED:ANY` as an accepted evidence type and let the same `SRA_COMPLETED` event rederive both. Confirmed: `projectSraCompleted` already calls `rederiveRequirementStatus(tx, practiceId, "SRA_COMPLETED:ANY")` — verify by reading that file before PR 6.

**OQ-3 — `policies.ts` union type expansion.** The `PolicyCode` union type in `policies.ts` only covers `HipaaPolicyCode | OshaPolicyCode`. Adding new policies for DEA, CMS, OIG, and TCPA requires expanding the union AND the `POLICY_METADATA` map. The `evidenceCodeForPolicy` helper is typed `(code: PolicyCode) => ...` — extending it is safe but requires the implementer to update the union type. Do not cast; fix the union.

**OQ-4 — CLIA_STAFF_TRAINING + CLIA_LAB_DIRECTOR.** Investigation: `CLIA_STAFF_TRAINING` has `acceptedEvidenceTypes: []`. Lab director could map to an `OFFICER_DESIGNATION:LAB_DIRECTOR` evidence code, but no such officer role exists (only `PRIVACY | SECURITY | COMPLIANCE | SAFETY`). Phase 1 adds `LAB_DIRECTOR` to `OFFICER_ROLES` in `registry.ts` only if it can be done without a Prisma schema migration. Check `schema.prisma` `OfficerRole` enum before implementing — if it's a Prisma enum, a migration is required and this stays manual-only.

---

## Scope confirmed against current code state

| Framework | Total Reqs | Already-wired rules | New rules this phase | Deferred-stubbed | Status |
|-----------|-----------|--------------------|-----------------------|-----------------|--------|
| HIPAA | 50+ | All wired | 0 | 0 | Complete |
| OSHA | 8 | 5 (`BBP_EXPOSURE_CONTROL`, `BBP_TRAINING`, `HAZCOM`, `EAP`, `300_LOG`) | 3 (`REQUIRED_POSTERS`, `PPE`, `GENERAL_DUTY`) | 0 | Partial |
| OIG | 7 | 1 (`COMPLIANCE_OFFICER`) | 5 (`WRITTEN_POLICIES`, `TRAINING_EDUCATION`, `COMMUNICATION_LINES`, `AUDITING_MONITORING`, `RESPONSE_VIOLATIONS`) | 1 (`ENFORCEMENT_DISCIPLINE` — Phase 11 stub for LeieScreening part) | Partial |
| DEA | 8 | 1 (`REGISTRATION`) | 5 (`INVENTORY`, `RECORDS`, `STORAGE`, `PRESCRIPTION_SECURITY`, `LOSS_REPORTING`, `DISPOSAL`) | 1 (`EMPLOYEE_SCREENING` — Phase 11 stub) | Partial |
| CMS | 7 | 3 (`PECOS_ENROLLMENT`, `NPI_REGISTRATION`, `MEDICARE_PROVIDER_ENROLLMENT`) | 3 (`EMERGENCY_PREPAREDNESS`, `STARK_AKS_COMPLIANCE`, `OVERPAYMENT_REFUND`) | 1 (`BILLING_COMPLIANCE` — policy-driven; adds OIG cross-ref) | Partial |
| CLIA | 8 | 1 (`CERTIFICATE`) | 1 (`STAFF_TRAINING` — via existing course + threshold) | 6 (all LabTest/QC/director operational rules — per locked decision) | Manual-mostly |
| MACRA | 7 | 0 | 5 (`MIPS_EXEMPTION_VERIFIED`, `IMPROVEMENT_ACTIVITIES`, `PROMOTING_INTEROPERABILITY`, `SECURITY_RISK_ANALYSIS`, `ANNUAL_DATA_SUBMISSION`) | 2 (`QUALITY_MEASURES`, `CERTIFIED_EHR_TECHNOLOGY` — no data model yet) | Partial |
| TCPA | 7 | 0 | 3 (`WRITTEN_CONSENT_POLICY`, `OPT_OUT_MECHANISM`, `DNC_COMPLIANCE`) | 4 (`MARKETING_CONSENT`, `INFORMATIONAL_CONSENT`, `CONSENT_RECORDS`, `CALLING_HOURS` — need PatientConsentRecord model, Phase 9) | Partial |
| Allergy | 9 | 4 (`COMPETENCY`, `EMERGENCY_KIT_CURRENT`, `REFRIGERATOR_LOG`, `ANNUAL_DRILL`) | 0 (rules already shipped) | 0 | seed-only work |

**Seed-level gaps (already have rules, missing `acceptedEvidenceTypes`):**
- ALLERGY: `ALLERGY_COMPETENCY`, `ALLERGY_EMERGENCY_KIT_CURRENT`, `ALLERGY_REFRIGERATOR_LOG`, `ALLERGY_ANNUAL_DRILL` all have `acceptedEvidenceTypes: []` in `seed-allergy.ts`. These must be filled in.

---

## CLIA manual-only documentation

Per locked decision (`v2-decisions-locked.md`): CLIA operational suite is HOLD.

| CLIA Requirement | Derivation status at launch | Evidence code | Rationale |
|-----------------|---------------------------|---------------|-----------|
| `CLIA_CERTIFICATE` | DERIVED — `credentialTypePresentRule("CLIA_WAIVER_CERTIFICATE")` | `CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE` | Already shipped |
| `CLIA_STAFF_TRAINING` | DERIVED (if course `CLIA_LAB_BASICS` seeded) | `TRAINING:CLIA_LAB_BASICS` | Wired in PR 7 if course exists; else stays manual |
| `CLIA_LAB_DIRECTOR` | MANUAL-ONLY | — | Would need `LAB_DIRECTOR` officer role; pending OQ-4 |
| `CLIA_PATIENT_RESULTS` | MANUAL-ONLY | — | No PatientResult model; deferred Phase 9 |
| `CLIA_INSPECTION_READINESS` | MANUAL-ONLY | — | No AuditPrepChecklist for CLIA yet; deferred |
| `CLIA_TEST_LIST` | MANUAL-ONLY | — | No TestMenu model; deferred Phase 9 |
| `CLIA_MFR_INSTRUCTIONS` | MANUAL-ONLY | — | No deviation log model; deferred Phase 9 |
| `CLIA_QUALITY_CONTROL` | MANUAL-ONLY | — | No QcLog model (v1 CLIA operational); deferred Phase 9 |

---

## LeieScreening stub policy

Two requirements reference LEIE screening, which ships in Phase 11 (Sanctions):
- `DEA_EMPLOYEE_SCREENING` (in `dea.ts`)
- `OIG_ENFORCEMENT_DISCIPLINE` (in `oig.ts`)

Both files will have this header doc-block:
```
// PHASE 11 DEPENDENCY: DEA_EMPLOYEE_SCREENING and OIG_ENFORCEMENT_DISCIPLINE
// reference LeieScreening results which are not yet modeled. Rules for those
// two requirements are stubbed — they reference a TODO(Phase 11) evidence code
// and the derivation rule returns null (no-op) until Phase 11 wires the model.
// See docs/plans/<date>-phase-11-sanctions.md for the full specification.
```

Each stubbed rule:
```typescript
// TODO(Phase 11): Wire to LeieScreening.completedWithin90Days once
// the LeieScreening model lands. Returns null until then so the
// requirement stays at its user-set status.
export async function deaEmployeeScreeningRule(): Promise<DerivedStatus | null> {
  return null;
}
```

---

## New event types required by this phase

| Event type | Required for | New projection? | PR |
|-----------|-------------|-----------------|-----|
| `POSTER_ATTESTATION` | `OSHA_REQUIRED_POSTERS` | No (event-existence check only — incident projection pattern) | PR 2 |
| `PPE_ASSESSMENT_COMPLETED` | `OSHA_PPE` | No (event-existence check only) | PR 2 |
| `EPCS_ATTESTATION` | `DEA_PRESCRIPTION_SECURITY` | No (event-existence check only) | PR 3 |
| `OIG_ANNUAL_REVIEW_SUBMITTED` | `OIG_AUDITING_MONITORING` | No (event-existence check only) | PR 5 |
| `OIG_CORRECTIVE_ACTION_RESOLVED` | `OIG_RESPONSE_VIOLATIONS` | No (event-existence count query) | PR 5 |
| `MACRA_ACTIVITY_LOGGED` | `MACRA_IMPROVEMENT_ACTIVITIES`, `MACRA_PROMOTING_INTEROPERABILITY`, `MACRA_MIPS_EXEMPTION_VERIFIED`, `MACRA_ANNUAL_DATA_SUBMISSION` | Yes — simple upsert to a `MacraActivityLog` record | PR 6 |
| `OVERPAYMENT_REPORTED` | `CMS_OVERPAYMENT_REFUND` | Yes — writes to `OverpaymentRecord` | PR 4 |

**New Prisma models required (triggers a migration per `docs/deploy/auto-migrations.md`):**
- `MacraActivityLog`: id, practiceId, activityCode, activityType (QUALITY \| IMPROVEMENT \| PI \| SUBMISSION), attestationPeriod (year int), attestedAt, attestedByUserId
- `OverpaymentRecord`: id, practiceId, identifiedAt, amount, status (IDENTIFIED \| REPORTED \| REFUNDED), reportedAt, notes

If either model is judged too heavyweight for Phase 1, stub the rules to derive from `EventLog.count` (no model, just event existence). The plan defaults to the EventLog approach for Phase 1 simplicity — see task specifics per PR.

---

## File structure

### Files to CREATE

```
src/lib/events/projections/macraActivity.ts       — PR 6
src/lib/events/projections/overpayment.ts         — PR 4
```

### Files to MODIFY

```
src/lib/events/registry.ts                        — PRs 2, 3, 4, 5, 6 (new event types)
src/lib/compliance/policies.ts                    — PRs 3, 4, 5, 6, 7 (new policy codes)
src/lib/compliance/derivation/osha.ts             — PR 2 (3 new rules)
src/lib/compliance/derivation/dea.ts              — PR 3 (6 new rules; 1 stub)
src/lib/compliance/derivation/cms.ts              — PR 4 (3 new rules; 1 stub)
src/lib/compliance/derivation/oig.ts              — PR 5 (5 new rules; 1 stub)
src/lib/compliance/derivation/clia.ts             — PR 7 (1 new rule or confirmed manual)
src/lib/compliance/derivation/index.ts            — PRs 6, 7 (add MACRA_DERIVATION_RULES, TCPA_DERIVATION_RULES)
scripts/seed-osha.ts                              — PR 2 (acceptedEvidenceTypes for POSTER, PPE, GENERAL_DUTY)
scripts/seed-dea.ts                               — PR 3 (acceptedEvidenceTypes for 7 remaining reqs)
scripts/seed-cms.ts                               — PR 4 (acceptedEvidenceTypes for 4 remaining reqs)
scripts/seed-oig.ts                               — PR 5 (acceptedEvidenceTypes for 6 remaining reqs)
scripts/seed-allergy.ts                           — PR 7 (acceptedEvidenceTypes for 4 derived reqs + backfill call)
scripts/seed-clia.ts                              — PR 7 (acceptedEvidenceTypes for STAFF_TRAINING if applicable)
```

### Files to CREATE (derivation — new frameworks)

```
src/lib/compliance/derivation/macra.ts            — PR 6
src/lib/compliance/derivation/tcpa.ts             — PR 6
```

### Test files to CREATE

```
tests/integration/osha-poster-ppe.test.ts         — PR 2
tests/integration/dea-derivation.test.ts          — PR 3
tests/integration/cms-derivation.test.ts          — PR 4
tests/integration/oig-derivation.test.ts          — PR 5
tests/integration/macra-derivation.test.ts        — PR 6
tests/integration/tcpa-derivation.test.ts         — PR 6
tests/integration/allergy-seed-backfill.test.ts   — PR 7
```

---

## PR boundaries

### PR 1 — Shared helpers (minimal; skip if not needed)

**Condition:** Only create this PR if investigation for PR 2 reveals a composite-rule helper that two or more frameworks will reuse. Candidates:
- `eventExistsWithinWindowRule(eventType, windowMs)` — returns a `DerivationRule` that checks whether at least one `EventLog` row of the given type exists for the practice within the window. Used by `OSHA_REQUIRED_POSTERS`, `OSHA_PPE`, `OIG_AUDITING_MONITORING`, `DEA_PRESCRIPTION_SECURITY`.
- `singlePolicyRule(policyCode)` — already exists implicitly in `hipaa.ts` as a local `function singlePolicyRule`. Promote to `shared.ts` so DEA and OIG can reuse it.

**If both helpers exist or are trivial to inline, skip PR 1 entirely** and implement inline in each framework file. The plan assumes PR 1 is skipped and inline implementations are used; adjust if duplication is too heavy.

---

### PR 2 — OSHA: 3 missing rules + 2 new event types

**Scope:** `OSHA_REQUIRED_POSTERS`, `OSHA_PPE`, `OSHA_GENERAL_DUTY`

**New event types:**
- `POSTER_ATTESTATION` — payload: `{ attestationId: string, attestedByUserId: string, attestedAt: string (ISO), posters: string[] }`
- `PPE_ASSESSMENT_COMPLETED` — payload: `{ assessmentId: string, conductedByUserId: string, conductedAt: string (ISO), hazardsIdentified: string[], ppeRequired: string[], notes: string | null }`

Neither event needs a new projection handler — rules query `EventLog` directly rather than writing to a dedicated model.

**Rule logic:**

`OSHA_REQUIRED_POSTERS`:
```
COMPLIANT if EventLog.count({ practiceId, type: "POSTER_ATTESTATION",
  createdAt: { gte: Jan 1 of current calendar year } }) >= 1
GAP otherwise
```

`OSHA_PPE`:
```
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
COMPLIANT if EventLog.count({ practiceId, type: "PPE_ASSESSMENT_COMPLETED",
  createdAt: { gte: cutoff } }) >= 1
GAP otherwise
```

`OSHA_GENERAL_DUTY` (composite — checks all four underlying policies + no SRA_RISK_FLAGGED gap):
```
1. count(practicePolicy where policyCode IN [BBP, HAZCOM, EAP] AND retiredAt null) == 3 → policies_ok
2. If not policies_ok → GAP
3. count(sraAssessment where practiceId AND completedAt IS NOT NULL) > 0 → has_sra
4. If not has_sra → GAP (no risk assessment = general duty obligation unverified)
5. Else → COMPLIANT
```
Rationale: The General Duty Clause is satisfied by showing the core hazard controls are in place (BBP + HazCom + EAP) AND a risk assessment has been completed (proving recognized hazards were identified and addressed). The SRA check reuses `SraAssessment.completedAt` — no new query shape.

**Projection wiring:** The two new event types need `rederiveRequirementStatus` calls. Since neither creates a dedicated model, add the rederive calls inline to `src/lib/events/append.ts` event handler switch, or — matching the existing pattern more closely — add a minimal no-model projection in `src/lib/events/projections/oshaAttestation.ts`:

```typescript
// src/lib/events/projections/oshaAttestation.ts
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

export async function projectPosterAttestation(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "EVENT:POSTER_ATTESTATION");
}

export async function projectPpeAssessmentCompleted(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "EVENT:PPE_ASSESSMENT_COMPLETED");
}
```

The corresponding requirements get `acceptedEvidenceTypes: ["EVENT:POSTER_ATTESTATION"]` and `acceptedEvidenceTypes: ["EVENT:PPE_ASSESSMENT_COMPLETED"]` respectively. `OSHA_GENERAL_DUTY` gets `acceptedEvidenceTypes: ["POLICY:OSHA_BBP_EXPOSURE_CONTROL_PLAN", "POLICY:OSHA_HAZCOM_PROGRAM", "POLICY:OSHA_EMERGENCY_ACTION_PLAN"]` — the composite rule fires from any of those three evidence codes (same rederive path used by each individual policy adoption).

**`acceptedEvidenceTypes` for all 8 OSHA requirements after this PR:**
```
OSHA_BBP_EXPOSURE_CONTROL:    ["POLICY:OSHA_BBP_EXPOSURE_CONTROL_PLAN"]      (unchanged)
OSHA_BBP_TRAINING:            ["TRAINING:BLOODBORNE_PATHOGEN_TRAINING"]       (unchanged)
OSHA_HAZCOM:                  ["POLICY:OSHA_HAZCOM_PROGRAM"]                  (unchanged)
OSHA_EMERGENCY_ACTION_PLAN:   ["POLICY:OSHA_EMERGENCY_ACTION_PLAN"]           (unchanged)
OSHA_300_LOG:                 ["INCIDENT:OSHA_RECORDABLE"]                    (unchanged)
OSHA_REQUIRED_POSTERS:        ["EVENT:POSTER_ATTESTATION"]                    (NEW)
OSHA_PPE:                     ["EVENT:PPE_ASSESSMENT_COMPLETED"]              (NEW)
OSHA_GENERAL_DUTY:            ["POLICY:OSHA_BBP_EXPOSURE_CONTROL_PLAN",
                                "POLICY:OSHA_HAZCOM_PROGRAM",
                                "POLICY:OSHA_EMERGENCY_ACTION_PLAN"]          (NEW)
```

**Seed update:** `seed-osha.ts` — update the three requirements with new `acceptedEvidenceTypes` arrays as above. `backfillFrameworkDerivations(db, "OSHA")` already present at end of `main()`.

---

### PR 3 — DEA: 6 new rules + 1 Phase 11 stub + EPCS_ATTESTATION event

**Scope:** Wire `DEA_INVENTORY`, `DEA_RECORDS`, `DEA_STORAGE`, `DEA_PRESCRIPTION_SECURITY`, `DEA_LOSS_REPORTING`, `DEA_DISPOSAL`. Stub `DEA_EMPLOYEE_SCREENING`.

**New event type:**
- `EPCS_ATTESTATION` — payload: `{ attestationId: string, attestedByUserId: string, attestedAt: string (ISO), epcsVendor: string | null, twoFactorEnabled: boolean, auditTrailConfirmed: boolean }`

**New policy codes** (add to `policies.ts` before implementing rules):
```typescript
// In OSHA section or a new DEA section:
"DEA_SECURE_STORAGE_POLICY",
"DEA_PRESCRIPTION_SECURITY_POLICY",
"DEA_LOSS_REPORTING_POLICY",
```
Add `PolicyFramework` and `PolicyMetadata` entries. Expand `PolicyCode` union.

**Rule logic per requirement:**

`DEA_INVENTORY` (code: `DEA_INVENTORY` in seed):
```
const cutoff = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000); // 24 months
COMPLIANT if DeaInventory.count({ practiceId, asOfDate: { gte: cutoff } }) >= 1
GAP otherwise
```
Evidence code: `DEA_INVENTORY:RECORDED` (rederive must be called from `projectDeaInventoryRecorded`).

`DEA_RECORDS` (code: `DEA_RECORDS`):
```
Audit-trail composite:
1. Any DeaInventory exists in last 24 months → records_ok = true
2. Any DeaOrderRecord exists in last 24 months → records_ok &= true (OR = no orders → vacuously ok)
3. Any DeaDisposalRecord exists in last 24 months → records_ok &= true (OR = no disposals → vacuously ok)
4. Return COMPLIANT if records_ok else GAP
```
Simplification: for a practice that legitimately has no controlled substance activity, all three record tables are empty → vacuously COMPLIANT. This matches the "zero recordable incidents" precedent from OSHA_300_LOG.

Evidence code: `DEA_RECORDS:ACTIVITY` (rederive called from all three DEA projection handlers — inventory, order, disposal — in addition to their existing calls).

`DEA_STORAGE` (code: `DEA_STORAGE`):
```
COMPLIANT if PracticePolicy where policyCode = "DEA_SECURE_STORAGE_POLICY" AND retiredAt null
GAP otherwise
```
Evidence code: `POLICY:DEA_SECURE_STORAGE_POLICY`

`DEA_PRESCRIPTION_SECURITY` (code: `DEA_PRESCRIPTION_SECURITY`):
```
1. Policy adopted: PracticePolicy where policyCode = "DEA_PRESCRIPTION_SECURITY_POLICY" AND retiredAt null → policy_ok
2. EPCS attestation in last 12 months: EventLog.count({ practiceId, type: "EPCS_ATTESTATION", createdAt: { gte: cutoff_12_months } }) >= 1 → epcs_ok
3. COMPLIANT if policy_ok AND epcs_ok; GAP if policy_ok AND NOT epcs_ok; GAP if NOT policy_ok
```
Evidence codes: `POLICY:DEA_PRESCRIPTION_SECURITY_POLICY`, `EVENT:EPCS_ATTESTATION`

`DEA_LOSS_REPORTING` (code: `DEA_LOSS_REPORTING`):
```
1. Loss-reporting policy adopted: PracticePolicy where policyCode = "DEA_LOSS_REPORTING_POLICY" AND retiredAt null → policy_ok
2. Any theft/loss events: count = DeaTheftLossReport.count({ practiceId })
3. If count > 0: all must have form106SubmittedAt IS NOT NULL → reports_ok
4. COMPLIANT if policy_ok AND (count == 0 OR reports_ok); GAP otherwise
```
Evidence codes: `POLICY:DEA_LOSS_REPORTING_POLICY`, `DEA_THEFT_LOSS:REPORTED`

`DEA_DISPOSAL` (code: `DEA_DISPOSAL`):
```
COMPLIANT if DeaDisposalRecord.count({ practiceId }) > 0 (any disposal documented)
   OR no controlled substances have ever been ordered (DeaOrderRecord.count == 0 AND
      DeaInventory.count == 0)
GAP otherwise
```
Rationale: a practice that has ordered or inventoried controlled substances must demonstrate a disposal pathway. One that has never touched controlled substances is vacuously compliant (they also should have DEA_REGISTRATION at NOT_APPLICABLE via module override).
Evidence code: `DEA_DISPOSAL:COMPLETED`

`DEA_EMPLOYEE_SCREENING` — STUB:
```typescript
// TODO(Phase 11): Wire to LeieScreening once the model lands.
async function deaEmployeeScreeningStub(): Promise<DerivedStatus | null> {
  return null;
}
```
Evidence code: none set in seed (`acceptedEvidenceTypes: []` stays).

**Projection wiring additions** (add `rederiveRequirementStatus` calls to existing `dea.ts` projection functions):
- `projectDeaInventoryRecorded`: add `rederiveRequirementStatus(tx, practiceId, "DEA_INVENTORY:RECORDED")` and `rederiveRequirementStatus(tx, practiceId, "DEA_RECORDS:ACTIVITY")`
- `projectDeaOrderReceived`: add `rederiveRequirementStatus(tx, practiceId, "DEA_RECORDS:ACTIVITY")`
- `projectDeaDisposalCompleted`: add `rederiveRequirementStatus(tx, practiceId, "DEA_DISPOSAL:COMPLETED")` and `rederiveRequirementStatus(tx, practiceId, "DEA_RECORDS:ACTIVITY")`
- `projectDeaTheftLossReported`: add `rederiveRequirementStatus(tx, practiceId, "DEA_THEFT_LOSS:REPORTED")`

New no-model projection for EPCS_ATTESTATION (inline in a new `src/lib/events/projections/epcsAttestation.ts` or added to `dea.ts` projection file):
```typescript
export async function projectEpcsAttestation(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "EVENT:EPCS_ATTESTATION");
}
```

**`acceptedEvidenceTypes` after this PR:**
```
DEA_REGISTRATION:         ["CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION"]  (unchanged)
DEA_INVENTORY:            ["DEA_INVENTORY:RECORDED"]                                  (NEW)
DEA_RECORDS:              ["DEA_RECORDS:ACTIVITY"]                                    (NEW)
DEA_STORAGE:              ["POLICY:DEA_SECURE_STORAGE_POLICY"]                        (NEW)
DEA_PRESCRIPTION_SECURITY:["POLICY:DEA_PRESCRIPTION_SECURITY_POLICY",
                            "EVENT:EPCS_ATTESTATION"]                                 (NEW)
DEA_EMPLOYEE_SCREENING:   []                                                          (stub — Phase 11)
DEA_LOSS_REPORTING:       ["POLICY:DEA_LOSS_REPORTING_POLICY",
                            "DEA_THEFT_LOSS:REPORTED"]                                (NEW)
DEA_DISPOSAL:             ["DEA_DISPOSAL:COMPLETED"]                                  (NEW)
```

---

### PR 4 — CMS: 3 new rules + 1 deferred policy stub + OVERPAYMENT_REPORTED event

**Scope:** Wire `CMS_EMERGENCY_PREPAREDNESS`, `CMS_STARK_AKS_COMPLIANCE`, `CMS_OVERPAYMENT_REFUND`. Stub `CMS_BILLING_COMPLIANCE`.

**New event type:**
- `OVERPAYMENT_REPORTED` — payload: `{ reportId: string, reportedByUserId: string, reportedAt: string (ISO), identifiedAt: string (ISO), estimatedAmount: number | null, payorType: "MEDICARE" | "MEDICAID" | "OTHER", refundMethod: string | null, notes: string | null }`

**New policy codes** (add to `policies.ts`):
```typescript
"CMS_EMERGENCY_PREPAREDNESS_POLICY",
"CMS_STARK_AKS_COMPLIANCE_POLICY",
"CMS_BILLING_COMPLIANCE_POLICY",
```

**Rule logic:**

`CMS_EMERGENCY_PREPAREDNESS` (code: `CMS_EMERGENCY_PREPAREDNESS`):
```
COMPLIANT if PracticePolicy where policyCode = "CMS_EMERGENCY_PREPAREDNESS_POLICY" AND retiredAt null
GAP otherwise
```
Evidence code: `POLICY:CMS_EMERGENCY_PREPAREDNESS_POLICY`

`CMS_STARK_AKS_COMPLIANCE` (code: `CMS_STARK_AKS_COMPLIANCE`):
```
COMPLIANT if PracticePolicy where policyCode = "CMS_STARK_AKS_COMPLIANCE_POLICY" AND retiredAt null
GAP otherwise
```
Evidence code: `POLICY:CMS_STARK_AKS_COMPLIANCE_POLICY`

`CMS_OVERPAYMENT_REFUND` (code: `CMS_OVERPAYMENT_REFUND`):
```
const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
1. Any OVERPAYMENT_REPORTED events where identifiedAt > cutoff60: recent_count
2. If recent_count == 0: COMPLIANT (no overpayments to report)
3. If recent_count > 0:
   - All events within last 60 days must have reportedAt within 60 days of identifiedAt
   - COMPLIANT if all in-window; GAP if any are overdue
```
Implementation note: query `EventLog` directly (no new model). Parse payload from JSON.
Evidence code: `OVERPAYMENT:REPORTED`

`CMS_BILLING_COMPLIANCE` (stub — derive from policy adoption for now):
```
COMPLIANT if PracticePolicy where policyCode = "CMS_BILLING_COMPLIANCE_POLICY" AND retiredAt null
GAP otherwise
```
Evidence code: `POLICY:CMS_BILLING_COMPLIANCE_POLICY`

**Projection wiring:** New `src/lib/events/projections/overpayment.ts`:
```typescript
export async function projectOverpaymentReported(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "OVERPAYMENT:REPORTED");
}
```

**`acceptedEvidenceTypes` after this PR:**
```
CMS_PECOS_ENROLLMENT:             ["CREDENTIAL_TYPE:MEDICARE_PECOS_ENROLLMENT"]         (unchanged)
CMS_NPI_REGISTRATION:             ["CREDENTIAL_TYPE:NPI_REGISTRATION"]                   (unchanged)
CMS_MEDICARE_PROVIDER_ENROLLMENT: ["CREDENTIAL_TYPE:MEDICARE_PROVIDER_ENROLLMENT"]       (unchanged)
CMS_EMERGENCY_PREPAREDNESS:       ["POLICY:CMS_EMERGENCY_PREPAREDNESS_POLICY"]           (NEW)
CMS_STARK_AKS_COMPLIANCE:         ["POLICY:CMS_STARK_AKS_COMPLIANCE_POLICY"]             (NEW)
CMS_BILLING_COMPLIANCE:           ["POLICY:CMS_BILLING_COMPLIANCE_POLICY"]               (NEW)
CMS_OVERPAYMENT_REFUND:           ["OVERPAYMENT:REPORTED"]                               (NEW)
```

---

### PR 5 — OIG: Extend from 1 to 7 rules + 2 new event types

**Scope:** Wire `OIG_WRITTEN_POLICIES`, `OIG_TRAINING_EDUCATION`, `OIG_COMMUNICATION_LINES`, `OIG_AUDITING_MONITORING`, `OIG_RESPONSE_VIOLATIONS`. Partial-stub `OIG_ENFORCEMENT_DISCIPLINE`.

**New event types:**
- `OIG_ANNUAL_REVIEW_SUBMITTED` — payload: `{ reviewId: string, submittedByUserId: string, submittedAt: string (ISO), reviewType: "CODING_AUDIT" | "BILLING_REVIEW" | "DOCUMENTATION_AUDIT" | "COMPREHENSIVE", notes: string | null }`
- `OIG_CORRECTIVE_ACTION_RESOLVED` — payload: `{ actionId: string, resolvedByUserId: string, resolvedAt: string (ISO), description: string, disclosureEntityCode: string | null, notes: string | null }`

**New policy codes** (add to `policies.ts`):
```typescript
"OIG_STANDARDS_OF_CONDUCT_POLICY",
"OIG_ANONYMOUS_REPORTING_POLICY",
"OIG_DISCIPLINE_POLICY",
```

**OIG-tagged policies for `OIG_WRITTEN_POLICIES`.** This requirement derives from adoption of at least 2 of the 3 OIG policy codes above:
```typescript
const OIG_POLICY_SET = [
  "OIG_STANDARDS_OF_CONDUCT_POLICY",
  "OIG_ANONYMOUS_REPORTING_POLICY",
  "OIG_DISCIPLINE_POLICY",
] as const;
```
Rule: COMPLIANT if PracticePolicy count where policyCode IN OIG_POLICY_SET AND retiredAt null >= 2.

**`OIG_TRAINING_EDUCATION`:** Requires a course `OIG_COMPLIANCE_TRAINING`. Check if this course exists in `seed-training.ts`. If it does, use `courseCompletionThresholdRule("OIG_COMPLIANCE_TRAINING", 0.95)`. If it does not exist (likely), the rule still uses `courseCompletionThresholdRule` but returns null until the course is seeded (the helper already handles `if (!course) return null`). The implementer should add a `TODO(Phase 4)` comment noting the course must be seeded before this rule fires.

**Rule logic:**

`OIG_WRITTEN_POLICIES` (code: `OIG_WRITTEN_POLICIES`):
```
COMPLIANT if count(practicePolicy where policyCode IN OIG_POLICY_SET AND retiredAt null) >= 2
GAP otherwise
```
Evidence codes: `POLICY:OIG_STANDARDS_OF_CONDUCT_POLICY`, `POLICY:OIG_ANONYMOUS_REPORTING_POLICY`, `POLICY:OIG_DISCIPLINE_POLICY` (rule fires on any of the three)

`OIG_TRAINING_EDUCATION` (code: `OIG_TRAINING_EDUCATION`):
```
courseCompletionThresholdRule("OIG_COMPLIANCE_TRAINING", 0.95)
// Returns null if course not seeded → requirement stays at user-set status
```
Evidence code: `TRAINING:OIG_COMPLIANCE_TRAINING`

`OIG_COMMUNICATION_LINES` (code: `OIG_COMMUNICATION_LINES`):
```
COMPLIANT if PracticePolicy where policyCode = "OIG_ANONYMOUS_REPORTING_POLICY" AND retiredAt null
GAP otherwise
```
Evidence code: `POLICY:OIG_ANONYMOUS_REPORTING_POLICY`

`OIG_AUDITING_MONITORING` (code: `OIG_AUDITING_MONITORING`):
```
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
COMPLIANT if EventLog.count({ practiceId, type: "OIG_ANNUAL_REVIEW_SUBMITTED",
  createdAt: { gte: cutoff } }) >= 1
GAP otherwise
```
Evidence code: `EVENT:OIG_ANNUAL_REVIEW_SUBMITTED`

`OIG_ENFORCEMENT_DISCIPLINE` (Phase 11 partial stub):
```
Phase 1: derive from discipline policy alone (partial credit).
Full rule pending Phase 11 (LeieScreening cadence check).
COMPLIANT if PracticePolicy where policyCode = "OIG_DISCIPLINE_POLICY" AND retiredAt null
GAP otherwise
// TODO(Phase 11): Extend to also verify LeieScreening cadence is maintained.
```
Evidence code: `POLICY:OIG_DISCIPLINE_POLICY`

`OIG_RESPONSE_VIOLATIONS` (code: `OIG_RESPONSE_VIOLATIONS`):
```
COMPLIANT if EventLog.count({ practiceId, type: "OIG_CORRECTIVE_ACTION_RESOLVED" }) >= 1
   (any resolved corrective action = active response program in place)
GAP otherwise
```
Evidence code: `EVENT:OIG_CORRECTIVE_ACTION_RESOLVED`

**Projection wiring** (both new event types need rederive calls; no dedicated model):
```typescript
// No-model projection handlers — add to a new file:
// src/lib/events/projections/oigReview.ts
export async function projectOigAnnualReviewSubmitted(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "EVENT:OIG_ANNUAL_REVIEW_SUBMITTED");
}
export async function projectOigCorrectiveActionResolved(tx, { practiceId }) {
  await rederiveRequirementStatus(tx, practiceId, "EVENT:OIG_CORRECTIVE_ACTION_RESOLVED");
}
```

**`acceptedEvidenceTypes` after this PR:**
```
OIG_WRITTEN_POLICIES:       ["POLICY:OIG_STANDARDS_OF_CONDUCT_POLICY",
                              "POLICY:OIG_ANONYMOUS_REPORTING_POLICY",
                              "POLICY:OIG_DISCIPLINE_POLICY"]              (NEW)
OIG_COMPLIANCE_OFFICER:     ["OFFICER_DESIGNATION:COMPLIANCE"]             (unchanged)
OIG_TRAINING_EDUCATION:     ["TRAINING:OIG_COMPLIANCE_TRAINING"]           (NEW)
OIG_COMMUNICATION_LINES:    ["POLICY:OIG_ANONYMOUS_REPORTING_POLICY"]      (NEW)
OIG_AUDITING_MONITORING:    ["EVENT:OIG_ANNUAL_REVIEW_SUBMITTED"]          (NEW)
OIG_ENFORCEMENT_DISCIPLINE: ["POLICY:OIG_DISCIPLINE_POLICY"]               (NEW; Phase 11 extension noted)
OIG_RESPONSE_VIOLATIONS:    ["EVENT:OIG_CORRECTIVE_ACTION_RESOLVED"]       (NEW)
```

---

### PR 6 — MACRA + TCPA: New derivation files + MACRA_ACTIVITY_LOGGED event

**Scope:** Create `src/lib/compliance/derivation/macra.ts` and `src/lib/compliance/derivation/tcpa.ts`. Wire them into `index.ts`.

#### MACRA

**New event type:**
- `MACRA_ACTIVITY_LOGGED` — payload: `{ activityId: string, loggedByUserId: string, activityCode: string (e.g. "IA_BMH_9"), activityType: "QUALITY" | "IMPROVEMENT" | "PI" | "SUBMISSION", attestationYear: number (int), activityName: string, notes: string | null }`

**New projection file** (`src/lib/events/projections/macraActivity.ts`):
```typescript
export async function projectMacraActivityLogged(tx, { practiceId, payload }) {
  await tx.macraActivityLog.create({
    data: {
      id: payload.activityId,
      practiceId,
      activityCode: payload.activityCode,
      activityType: payload.activityType,
      attestationYear: payload.attestationYear,
      activityName: payload.activityName,
      loggedByUserId: payload.loggedByUserId,
      notes: payload.notes ?? null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "MACRA_ACTIVITY:LOGGED");
}
```

**Prisma model** (`MacraActivityLog` in schema):
```prisma
model MacraActivityLog {
  id              String   @id @default(cuid())
  practiceId      String
  activityCode    String
  activityType    String   // QUALITY | IMPROVEMENT | PI | SUBMISSION
  attestationYear Int
  activityName    String
  loggedByUserId  String
  notes           String?
  createdAt       DateTime @default(now())
  practice        Practice @relation(fields: [practiceId], references: [id])
}
```

This model requires a schema migration. Per `docs/deploy/auto-migrations.md`, add the migration file before merging PR 6.

**Rule logic for MACRA requirements:**

`MACRA_MIPS_EXEMPTION_VERIFIED`:
```
COMPLIANT if MacraActivityLog.count({ practiceId, activityType: "QUALITY",
  attestationYear: currentYear }) >= 1
GAP otherwise
// Note: this is a proxy — the exemption check is attestation-based.
// A practice that logs any quality activity for the year has implicitly
// verified their MIPS status. Full QPP portal integration is deferred.
```

`MACRA_IMPROVEMENT_ACTIVITIES`:
```
const currentYear = new Date().getFullYear();
COMPLIANT if MacraActivityLog.count({ practiceId, activityType: "IMPROVEMENT",
  attestationYear: currentYear }) >= 2
GAP otherwise
// Requires 2+ improvement activities (proxy for 40-point minimum; real
// point calculation requires the full IA catalog, Phase 9 or later)
```

`MACRA_PROMOTING_INTEROPERABILITY`:
```
COMPLIANT if MacraActivityLog.count({ practiceId, activityType: "PI",
  attestationYear: currentYear }) >= 1
GAP otherwise
```

`MACRA_SECURITY_RISK_ANALYSIS`:
```
// Cross-framework: reuse SRA_COMPLETED evidence code.
// The HIPAA SRA also satisfies the PI category SRA requirement.
COMPLIANT if SraAssessment.count({ practiceId, completedAt: { not: null } }) >= 1
GAP otherwise
```
Evidence code: `SRA_COMPLETED:ANY` (same code as HIPAA_SRA uses; add to `acceptedEvidenceTypes` for this requirement).

`MACRA_ANNUAL_DATA_SUBMISSION`:
```
const currentYear = new Date().getFullYear();
COMPLIANT if MacraActivityLog.count({ practiceId, activityType: "SUBMISSION",
  attestationYear: currentYear }) >= 1
GAP otherwise
```

`MACRA_QUALITY_MEASURES` — STUB (manual-only):
```
return null; // TODO: Wire to QPP quality measure data model, Phase 9+
```

`MACRA_CERTIFIED_EHR_TECHNOLOGY` — STUB (manual-only):
```
return null; // TODO: Wire to TechAsset CEHRT certification tracking, Phase 9+
```

**`acceptedEvidenceTypes` for MACRA:**
```
MACRA_MIPS_EXEMPTION_VERIFIED:    ["MACRA_ACTIVITY:LOGGED"]       (NEW)
MACRA_QUALITY_MEASURES:           []                               (stub)
MACRA_IMPROVEMENT_ACTIVITIES:     ["MACRA_ACTIVITY:LOGGED"]       (NEW)
MACRA_PROMOTING_INTEROPERABILITY: ["MACRA_ACTIVITY:LOGGED"]       (NEW)
MACRA_SECURITY_RISK_ANALYSIS:     ["SRA_COMPLETED:ANY"]           (NEW — cross-framework)
MACRA_CERTIFIED_EHR_TECHNOLOGY:   []                               (stub)
MACRA_ANNUAL_DATA_SUBMISSION:     ["MACRA_ACTIVITY:LOGGED"]       (NEW)
```

#### TCPA

No new event types. Three rules derive from policy adoption (already-understood pattern). Four requirements remain manual-only with explicit documented rationale.

**New policy codes** (add to `policies.ts`):
```typescript
"TCPA_CONSENT_POLICY",
"TCPA_OPT_OUT_POLICY",
"TCPA_DNC_COMPLIANCE_POLICY",
```

**Rule logic:**

`TCPA_WRITTEN_CONSENT_POLICY`:
```
COMPLIANT if PracticePolicy where policyCode = "TCPA_CONSENT_POLICY" AND retiredAt null
GAP otherwise
```

`TCPA_OPT_OUT_MECHANISM`:
```
COMPLIANT if PracticePolicy where policyCode = "TCPA_OPT_OUT_POLICY" AND retiredAt null
GAP otherwise
```

`TCPA_DNC_COMPLIANCE`:
```
COMPLIANT if PracticePolicy where policyCode = "TCPA_DNC_COMPLIANCE_POLICY" AND retiredAt null
GAP otherwise
```

`TCPA_MARKETING_CONSENT`, `TCPA_INFORMATIONAL_CONSENT`, `TCPA_CONSENT_RECORDS`, `TCPA_CALLING_HOURS` — MANUAL-ONLY:
```
return null; // TODO(Phase 9): Wire to PatientConsentRecord model
             // + DncEntry + opt-out queue when TCPA operational surface ships.
```

**`acceptedEvidenceTypes` for TCPA:**
```
TCPA_WRITTEN_CONSENT_POLICY:   ["POLICY:TCPA_CONSENT_POLICY"]         (NEW)
TCPA_MARKETING_CONSENT:        []                                       (Phase 9 stub)
TCPA_INFORMATIONAL_CONSENT:    []                                       (Phase 9 stub)
TCPA_OPT_OUT_MECHANISM:        ["POLICY:TCPA_OPT_OUT_POLICY"]          (NEW)
TCPA_DNC_COMPLIANCE:           ["POLICY:TCPA_DNC_COMPLIANCE_POLICY"]   (NEW)
TCPA_CONSENT_RECORDS:          []                                       (Phase 9 stub)
TCPA_CALLING_HOURS:            []                                       (Phase 9 stub)
```

**`index.ts` additions:**
```typescript
import { MACRA_DERIVATION_RULES } from "./macra";
import { TCPA_DERIVATION_RULES } from "./tcpa";

export const DERIVATION_RULES: Record<string, DerivationRule> = {
  ...HIPAA_DERIVATION_RULES,
  ...OSHA_DERIVATION_RULES,
  ...OIG_DERIVATION_RULES,
  ...DEA_DERIVATION_RULES,
  ...CMS_DERIVATION_RULES,
  ...CLIA_DERIVATION_RULES,
  ...MACRA_DERIVATION_RULES,  // NEW
  ...TCPA_DERIVATION_RULES,   // NEW
  ...ALLERGY_DERIVATIONS,
};
```

---

### PR 7 — CLIA + Allergy: seed-level work + backfill

**Scope:** Populate `acceptedEvidenceTypes` for CLIA where derivation exists. Add `backfillFrameworkDerivations` call to allergy seed. Wire `CLIA_STAFF_TRAINING` if the course exists.

**CLIA `acceptedEvidenceTypes` additions:**
Check `seed-training.ts` for course code `CLIA_LAB_BASICS`. If it exists:
```
CLIA_STAFF_TRAINING: ["TRAINING:CLIA_LAB_BASICS"]
```
If it does not exist, leave `acceptedEvidenceTypes: []` and add `TODO(Phase 4): seed CLIA_LAB_BASICS course to enable auto-derivation`.

For `CLIA_LAB_DIRECTOR`: Check `schema.prisma` for the `OfficerRole` enum.
- If `LAB_DIRECTOR` can be added without a migration (string field only), add it to `OFFICER_ROLES` in `registry.ts` and set `acceptedEvidenceTypes: ["OFFICER_DESIGNATION:LAB_DIRECTOR"]`.
- Otherwise leave `acceptedEvidenceTypes: []` and add a comment `TODO: LAB_DIRECTOR officer role requires schema migration`.

**Allergy seed update:**
1. Set `acceptedEvidenceTypes` for derived requirements:
```
ALLERGY_COMPETENCY:            (needs investigation of what evidence code allergyCompetency
                                projection fires; check projectAllergyCompetency for the
                                rederiveRequirementStatus call)
ALLERGY_EMERGENCY_KIT_CURRENT: (check projectAllergyEquipmentCheck)
ALLERGY_REFRIGERATOR_LOG:      (check projectAllergyEquipmentCheck)
ALLERGY_ANNUAL_DRILL:          (check projectAllergyDrill)
```
Read the allergy projection files before writing these codes. The pattern to use: whatever evidence code the projection passes to `rederiveRequirementStatus`.

2. Add `backfillFrameworkDerivations(db, "ALLERGY")` at the end of `main()` in `seed-allergy.ts`. Import from `"./lib/backfill-derivations"`.

3. Add `backfillFrameworkDerivations(db, "MACRA")` to `seed-macra.ts` end of `main()` (it already calls it — verify; if already present, no change needed).

4. Add `backfillFrameworkDerivations(db, "TCPA")` to `seed-tcpa.ts` end of `main()` (same).

---

## Pre-flight checks

Run these before the first commit of each PR:
```bash
# From D:/GuardWell/guardwell-v2
npx tsc --noEmit
npm run lint
npm run test:run -- --reporter=verbose 2>&1 | tail -20
```

Expected baseline: all TypeScript errors zero, all lint clean, integration test suite green.

If `npm run test:run` shows failures, consult the Phase 0 plan (`docs/plans/2026-04-28-phase-0-foundation-fixes.md`) — the cross-file test pollution fix is a pre-requisite for clean combined test runs.

Local Postgres: port 5433 per bash-gotchas.md. If Docker is not running:
```bash
docker-compose up -d postgres
```

---

## Tasks (TDD first)

### Each PR follows this task sequence:

**Task A — Event types** (if any new ones): Add to `EVENT_TYPES` array in `registry.ts`. Add Zod schema to `EVENT_SCHEMAS`. Run `npx tsc --noEmit` to confirm no type errors.

**Task B — Projection** (if needed): Create or modify projection file. Wire into `src/lib/events/append.ts` switch statement. Confirm `appendEventAndApply` dispatches the new event.

**Task C — Failing integration test**: Write the test BEFORE implementing the rule. The test should:
- `seed()` a practice with the framework activated and requirement loaded
- `appendEventAndApply` the evidence event
- Assert `complianceItem.status === "COMPLIANT"`
- The test must FAIL at this point (rule not yet implemented)

Test namespace convention: `firebaseUid: \`<pr-prefix>-${Math.random().toString(36).slice(2, 10)}\``

**Task D — Implement derivation rule(s)**: Write the rule function(s) in `src/lib/compliance/derivation/<framework>.ts`. Add to the `<FRAMEWORK>_DERIVATION_RULES` map export.

**Task E — Wire into `index.ts`**: If a new file, import and spread. If extending existing file, the export is already spread.

**Task F — Seed update**: Update `scripts/seed-<framework>.ts` with the correct `acceptedEvidenceTypes` arrays per the spec in this plan. Confirm `backfillFrameworkDerivations(db, frameworkCode)` call exists at end of `main()`.

**Task G — Run and verify**:
```bash
npx tsc --noEmit
npm run lint
npm run test:run -- tests/integration/<new-test-file>.test.ts
npm run test:run  # full suite must pass
```
Fix any regressions before committing.

**Task H — Commit** on feature branch `phase-1/<framework-code>-derivation`:
```bash
git add src/lib/compliance/derivation/<framework>.ts \
        src/lib/events/registry.ts \
        src/lib/events/projections/<if-new>.ts \
        src/lib/compliance/policies.ts \
        scripts/seed-<framework>.ts \
        tests/integration/<new>.test.ts
git commit -m "feat(phase-1): wire <FRAMEWORK> derivation rules — N of M requirements now evidence-driven"
```

---

### PR 2 specific: OSHA three missing rules

**Task C (failing test)** — `tests/integration/osha-poster-ppe.test.ts`:
```typescript
// tests/integration/osha-poster-ppe.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPosterAttestation, projectPpeAssessmentCompleted }
  from "@/lib/events/projections/oshaAttestation";

async function seedOsha() {
  const user = await db.user.create({
    data: {
      firebaseUid: `osha-poster-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha-poster-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "OSHA Poster Test Clinic", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "OSHA" } });
  const posterReq = await db.regulatoryRequirement.findUniqueOrThrow({
    where: { frameworkId_code: { frameworkId: framework.id, code: "OSHA_REQUIRED_POSTERS" } },
  });
  const ppeReq = await db.regulatoryRequirement.findUniqueOrThrow({
    where: { frameworkId_code: { frameworkId: framework.id, code: "OSHA_PPE" } },
  });
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, posterReq, ppeReq };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("OSHA poster + PPE derivation", () => {
  it("POSTER_ATTESTATION in current year flips OSHA_REQUIRED_POSTERS to COMPLIANT", async () => {
    const { user, practice, posterReq } = await seedOsha();
    expect(await statusOf(practice.id, posterReq.id)).toBe("NOT_STARTED");

    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "POSTER_ATTESTATION",
        payload: { attestationId: randomUUID(), attestedByUserId: user.id,
          attestedAt: new Date().toISOString(), posters: ["OSHA_JOB_SAFETY"] } },
      async (tx) => projectPosterAttestation(tx, { practiceId: practice.id, payload: {
        attestationId: randomUUID(), attestedByUserId: user.id,
        attestedAt: new Date().toISOString(), posters: ["OSHA_JOB_SAFETY"] } }),
    );

    expect(await statusOf(practice.id, posterReq.id)).toBe("COMPLIANT");
  });

  it("PPE_ASSESSMENT_COMPLETED in last 12 months flips OSHA_PPE to COMPLIANT", async () => {
    const { user, practice, ppeReq } = await seedOsha();

    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "PPE_ASSESSMENT_COMPLETED",
        payload: { assessmentId: randomUUID(), conductedByUserId: user.id,
          conductedAt: new Date().toISOString(), hazardsIdentified: ["SHARPS"],
          ppeRequired: ["GLOVES", "EYE_PROTECTION"], notes: null } },
      async (tx) => projectPpeAssessmentCompleted(tx, { practiceId: practice.id, payload: {
        assessmentId: randomUUID(), conductedByUserId: user.id,
        conductedAt: new Date().toISOString(), hazardsIdentified: [],
        ppeRequired: [], notes: null } }),
    );

    expect(await statusOf(practice.id, ppeReq.id)).toBe("COMPLIANT");
  });
});
```

---

### PR 3 specific: DEA derivation

**Task C (failing test)** — `tests/integration/dea-derivation.test.ts`:

Covers 3 rules with real events:
1. `DEA_INVENTORY` — emit `DEA_INVENTORY_RECORDED` → assert `COMPLIANT`
2. `DEA_STORAGE` — adopt `DEA_SECURE_STORAGE_POLICY` → assert `COMPLIANT`
3. `DEA_DISPOSAL` — emit `DEA_DISPOSAL_COMPLETED` → assert `COMPLIANT`

```typescript
// tests/integration/dea-derivation.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectDeaInventoryRecorded } from "@/lib/events/projections/dea";
import { projectDeaDisposalCompleted } from "@/lib/events/projections/dea";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

async function seedDea() {
  const user = await db.user.create({
    data: {
      firebaseUid: `dea-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "DEA Derivation Test Clinic", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "DEA" } });
  const reqs = await db.regulatoryRequirement.findMany({
    where: { frameworkId: framework.id },
  });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("DEA derivation rules", () => {
  it("DEA_INVENTORY_RECORDED within 24 months flips DEA_INVENTORY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_INVENTORY")!;
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");

    const inventoryId = randomUUID();
    const payload = {
      inventoryId,
      asOfDate: new Date().toISOString(),
      conductedByUserId: user.id,
      witnessUserId: null,
      notes: null,
      items: [{ drugName: "Diazepam", schedule: "CIV" as const,
        quantity: 10, unit: "tablet", ndc: null, strength: null }],
    };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id,
        type: "DEA_INVENTORY_RECORDED", payload },
      async (tx) => projectDeaInventoryRecorded(tx, { practiceId: practice.id, payload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting DEA_SECURE_STORAGE_POLICY flips DEA_STORAGE to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_STORAGE")!;

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "POLICY_ADOPTED",
        payload: { practicePolicyId, policyCode: "DEA_SECURE_STORAGE_POLICY", version: 1 } },
      async (tx) => projectPolicyAdopted(tx, {
        practiceId: practice.id,
        payload: { practicePolicyId, policyCode: "DEA_SECURE_STORAGE_POLICY", version: 1 } }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("DEA_DISPOSAL_COMPLETED flips DEA_DISPOSAL to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_DISPOSAL")!;

    const disposalPayload = {
      disposalRecordId: randomUUID(), disposalBatchId: null,
      disposedByUserId: user.id, witnessUserId: null,
      reverseDistributorName: "PharmEco", reverseDistributorDeaNumber: null,
      disposalDate: new Date().toISOString(),
      disposalMethod: "REVERSE_DISTRIBUTOR" as const,
      drugName: "Diazepam", ndc: null, schedule: "CIV" as const,
      strength: null, quantity: 5, unit: "tablet",
      form41Filed: true, notes: null,
    };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id,
        type: "DEA_DISPOSAL_COMPLETED", payload: disposalPayload },
      async (tx) => projectDeaDisposalCompleted(tx, {
        practiceId: practice.id, payload: disposalPayload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
```

---

### PR 4 specific: CMS derivation

**Task C (failing test)** — `tests/integration/cms-derivation.test.ts`:

Covers 2 rules:
1. `CMS_EMERGENCY_PREPAREDNESS` — policy adoption → COMPLIANT
2. `CMS_OVERPAYMENT_REFUND` — no recent overpayments → COMPLIANT (vacuous case)

```typescript
// tests/integration/cms-derivation.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

async function seedCms() {
  const user = await db.user.create({
    data: {
      firebaseUid: `cms-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `cms-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "CMS Derivation Test Clinic", primaryState: "FL" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "CMS" } });
  const reqs = await db.regulatoryRequirement.findMany({ where: { frameworkId: framework.id } });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("CMS derivation rules", () => {
  it("CMS_EMERGENCY_PREPAREDNESS_POLICY adoption flips CMS_EMERGENCY_PREPAREDNESS to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_EMERGENCY_PREPAREDNESS")!;

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "POLICY_ADOPTED",
        payload: { practicePolicyId, policyCode: "CMS_EMERGENCY_PREPAREDNESS_POLICY", version: 1 } },
      async (tx) => projectPolicyAdopted(tx, {
        practiceId: practice.id,
        payload: { practicePolicyId, policyCode: "CMS_EMERGENCY_PREPAREDNESS_POLICY", version: 1 } }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("CMS_OVERPAYMENT_REFUND is COMPLIANT when no recent OVERPAYMENT_REPORTED events exist", async () => {
    const { practice, byCode } = await seedCms();
    const req = byCode.get("CMS_OVERPAYMENT_REFUND")!;
    // No events emitted — rule should return COMPLIANT (no overpayments to report)
    // Rule must be triggered; call rederive directly via a neutral evidence ping.
    // In practice the backfill handles this; here we verify the rule logic.
    await db.$transaction(async (tx) => {
      const { rederiveRequirementStatus } = await import(
        "@/lib/compliance/derivation/rederive"
      );
      await rederiveRequirementStatus(tx, practice.id, "OVERPAYMENT:REPORTED");
    });
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
```

---

### PR 5 specific: OIG derivation

**Task C (failing test)** — `tests/integration/oig-derivation.test.ts`:

Covers 3 rules:
1. `OIG_WRITTEN_POLICIES` — adopt 2 OIG policies → COMPLIANT
2. `OIG_AUDITING_MONITORING` — emit `OIG_ANNUAL_REVIEW_SUBMITTED` → COMPLIANT
3. `OIG_RESPONSE_VIOLATIONS` — emit `OIG_CORRECTIVE_ACTION_RESOLVED` → COMPLIANT

```typescript
// tests/integration/oig-derivation.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";
import { projectOigAnnualReviewSubmitted, projectOigCorrectiveActionResolved }
  from "@/lib/events/projections/oigReview";

async function seedOig() {
  const user = await db.user.create({
    data: {
      firebaseUid: `oig-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `oig-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "OIG Derivation Test Clinic", primaryState: "IL" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "OIG" } });
  const reqs = await db.regulatoryRequirement.findMany({ where: { frameworkId: framework.id } });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("OIG derivation rules", () => {
  it("Adopting 2 OIG policies flips OIG_WRITTEN_POLICIES to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_WRITTEN_POLICIES")!;

    for (const code of ["OIG_STANDARDS_OF_CONDUCT_POLICY", "OIG_ANONYMOUS_REPORTING_POLICY"]) {
      const id = randomUUID();
      await appendEventAndApply(
        { practiceId: practice.id, actorUserId: user.id, type: "POLICY_ADOPTED",
          payload: { practicePolicyId: id, policyCode: code, version: 1 } },
        async (tx) => projectPolicyAdopted(tx, {
          practiceId: practice.id, payload: { practicePolicyId: id, policyCode: code, version: 1 } }),
      );
    }

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("OIG_ANNUAL_REVIEW_SUBMITTED within last 12 months flips OIG_AUDITING_MONITORING to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_AUDITING_MONITORING")!;

    const reviewPayload = { reviewId: randomUUID(), submittedByUserId: user.id,
      submittedAt: new Date().toISOString(), reviewType: "CODING_AUDIT" as const, notes: null };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id,
        type: "OIG_ANNUAL_REVIEW_SUBMITTED", payload: reviewPayload },
      async (tx) => projectOigAnnualReviewSubmitted(tx, {
        practiceId: practice.id, payload: reviewPayload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("OIG_CORRECTIVE_ACTION_RESOLVED flips OIG_RESPONSE_VIOLATIONS to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_RESPONSE_VIOLATIONS")!;

    const actionPayload = { actionId: randomUUID(), resolvedByUserId: user.id,
      resolvedAt: new Date().toISOString(), description: "Overbilling corrected and disclosed",
      disclosureEntityCode: null, notes: null };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id,
        type: "OIG_CORRECTIVE_ACTION_RESOLVED", payload: actionPayload },
      async (tx) => projectOigCorrectiveActionResolved(tx, {
        practiceId: practice.id, payload: actionPayload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
```

---

### PR 6 specific: MACRA + TCPA derivation

**Task C (failing test)** — `tests/integration/macra-derivation.test.ts`:

```typescript
// tests/integration/macra-derivation.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectMacraActivityLogged } from "@/lib/events/projections/macraActivity";

async function seedMacra() {
  const user = await db.user.create({
    data: {
      firebaseUid: `macra-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `macra-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "MACRA Test Clinic", primaryState: "GA" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "MACRA" } });
  const reqs = await db.regulatoryRequirement.findMany({ where: { frameworkId: framework.id } });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("MACRA derivation rules", () => {
  it("MACRA_ACTIVITY_LOGGED (IMPROVEMENT type, 2+) flips MACRA_IMPROVEMENT_ACTIVITIES to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_IMPROVEMENT_ACTIVITIES")!;
    const year = new Date().getFullYear();

    for (let i = 0; i < 2; i++) {
      const payload = { activityId: randomUUID(), loggedByUserId: user.id,
        activityCode: `IA_AHE_${i}`, activityType: "IMPROVEMENT" as const,
        attestationYear: year, activityName: `Improvement Activity ${i}`, notes: null };
      await appendEventAndApply(
        { practiceId: practice.id, actorUserId: user.id,
          type: "MACRA_ACTIVITY_LOGGED", payload },
        async (tx) => projectMacraActivityLogged(tx, { practiceId: practice.id, payload }),
      );
    }

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("MACRA_ACTIVITY_LOGGED (SUBMISSION type) flips MACRA_ANNUAL_DATA_SUBMISSION to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedMacra();
    const req = byCode.get("MACRA_ANNUAL_DATA_SUBMISSION")!;
    const year = new Date().getFullYear();

    const payload = { activityId: randomUUID(), loggedByUserId: user.id,
      activityCode: "QPP_ANNUAL_SUBMISSION", activityType: "SUBMISSION" as const,
      attestationYear: year, activityName: "QPP Portal Annual Submission", notes: null };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id,
        type: "MACRA_ACTIVITY_LOGGED", payload },
      async (tx) => projectMacraActivityLogged(tx, { practiceId: practice.id, payload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
```

**Task C (failing test)** — `tests/integration/tcpa-derivation.test.ts`:

```typescript
// tests/integration/tcpa-derivation.test.ts
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

async function seedTcpa() {
  const user = await db.user.create({
    data: {
      firebaseUid: `tcpa-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `tcpa-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "TCPA Test Clinic", primaryState: "CA" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "TCPA" } });
  const reqs = await db.regulatoryRequirement.findMany({ where: { frameworkId: framework.id } });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId: practice.id, frameworkId: framework.id } },
    update: {},
    create: { practiceId: practice.id, frameworkId: framework.id, enabled: true, scoreCache: 0 },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("TCPA derivation rules", () => {
  it("TCPA_CONSENT_POLICY adoption flips TCPA_WRITTEN_CONSENT_POLICY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_WRITTEN_CONSENT_POLICY")!;

    const id = randomUUID();
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "POLICY_ADOPTED",
        payload: { practicePolicyId: id, policyCode: "TCPA_CONSENT_POLICY", version: 1 } },
      async (tx) => projectPolicyAdopted(tx, { practiceId: practice.id,
        payload: { practicePolicyId: id, policyCode: "TCPA_CONSENT_POLICY", version: 1 } }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("TCPA_OPT_OUT_POLICY adoption flips TCPA_OPT_OUT_MECHANISM to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_OPT_OUT_MECHANISM")!;

    const id = randomUUID();
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: user.id, type: "POLICY_ADOPTED",
        payload: { practicePolicyId: id, policyCode: "TCPA_OPT_OUT_POLICY", version: 1 } },
      async (tx) => projectPolicyAdopted(tx, { practiceId: practice.id,
        payload: { practicePolicyId: id, policyCode: "TCPA_OPT_OUT_POLICY", version: 1 } }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
```

---

### PR 7 specific: CLIA + Allergy reconciliation

**Task F notes:**

The allergy projection files have been read; evidence codes are confirmed. Use exactly:
```
ALLERGY_COMPETENCY:            ["ALLERGY_COMPETENCY"]            ← projectAllergyQuizCompleted + projectAllergyFingertipTestPassed + projectAllergyMediaFillPassed
ALLERGY_EMERGENCY_KIT_CURRENT: ["ALLERGY_EMERGENCY_KIT_CURRENT"] ← projectAllergyEquipmentCheckLogged (checkType=EMERGENCY_KIT)
ALLERGY_REFRIGERATOR_LOG:      ["ALLERGY_REFRIGERATOR_LOG"]      ← projectAllergyEquipmentCheckLogged (checkType=REFRIGERATOR_TEMP)
ALLERGY_ANNUAL_DRILL:          ["ALLERGY_ANNUAL_DRILL"]           ← projectAllergyDrillLogged
```
These are literal strings — not namespaced with a prefix. The allergy derivation rules query the AllergyCompetency and AllergyEquipmentCheck models directly; the evidence code is purely a routing key for `rederiveRequirementStatus`. Match exactly.

**Task G for PR 7:**
```bash
npx tsx scripts/seed-allergy.ts
npx tsx scripts/seed-clia.ts
```
Confirm the backfill output shows `N ComplianceItem flip(s)` for allergy (should be > 0 if any competency/drill/kit checks exist).

---

## Phase 1 close-out

Phase 1 is complete when all of the following are true:

1. **All 8 frameworks have at least one live derivation path.** `/modules/<code>` score moves on the corresponding action in `/programs/*`.
2. **CLIA documented.** Exactly which 6 CLIA requirements are manual-only at launch, and why, is documented in `clia.ts` header comment and mirrored in this file's CLIA table above.
3. **LeieScreening stubs flagged.** `dea.ts` and `oig.ts` each have the `TODO(Phase 11)` header block and stub functions.
4. **Allergy backfill wired.** `seed-allergy.ts` has `backfillFrameworkDerivations(db, "ALLERGY")` at the end of `main()`.
5. **`npm run test:run` green** (combined suite, not just the new files).
6. **`npx tsc --noEmit` clean.**
7. **`npm run lint` clean** (including `gw/no-direct-projection-mutation` — no derivation rule mutates projection state directly).
8. **Memory updated.** `V2 current state` memory file updated to mark Phase 1 complete.

---

## Spec coverage check

| Master roadmap Phase 1 item | Plan location | Notes |
|----------------------------|---------------|-------|
| OSHA 4 missing rules | PR 2 | Only 3 missing (300_LOG already shipped) |
| DEA 8 rules | PR 3 | 7 rules (1 stub for employee screening) |
| CMS 7 rules | PR 4 | 7 rules (3 pre-wired, 3 new, 1 stub-as-policy) |
| OIG extend 1→7 | PR 5 | 6 new rules + 1 partial stub |
| MACRA activity-log driven | PR 6 | `MACRA_ACTIVITY_LOGGED` event + 5 rules; 2 stubbed |
| TCPA 5 requirements | PR 6 | 3 policy-driven; 4 manual-only stubs (7 actual reqs) |
| CLIA manual-only documented | PR 7 | Table in this plan + header in `clia.ts` |
| Allergy confirm + backfill | PR 7 | Seed `acceptedEvidenceTypes` + backfill call added |
| POSTER_ATTESTATION event | PR 2 | In registry.ts + Zod schema |
| PPE_ASSESSMENT_COMPLETED event | PR 2 | In registry.ts + Zod schema |
| MACRA_ACTIVITY_LOGGED event | PR 6 | In registry.ts + Zod schema |
| OIG_ANNUAL_REVIEW_SUBMITTED event | PR 5 | In registry.ts + Zod schema |
| OIG_CORRECTIVE_ACTION_RESOLVED event | PR 5 | Replaces OIG_CORRECTIVE_ACTION model (simpler) |
| OVERPAYMENT_REPORTED event | PR 4 | In registry.ts + Zod schema |
| `acceptedEvidenceTypes` on every requirement | PRs 2–7 | Per-framework tables above |
| Integration tests per framework | PRs 2–7 | One test file per framework |
| Backfill rerun per framework | All seeds | backfill call present in all seeds; allergy added PR 7 |
| No schema migration unless required | PR 6 | `MacraActivityLog` model requires migration; documented |
| ESLint rule enforced | All PRs | No direct projection mutation; verified by lint step |
