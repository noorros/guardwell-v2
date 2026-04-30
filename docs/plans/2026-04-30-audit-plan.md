# Remediation plan — 2026-04-30 cross-area audit

**Date:** 2026-04-30
**Source:** [`docs/audit/2026-04-30-audit-summary.md`](../audit/2026-04-30-audit-summary.md) + 5 per-module findings docs.
**Headline:** 97 findings across HIPAA / OSHA / Credentials / Allergy / Chrome — 17 Critical, 43 Important, 37 Minor.
**This doc:** phased shipping plan grouping findings into logical batches that can each ship as a single PR.

## Sequencing principles

1. **Critical-first**, but bundle items that share a refactor or test surface so a single PR closes a whole pattern (cheaper review + fewer regression windows).
2. **Repeat the prior audit's pattern** of small focused PRs for each item, except where a cross-cutting pattern naturally groups (e.g. role-gate sweep batch).
3. **Each PR adds tests for the issue it closes** AND the regression test that would have caught it earlier.
4. **No batch ships before a feature branch is cut, tests pass locally, and a Chrome verification follow-up is queued for after deploy.**
5. **Top-10 in summary doc maps roughly to Wave 1 + Wave 2 below.**

## Wave 1 — Critical security + audit-defense (target: same day)

Five PRs, all Small effort, all visible to OCR / state-board / OSHA inspectors.

### PR-A1 — Credentials holder-preservation regression (audit-summary #1)
- **Closes:** Credentials CR-1
- **Files:** `programs/credentials/actions.ts:152-162`, `events/projections/credential.ts:79-89`, new test in `tests/integration/credential-update.test.ts`
- **Change:** `updateCredentialAction` defaults `holderId` from existing row when payload omits it. Server-side; no UI change.
- **Test:** Seed credential with holder → call `updateCredentialAction` without holderId → assert `holderId` unchanged.
- **Effort:** S | **Risk:** low (additive default)

### PR-A2 — Role-gate sweep batch 2 (audit-summary #2, #4, #6, plus HIPAA C-3, OSHA I-10, HIPAA I-8)
- **Closes:** Credentials CR-2, Credentials CR-3, HIPAA C-2 (SRA), HIPAA C-3 (breach memo + incident summary PDFs), OSHA I-10 (cybersecurity actions), HIPAA I-8 (training summary PDF)
- **Files:**
  - `src/app/api/audit/credentials-register/route.tsx` — add OWNER/ADMIN gate
  - `src/app/(dashboard)/audit/activity/page.tsx` OR `src/lib/audit/format-event.ts` — redact licenseNumber for STAFF/VIEWER
  - `programs/risk/actions.ts:55-101, 103-142` — wrap with `requireRole("ADMIN")`
  - `src/app/api/audit/incident-breach-memo/[id]/route.tsx:29-32` — add OWNER/ADMIN gate
  - `src/app/api/audit/incident-summary/route.tsx:24-27` — add OWNER/ADMIN gate
  - `programs/cybersecurity/actions.ts:32, 92, 148` — add `requireRole("ADMIN")`
  - `src/app/api/audit/training-summary/route.tsx:41-43` — scope user query + add gate
  - `tests/integration/role-gate-sweep.test.ts` — add 7+ test cases
- **Test:** Mirror existing `addCredentialAction` STAFF rejection pattern.
- **Effort:** M | **Risk:** low (sweep adds gates, doesn't relax)
- **Notes:** Bundle into one PR titled "fix(rbac): close role-gate sweep gaps from prior #3 audit (audit #2026-04-30 batch)".

### PR-A3 — Cross-tenant `injuredUserId` validation (audit-summary #3)
- **Closes:** OSHA C-1
- **Files:** `programs/incidents/actions.ts:81-114, 427-474`
- **Change:** Add `db.practiceUser.findFirst({ where: { userId, practiceId, removedAt: null }})` validation in `reportIncidentAction` and `updateIncidentOshaOutcomeAction`. Throw if absent.
- **Test:** Add to `tests/integration/audit-15-history-row-edits.test.ts` — call with another practice's user id, assert throw.
- **Effort:** S | **Risk:** low

### PR-A4 — Cross-tenant projection guard sweep batch 2 (audit-summary #5)
- **Closes:** HIPAA C-1
- **Files:** All 8 projections under `events/projections/policy*` and `events/projections/baa*`
- **Change:** Add `assertProjectionPracticeOwned` to each. Mirror SRA / Credentials / Allergy pattern.
- **Test:** Extend `tests/integration/projection-cross-tenant-guards.test.ts` to cover Policy + BAA.
- **Effort:** M | **Risk:** low (defense-in-depth additive)

### PR-A5 — Allergy soft-delete cascade to notifications + projection guards (audit-summary #8, #9, #10, plus Allergy CR-1)
- **Closes:** Allergy CR-1, CR-2, CR-3, CR-4
- **Files:**
  - `eslint-rules/no-direct-projection-mutation.js:5-28` — add 4 missing tables to `PROJECTION_TABLES`
  - `src/lib/notifications/generators.ts:406-410, 448-452, 472-476` — add `retiredAt: null`
  - `events/projections/allergyCompetency.ts:111-185` — add `practiceUserId` check on quiz attempt projection
  - `events/projections/allergyCompetency.ts:80-88` — replace "any prior year qualified" with "year = c.year - 1 AND no inactivity flag"
  - Add 4 tests
- **Effort:** S | **Risk:** low to medium (CR-4 changes USP §21 qualification semantics — coordinate with stakeholders if any practice depends on the lax behavior)

---

## Wave 2 — Important user-facing + audit-defense (target: this week)

### PR-B1 — Removed-staff credentials orphan (audit-summary #7)
- **Closes:** Credentials CR-4
- **Files:** `programs/credentials/page.tsx:32-74`, possibly `prisma/schema.prisma` (PracticeUser onDelete: Restrict — IM-10)
- **Change:** Remove `orderedKeys` filter; render orphan credentials under "Former staff" group; re-include `removedAt: { not: null }` in page query.
- **Effort:** M | **Risk:** medium (visible UI change for practices that have offboarded staff)

### PR-B2 — Bulk-import correctness batch (Credentials CR-5, IM-4, IM-5)
- **Closes:** Credentials CR-5 (malformed-date crash), IM-4 (collision dedup), IM-5 (duplicate on re-upload)
- **Files:** `programs/credentials/actions.ts:268, 302-329, 310-315`, `prisma/schema.prisma` (partial unique index), Zod schema hardening.
- **Effort:** M

### PR-B3 — TZ-aware date input helper sweep (audit-summary Pattern C)
- **Closes:** Chrome CHROME-2, OSHA C-4 (Form 300 year filter), HIPAA I-3 (NotificationLog / AcknowledgeForm)
- **New helper:** `src/lib/audit/format.ts` → `formatPracticeDateForInput(date, tz): string` returning `YYYY-MM-DD` in tz.
- **Replace at:** `DrillTab.tsx`, `EquipmentTab.tsx` (`fmtDate`), `CredentialMetadataPanel.tsx` (`isoToYmd`), `NotificationLog.tsx`, `AcknowledgeForm.tsx`, `acknowledgments/page.tsx`, `osha-300/route.tsx` (year filter).
- **Effort:** M | **Risk:** medium (date semantics — verify with multi-tz tests)

### PR-B4 — Renew form respects `renewalPeriodDays` (Credentials IM-2)
- **Files:** `programs/credentials/[id]/page.tsx:101-108`, `CredentialMetadataPanel.tsx:366-370`
- **Change:** Thread `credentialType.renewalPeriodDays` through to `CredentialRenewForm`; default expiry = base + `renewalPeriodDays || 365`.
- **Effort:** S

### PR-B5 — BreachDeterminationWizard incident-type gate + affectedCount=0 guard (audit-summary OSHA C-2 + HIPAA I-6)
- **Closes:** OSHA C-2, HIPAA I-6
- **File:** `programs/incidents/[id]/page.tsx:172-176`, `BreachDeterminationWizard.tsx:67-99`, `programs/incidents/actions.ts:148`
- **Change:** Wrap wizard render in `incident.type === "PRIVACY" || "SECURITY"`. Require `affectedCount >= 1` when factor-5 trigger or composite >= 50.
- **Effort:** S

### PR-B6 — OSHA fatality-alert path (OSHA I-4)
- **Closes:** OSHA I-4 (§1904.39 8-hour clock)
- **New helper:** `src/lib/notifications/critical-osha-alert.ts` mirroring `critical-breach-alert.ts`.
- **Change:** Trigger from `reportIncidentAction` when `oshaOutcome === "DEATH"`. Email + in-app to all OWNER/ADMIN with deadline countdown. Append `INCIDENT_OSHA_FATALITY_REPORTED` event.
- **Effort:** M

### PR-B7 — OshaOutcomePanel fixes (Chrome CHROME-1 + OSHA I-5)
- **Closes:** Chrome CHROME-1 (injuredUserId not pre-selected), OSHA I-5 (ARIA missing)
- **Files:** `OshaOutcomePanel.tsx`
- **Change:**
  - Pre-select existing `injuredUserId` (render existing user as option even if not in `memberOptions`)
  - Add `aria-required` / `aria-invalid` / `aria-describedby` / wrap in `<fieldset><legend>`
  - Add OshaOutcomePanel to `audit-12-aria-sweep.test.tsx`
- **Effort:** S

### PR-B8 — OSHA recordkeeping correctness (OSHA C-3, I-1, I-7, I-9)
- **Closes:** OSHA C-3 (max-180 days), I-1 (poster TZ), I-7 (300A bounds), I-9 (5-year retention)
- **Files:** Multiple OSHA derivation/route/UI files. See OSHA findings doc.
- **Effort:** M

### PR-B9 — HIPAA derivation test suite (audit-summary test-gap #1)
- **Closes:** HIPAA I-7
- **New file:** `tests/integration/hipaa-derivation.test.ts` covering each of 16 federal + 50 state-overlay rules.
- **Effort:** L (largest defensive win per LOC, but biggest LOC of any PR in this wave)

### PR-B10 — ARIA sweep batch 2 (audit-summary Pattern D)
- **Closes:** HIPAA I-4 (AcknowledgeForm, AcceptBaaForm, PhishingDrillForm, BackupVerificationForm), Chrome CHROME-6 (LogDrillForm aria-required)
- **Files:** Add explicit `htmlFor`/`id` pairs in each form. Extend `audit-12-aria-sweep.test.tsx`.
- **Effort:** M

---

## Wave 3 — Important quality-of-life + audit-prep (target: next 2 weeks)

### PR-C1 — Multi-state AG notification (HIPAA I-1)
- **Closes:** HIPAA I-1
- **New model:** `IncidentStateAgNotification` join table (or JSON array on Incident).
- **Files:** `events/projections/incident.ts:257-277`, breach memo PDF.
- **Effort:** M

### PR-C2 — Allergy participants FK integrity (Allergy IM-2)
- **Closes:** Allergy IM-2
- **Change:** Zod refine for uniqueness; validate every participantId belongs to same practice with `removedAt: null`; "User no longer at practice" label.
- **Long-term:** Convert participantIds to a join table with proper FKs.
- **Effort:** M

### PR-C3 — Equipment kit history table (Allergy IM-6)
- **Closes:** Allergy IM-6
- **File:** `EquipmentTab.tsx`
- **Change:** Render kit history table similar to fridge.
- **Effort:** S

### PR-C4 — Allergy audit-prep packet (Allergy IM-3)
- **Closes:** Allergy IM-3
- **Files:** `src/lib/audit-prep/protocols.ts`, `evidence-loaders.ts`, possibly new packet PDF.
- **Effort:** L

### PR-C5 — Concierge tooling expansion (Allergy IM-4 + Credentials IM-9)
- **Closes:** Allergy IM-4, Credentials IM-9
- **Files:** `src/lib/ai/conciergeTools.ts`
- **Change:** Add allergy tools (`list_allergy_compounders`, `get_allergy_drill_status`, `get_fridge_readings`); add `id` to `list_credentials` payload.
- **Effort:** M

### PR-C6 — Citation registry expansion (Credentials IM-8)
- **Closes:** Credentials IM-8
- **Files:** `src/lib/regulations/citations.ts`
- **Change:** Add DEA term (§1301.13), state board licensure, CMS revalidation (§424.515).
- **Effort:** S

### PR-C7 — Credentials evidence isolation (Credentials MN-6)
- **Closes:** Credentials MN-6 (STAFF can download evidence for credentials)
- **Files:** `programs/credentials/[id]/page.tsx:57-65`, `/api/evidence/[id]/download/route.ts`
- **Change:** Filter by role on detail page; gate evidence download by role for `entityType: "CREDENTIAL"`.
- **Effort:** M

### PR-C8 — Audit-#18 backfill (Chrome CHROME-5)
- **Closes:** Chrome CHROME-5
- **One-shot script:** Find practices with no `SECURITY` officer; emit `OFFICER_DESIGNATED` event for OWNER.
- **Effort:** S (decision: ship script vs. document gap)

### PR-C9 — Notification milestone determinism (Credentials IM-7)
- **Closes:** Credentials IM-7
- **File:** `src/lib/notifications/generators.ts:32-34, 208-210`
- **Change:** Check `days <= m` only and rely on entityKey dedup. Or track which milestones have fired in `CredentialReminderConfig`.
- **Effort:** S

### PR-C10 — Render allergy qualification recompute as event (Allergy IM-11)
- **Closes:** Allergy IM-11
- **Change:** Add `ALLERGY_QUALIFICATION_RECOMPUTED` event with `{ practiceUserId, year, previous, next, reason }`.
- **Effort:** M

---

## Wave 4 — Cosmetic / docs / minor (target: opportunistic)

Bundle Minor findings into single PRs by category:

### PR-D1 — Date-input + page-title polish
- Chrome CHROME-3 (incident detail title), CHROME-4 (OSHA outcome title-case), HIPAA M-1 (CA breach rule rename), Credentials MN-1 (Remove confirm), Credentials MN-2 (BOM), Credentials MN-9 (badge fail-loud), Allergy MIN-1/MIN-2 (constants centralization), OSHA M-7 (outcome dropdown ordering), OSHA M-8 (event label).
- **Effort:** S total.

### PR-D2 — PHI sink documentation + scrubbing
- HIPAA M-8 (SRA notes textarea), Allergy MIN-4 (negative temp UX nudge), Allergy MIN-3 (boundary tests), HIPAA M-9 (citation split).

### PR-D3 — BAA hardening
- HIPAA C-4 (rate limiting on token routes), HIPAA M-5 (log rejected attempts), HIPAA M-2 (vendor BAA register includes retired), HIPAA M-4 (revalidate /modules/hipaa).

### PR-D4 — Code organization
- Credentials MN-4 (split CredentialDetail.tsx), Allergy MIN-8 (split CompetencyTab.tsx), HIPAA M-3 (federal holidays).

### PR-D5 — Allergy correctness boundaries
- Allergy MIN-5 (server-generated attemptId), MIN-6 (overdue color escalation), MIN-7 (rename payload field), Allergy IM-5 (SIX_MONTHS_MS reconciliation), IM-7 (cross-type field validation), IM-9 (RefrigeratorForm clear — likely already resolved), IM-10 (retired-drill admin view), IM-12 (replace window.confirm with shadcn Dialog).

### PR-D6 — Test coverage backfill
- All "no test for X" gaps not covered by Wave 1/2/3 PRs.

---

## Test-first guarantees per wave

| Wave | New tests required | Existing tests touched |
|---|---|---|
| Wave 1 | ~12 (1 per Critical) | `role-gate-sweep`, `projection-cross-tenant-guards`, `audit-15-history-row-edits`, `credential-update`, `allergy-quiz-grading`, `allergy-competency` |
| Wave 2 | ~25 | `audit-12-aria-sweep` (extend), `osha-300-first-aid-exclusion`, plus new `hipaa-derivation` |
| Wave 3 | ~10 | Minimal — mostly new test files |
| Wave 4 | ~5 | Minimal |

---

## Deployment cadence

- **Wave 1** = 5 PRs, all small. Could ship in a single day across 5 deploys (each ~5min Cloud Build + 1min revision).
- **Wave 2** = 10 PRs, 5–7 days at one PR per work-block.
- **Wave 3** = 10 PRs, 1–2 weeks.
- **Wave 4** = 6 PRs, opportunistic.

Cloud Build auto-deploys on merge to main; each PR gets its own revision. After each Wave-1 deploy, queue a Chrome verification follow-up for the new revision (mirror the audit #12 / #15 deploy verification pattern from the prior session).

## Out of scope (intentionally deferred)

- **DEA / CMS / OIG / MACRA module audits** — only HIPAA / OSHA / Credentials / Allergy were in scope this round.
- **State-overlay completeness audit** — 50 states' breach-notification statutes haven't been verified against the post-#196 timezone fixes one-by-one.
- **Concierge prompt-injection audit** — not in scope.
- **Performance audit (N+1, query complexity)** — multiple findings hint at this (`HIPAA I-8`, `Credentials IM-5`); deserves its own focused review.
- **Vendor / Tech-asset / Document-retention modules** — not in scope.
- **Onboarding flow** — not in scope.
