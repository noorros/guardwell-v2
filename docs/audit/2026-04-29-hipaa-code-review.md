# HIPAA Code Review — Raw Findings

**Date:** 2026-04-29
**Source:** `superpowers:code-reviewer` subagent run against the HIPAA surface inventory.
**Status:** Read-only sample review of ~25+ files across 8 focus areas. Some categories sampled, broader review recommended where flagged.

> Do not fix during the audit. Triage + fix is a separate cycle. This file is one of two inputs to `2026-04-29-hipaa-findings.md` (the other is the Chrome interactive verify report).

## CRITICAL (3)

### C-1. SRA completion projection lacks cross-tenant guard
- **File:** `src/lib/events/projections/sraCompleted.ts:38-58`
- **Issue:** `projectSraCompleted` upserts `practiceSraAssessment` by `payload.assessmentId` without verifying the existing row's `practiceId` matches the calling practice — unlike `projectSraDraftSaved` (`sraDraftSaved.ts:52`).
- **Why it matters:** A user in Practice A who learns Practice B's `assessmentId` can submit `completeSraAction({ assessmentId: <other-practice-id>, ... })` and overwrite `completedByUserId`, `overallScore`, `completedAt`, plus delete and re-write all their answers — corrupting Practice B's HIPAA SRA. Tenant-isolation hole on the most sensitive HIPAA evidence row.
- **Fix:** Mirror the `existing.practiceId !== practiceId` guard from `sraDraftSaved.ts:52` before the upsert.

### C-2. SRA + officer + policy actions missing OWNER/ADMIN role gate
- **File:** `programs/risk/actions.ts:55-101`, `programs/staff/actions.ts:19`, `programs/policies/actions.ts:29-71`
- **Issue:** Vendor BAA actions check `pu.role !== "OWNER" && pu.role !== "ADMIN"`. These HIPAA-critical actions only check `if (!pu)`. Any authenticated MEMBER can: complete the practice's SRA, designate themselves as Privacy/Security Officer, adopt or retire policies.
- **Why it matters:** Self-promote to Security Officer flips `hipaaSecurityOfficerRule` to COMPLIANT. Adopt the breach response policy → satisfies `hipaaBreachResponseRule`. Privilege-escalation primitive on officer designation.
- **Fix:** Add OWNER/ADMIN gate with documented exception list (e.g. `acknowledgePolicyAction`, `submitQuizAction` legitimately need MEMBER access).

### C-3. No rate limiting on public BAA token routes
- **File:** `src/app/accept-baa/[token]/page.tsx:28`, `accept-baa/[token]/actions.ts:32`, `api/baa-document/[token]/route.ts:30`
- **Issue:** Three public no-auth surfaces accept a token from URL and `findUnique({ where: { token } })`. 32-byte token entropy is good, but no rate limit, no IP throttling, no Cloudflare/middleware guard, no failed-lookup logging. `tokenRow.consumedAt` only triggers a 410 — the lookup still happens.
- **Why it matters:** OCR audit standards expect explicit rate limiting on un-authenticated PHI-adjacent endpoints. A successful enumeration hit reveals practice name, vendor name, BAA terms, downloadable PDF.
- **Fix:** IP-based rate limit via Next middleware or Cloud Armor (10 lookups/IP/min, hard-block at 100/hr). Log every 4xx/410 hit.

## IMPORTANT (10)

### I-1. Audit PDFs render dates in UTC, not practice timezone
- **File:** `src/lib/audit/incident-breach-memo-pdf.tsx:217-223`
- **Issue:** `formatDate(d)` uses `d.toISOString().slice(0, 10)`, hardcoding UTC. A breach discovered 2026-04-28 21:00 PDT renders as `2026-04-29` on the OCR memo.
- **Fix:** Add `practice.timezone` (default from `primaryState`), pass into PDF generators, format with `Intl.DateTimeFormat`.

### I-2. Inconsistent rule treatment of zero-workforce edge case
- **File:** `derivation/shared.ts:70`, `:124` vs. `derivation/hipaa.ts:321`
- **Issue:** Course completion rules return GAP when `activeUsers.length === 0`. MFA + PolicyAcknowledgmentCoverage rules return null. New practice → `HIPAA_WORKFORCE_TRAINING` GAP but `HIPAA_MFA_COVERAGE_GE_80` NOT_STARTED.
- **Fix:** Pick one convention. Recommendation: return null when zero workforce.

### I-3. Single-policy BAA rule returns GAP when zero PHI vendors exist
- **File:** `derivation/hipaa.ts:172-184`
- **Issue:** `hipaaBaaRule` returns GAP when `phiVendors.length === 0`. Comment acknowledges intent but every other zero-state returns null. New practice sees permanent GAP on `HIPAA_BAAS` until manual override or first vendor add.
- **Fix:** Either return null when no PHI vendors OR add UI hint explaining the override.

### I-4. Major breach banner trusts upstream affectedCount to be non-negative
- **File:** `components/gw/MajorBreachBanner/index.tsx:29`
- **Issue:** Single guard `if (affectedCount < MAJOR_BREACH_THRESHOLD) return null;` — NaN/Infinity/negative all bypass via NaN-comparison rules. `Intl.NumberFormat` would render "NaN".
- **Fix:** `if (!Number.isFinite(affectedCount) || affectedCount < MAJOR_BREACH_THRESHOLD) return null;` + tests with NaN/-1/Infinity.

### I-5. Public BAA acknowledgment emit is best-effort but not idempotent
- **File:** `accept-baa/[token]/page.tsx:103-128`
- **Issue:** First page render emits `BAA_ACKNOWLEDGED_BY_VENDOR` without `idempotencyKey`. Two concurrent first renders (vendor opens link in two tabs) can emit two events.
- **Fix:** Add `idempotencyKey: "baa-ack-" + tokenRow.id`.

### I-6. recordIncidentNotificationAction lacks per-incident cross-tenant pre-check
- **File:** `programs/incidents/actions.ts:273-371`
- **Issue:** Cross-tenant verification happens inside the projection. May leave an event in EventLog before projection rejects (verify tx rollback semantics).
- **Fix:** Verify `db.$transaction` covers; if not, add pre-action `findUnique({ where: { id: incidentId } })`.

### I-7. Regulatory citations hardcoded throughout, no central registry
- **File:** 15+ files reference `§164.402`, `§164.530`, `§164.504(e)`. `MAJOR_BREACH_THRESHOLD` duplicated in `MajorBreachBanner/index.tsx:5` and `notifications/critical-alert.ts:30`.
- **Fix:** `src/lib/compliance/citations.ts` exporting `HIPAA_CITATIONS` map and `HIPAA_THRESHOLDS` constants.

### I-8. SRA wizard radio groups have no role/aria-label
- **File:** `programs/risk/new/SraWizard.tsx:212-236`
- **Issue:** 80q wizard renders 4 radio choices via `<label>` wrappers around hidden radios. No `role="radiogroup"`, no `aria-label`. `BreachDeterminationWizard.tsx:120-122` does it right.
- **Fix:** Wrap each question's option set in `<div role="radiogroup" aria-label={...}>`.

### I-9. AcceptBaaForm checkbox has no programmatic label
- **File:** `accept-baa/[token]/AcceptBaaForm.tsx:138-150`
- **Issue:** Implicit-association label, no `htmlFor`, `<input>` has no `id`. No error feedback when submit hit without checking — button just disabled.
- **Fix:** `id="agree"` + `htmlFor="agree"` + aria-live error message on invalid submit.

### I-10. No HIPAA-rule unit tests; entire derivation surface tested only via projection flows
- **File:** `tests/integration/` — missing `hipaa-derivation.test.ts`
- **Issue:** OSHA/DEA/CMS/OIG/MACRA/TCPA each have dedicated `*-derivation.test.ts`. HIPAA has none. Five newest rules (`hipaaPolicyAcknowledgmentCoverageRule`, `hipaaMfaCoverageRule`, `hipaaPhishingDrillRecentRule`, `hipaaBackupVerifiedRecentRule`, `hipaaDocumentationRetentionRule`) have **zero** test coverage.
- **Fix:** Author `tests/integration/hipaa-derivation.test.ts` covering each of 16 rules — COMPLIANT path, GAP path, null/zero-state, just-inside / just-outside freshness window edges.

## MINOR (8)

### M-1. `HIPAA_CA_BREACH_NOTIFICATION_72HR` rule key disagrees with its 15-biz-day window
- **File:** `derivation/hipaa.ts:507`
- **Fix:** Rename to `HIPAA_CA_BREACH_15_BIZ_DAYS`. Coordinated DB seed update to `RegulatoryRequirement.code`.

### M-2. Vendor BAA register PDF excludes retired vendors
- **File:** `api/audit/vendor-baa-register/route.tsx:30`
- **Fix:** Two-section PDF: Active + Retired (last 6 years).

### M-3. `executeBaaAction` doesn't log rejected attempts
- **File:** `accept-baa/[token]/actions.ts:45-72`
- **Fix:** Append `BAA_EXECUTE_REJECTED` event on each rejection (with reason). Pairs with C-3 rate limiting.

### M-4. BreachDeterminationWizard allows isBreach=true with affectedCount=0
- **File:** `incidents/[id]/BreachDeterminationWizard.tsx:67-98`
- **Fix:** Wizard validator: factor ≥ 5 OR composite ≥ 50 → require `affectedCount >= 1`.

### M-5. `formatDate` helper duplicated across audit PDFs
- **File:** `incident-breach-memo-pdf.tsx`, `incident-summary-pdf.tsx`, `vendor-baa-register-pdf.tsx`
- **Fix:** Hoist to `src/lib/audit/format.ts` as `formatPdfDate(date, timezone)`. Pairs with I-1.

### M-6. `revalidatePath("/modules/hipaa")` missing in some HIPAA-impacting paths
- **File:** `vendors/[id]/actions.ts` (only revalidates `/programs/vendors`)
- **Fix:** Add `revalidatePath("/modules/hipaa")` to BAA actions, or shared `revalidateHipaaSurfaces()` helper.

### M-7. `hipaaSraRule` reads `tx.techAsset` — model not in surface inventory
- **File:** `derivation/hipaaSra.ts:32-35`
- **Fix:** Verify `TechAsset` is populated by an onboarding step; otherwise gate behind feature flag or document prerequisite.

### M-8. `addBusinessDays` skips weekends but not federal holidays
- **File:** `derivation/hipaa.ts:276-285`
- **Fix:** `npm date-holidays` or accept the conservative over-estimation with a UI footnote.

## Top 5 priorities for fix-up session
1. **C-1** — `projectSraCompleted` cross-tenant guard. ~15 LOC.
2. **C-2** — OWNER/ADMIN gates on SRA, officer designation, policy actions. ~40 LOC across 3 files.
3. **C-3** — Rate limiting on `/accept-baa/[token]` and `/api/baa-document/[token]`.
4. **I-10** — Author `hipaa-derivation.test.ts` covering all 16 rules.
5. **I-1 + M-5 together** — Audit-PDF timezone correctness via `practice.timezone` + hoisted `formatPdfDate`.

## Sampling caveats
- BAA acceptance flow: 4/4 files reviewed.
- Derivation rules: full read of `hipaa.ts` + `hipaaSra.ts` + `shared.ts`; 50 state-overlay paths sampled (uniform `stateBreachNotificationRule` factory).
- Server actions: 5/6 sampled (incidents, vendors/[id], risk, policies, staff, training).
- PDFs: 1/4 routes deeply reviewed (breach memo); 1 cursory; recommend deeper review of `training-summary` route.
- Tests: gap-listed only; bodies not read.
- A11y: visual JSX inspect only; no axe/VoiceOver run.
