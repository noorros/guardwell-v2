# Cross-Area Audit Summary — HIPAA / OSHA / Credentials / Allergy

**Date:** 2026-04-29
**Plan:** [`docs/superpowers/plans/2026-04-29-hipaa-osha-credentials-allergy-audit.md`](../superpowers/plans/2026-04-29-hipaa-osha-credentials-allergy-audit.md)
**Per-area findings docs:**
- [`2026-04-29-hipaa-findings.md`](2026-04-29-hipaa-findings.md)
- [`2026-04-29-osha-findings.md`](2026-04-29-osha-findings.md)
- [`2026-04-29-credentials-findings.md`](2026-04-29-credentials-findings.md)
- [`2026-04-29-allergy-findings.md`](2026-04-29-allergy-findings.md)

**Production target:** `https://v2.app.gwcomp.com`
**Test practice:** Prod Smoke Test (AZ)

## Headline numbers

| Area | Code review (C/I/M) | Chrome bugs | Tests passing | Verdict |
|---|---|---|---|---|
| HIPAA | 3 / 10 / 8 | 1 Crit + 2 High + 2 Med + 3 Low = 8 | 14 files, 77 tests | Largely "done" — 1 user-facing Crit (B-1 SRA auto-save) |
| OSHA | 3 / 10 / 14 | 1 Crit + 1 High + 2 Med + 2 Low = 6 | 10 files, 69 tests | Mostly "done" — 1 §1904.7 derivation bug |
| Credentials | 4 / 11 / 12 | 0 Crit + 4 High + 3 Med + 1 Low = 8 | 5 files, 23 tests | Largely "done" — UX feature gaps |
| Allergy | **5 / 11 / 11** | 0 Crit + 1 High + 4 Med + 1 Low = 6 | 4 files, 11 tests | **NOT "done"** — 1 live-validated security exploit (C-3) |
| **Total** | **15 / 42 / 45** = 102 | 2 Crit + 8 High + 11 Med + 7 Low = 28 Chrome | **33 files, 180 tests** | — |

## Top 10 must-fix items, ranked by impact

> Ordering criteria: live-validated > theoretical exploit; user-facing failure > internal correctness; audit-defense impact > UX papercut.

### #1 — Allergy C-3: Quiz `correctId` answer key leaked to client (LIVE-VALIDATED EXPLOIT)
- **File:** [`src/app/(dashboard)/programs/allergy/quiz/page.tsx:42`](../../src/app/(dashboard)/programs/allergy/quiz/page.tsx)
- **Live evidence:** ran `document.documentElement.outerHTML` on `/programs/allergy/quiz` while signed in as the practice OWNER. **44 occurrences of `correctId`** in the inline RSC payload — one per question — accompanied by the per-question explanation text. Sample: `correctId":"c","explanation":"USP 797 requires thorough handwashing..."`. Anyone can read the entire answer key via View Source or DevTools.
- **Impact:** invalidates the entire compounder competency assessment. `AllergyQuizAttempt` becomes a fiction.
- **Fix:** server-only correctId. ~30 LOC change in `quiz/page.tsx` + props.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #2 — Cross-area C-1: Cross-tenant guard missing on 11+ projections
- **Files:** `sraCompleted.ts:38-58` (HIPAA, found by HIPAA C-1) + `credential.ts` ×5 (Credentials C-1) + 5 Allergy projections + likely 0 OSHA (not flagged in OSHA review). Reference guard at `sraDraftSaved.ts:52`.
- **Impact:** any future event-emission path (cron, batch backfill, evidence pipeline triggers) bypasses the action-layer tenant validation and can mutate rows in another practice. Concrete attack: a forged event payload carrying Practice B's credentialId mutates Practice B's row from a Practice A actor.
- **Fix:** hoist the `existing.practiceId !== practiceId` check to a shared `requirePracticeOwned(tx, table, id, practiceId)` helper. Sweep all projection files. ~80-120 LOC system-wide.
- **Effort:** M | **Severity:** CRITICAL | **Audit-defense:** YES

### #3 — Cross-area C-2: OWNER/ADMIN role gate gap on actions
- **Files:** HIPAA (incident, officer designation, policy actions), OSHA (incident actions + PDF routes), Credentials (`addCredentialAction` + `removeCredentialAction` + `/api/credentials/export`), Allergy (per-target tenant check missing on attest actions).
- **Impact:** any MEMBER/STAFF/VIEWER can self-promote to officer (HIPAA), forge a DEA registration to inflate framework score (Credentials), increment another compounder's `fingertipPassCount` (Allergy).
- **Fix:** `requireRole("ADMIN")` helper exists at `src/lib/rbac.ts:37`. Sweep server actions + API routes. ~30 LOC + audit pass.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #4 — HIPAA B-1: SRA wizard auto-save loses Q1 answer + note before step transition
- **File:** [`src/app/(dashboard)/programs/risk/new/SraWizard.tsx`](../../src/app/(dashboard)/programs/risk/new/SraWizard.tsx)
- **Symptom:** wizard subtitle says "Answers save automatically as you move between steps." After answering Q1 + adding a note, waiting 8s, and reloading — both lost.
- **Impact:** real users will lose work. Phase 5 will expand SRA from 20 to 80 questions; losing 30+ minutes to a misclick is an active risk.
- **Fix:** save on each radio change, not just on step transition.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** indirect (data loss = blank assessment)

### #5 — OSHA C-1: §1904.7 violation — FIRST_AID outcomes count toward Form 300 Log
- **Files:** `src/lib/compliance/derivation/osha.ts:50-58` (`osha300LogRule`), `api/audit/osha-300/route.tsx:45-61`, `audit-prep/evidence-loaders.ts:484-512`
- **Impact:** §1904.7(b)(5) explicitly excludes first-aid-only injuries from Form 300. Inflated 300 totals → audit citation risk on next OSHA inspection.
- **Fix:** add `oshaOutcome: { not: "FIRST_AID" }` to all three sites.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #6 — Credentials C-4 + I-4: CSV injection in shared `BulkCsvImport`
- **Files:** `src/components/gw/BulkCsvImport/parseCsv.ts:128-134` (`csvEscape`), Credentials export route, bulk-import action.
- **Impact:** OWASP-cataloged CSV injection. An attacker with MEMBER access (per #3) creates a credential with `=cmd|'/C calc'!A1` in `notes`, waits for OWNER to download + open in Excel. Cross-cutting — shared with vendor + tech-asset bulk paths.
- **Fix:** prefix leading `=` `+` `-` `@` `\t` `\r` with a single-quote in `csvEscape`. Sanitize inbound rows in `bulkImportCredentialsAction`. ~15 LOC + 2-3 unit tests.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** indirect (post-exploitation chain)

### #7 — HIPAA B-3: No practice switcher; `getPracticeUser()` always returns oldest practice
- **File:** [`src/lib/rbac.ts:28`](../../src/lib/rbac.ts:28)
- **Impact:** multi-practice owners (consultants, parent–child setups) cannot use v2 without DB intervention. Audit cleanup gap (orphan practices accumulate).
- **Fix:** `selectedPracticeId` cookie + `<PracticeSwitcher>` in AppShell UserMenu. Touches `getPracticeUser` + onboarding completion.
- **Effort:** M | **Severity:** HIGH | **Audit-defense:** indirect (user-blocking)

### #8 — Credentials B-2: No Edit / Renew / Retire on credential detail page
- **File:** [`src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx`](../../src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx) (848 LOC, no Edit/Renew/Retire affordances surfaced)
- **Impact:** to update an expiry date, user must Remove + Re-Add, losing credential ID + EvidenceLog history + CeuActivity rows. The most user-facing credentials gap.
- **Fix:** surface inline-editable fields + Retire button on detail page. `updateCredentialAction` already exists in actions.ts — just needs UI wiring. ~150 LOC.
- **Effort:** M | **Severity:** HIGH | **Audit-defense:** indirect (data fidelity)

### #9 — Allergy C-5: `logCompoundingActivityAction` + `toggleStaffAllergyRequirementAction` bypass ADR-0001
- **Files:** Allergy actions.ts. Both directly mutate projection tables (`AllergyCompetency.lastCompoundedAt`, `PracticeUser.requiresAllergyCompetency`) without emitting events.
- **Impact:** no event records when `lastCompoundedAt` was set, by whom, or for which compounder. The USP §21 inactivity rule's entire evidence chain is silent.
- **Fix:** add 2 new event types (`ALLERGY_COMPOUNDING_LOGGED`, `ALLERGY_REQUIREMENT_TOGGLED`) + projections. Update ESLint `no-direct-projection-mutation.js` rule to cover the affected tables. ~50 LOC.
- **Effort:** M | **Severity:** CRITICAL | **Audit-defense:** YES

### #10 — Cross-area I-1: Practice timezone field — UTC dates render incorrectly for non-UTC practices
- **Files:** every PDF (`incident-breach-memo-pdf.tsx`, `osha-300-pdf.tsx`, `credentials-register-pdf.tsx`), every notification email body, every badge using `toISOString().slice(0, 10)`.
- **Impact:** AZ practice (MST UTC-7) submitting a renewal at 6pm local on 2026-06-30 stores as 2026-07-01 UTC and prints "expires 2026-07-01" on the audit PDF — one day past actual.
- **Fix:** add `practice.timezone String?` (default from `primaryState`), hoist `formatPracticeDate(date, tz)` helper to `src/lib/audit/format.ts`, replace UTC-truncating call sites. ~50 LOC + 1 Prisma migration.
- **Effort:** M | **Severity:** HIGH | **Audit-defense:** YES (PDF-rendered dates are the artifact OCR/state-board sees)

## Next 10 (priority bucket #2)

### #11 — Cross-area: Citation registry (HIPAA I-7 + OSHA I-8 + Credentials I-7 + Allergy I-7)
Hardcoded regulatory citations (`§164.402`, `1904.7(b)(5)`, `21 CFR §1301.13`, `USP §21.x`) sprinkled across UI strings. When OSHA/USP/HIPAA revise (USP 797 last revised 2023), every citation needs hand-update. Single registry → 1 helper. ~40 LOC.

### #12 — Cross-area: ARIA / form labelling sweep (HIPAA I-8/I-9 + OSHA I-9/I-10 + Credentials I-9/I-10 + Allergy I-8)
WCAG 2.1 AA 1.3.1 + 4.1.2 violations across multiple forms. Implicit `<label>` wrapping without `htmlFor`/`id`. **Bright spot:** Allergy `QuizRunner` has `role="radiogroup"` + `aria-label` — first reference-quality implementation (per code reviewer). Use as the template.

### #13 — Cross-area: "0 open gaps" stat semantics (HIPAA B-6 + Credentials B-6 + Allergy B-3)
Stat row shows "0 open gaps" while requirements list visibly shows N gaps. Either rename to "Time-sensitive gaps" or align definition. UX confusion across all 4 module pages.

### #14 — Allergy B-1: Logging fridge readings + drills doesn't flip /modules/allergy requirements to COMPLIANT
Either projection missing a `rederiveRequirementStatus` call, or framework gating (`compoundsAllergens=false`) is suppressing rule computation. Determine root cause; fix accordingly. Most user-impactful Allergy gap after C-3.

### #15 — Cross-area: Edit/Delete affordances on history rows (Credentials B-2 + Allergy U-2/U-3 + OSHA M-?)
Drill log, fridge log, OSHA incident outcomes all immutable from UI once recorded. Real users need typo-correction path. Single shared `<HistoryRowActions>` component. ~120 LOC.

### #16 — Credentials I-5 + I-11: 90-day vs 60-day boundary mismatch on EXPIRING_SOON
Page+Concierge use 90 days; PDF+notification generator use 60 days. Same credential = yellow on UI / green on PDF. Extract `getCredentialStatus()` + `EXPIRING_SOON_DAYS=90` constant to `src/lib/credentials/status.ts`. ~30 LOC.

### #17 — HIPAA B-4: PDF `≥` Unicode renders as `e` in breach memo
Breach memo PDF shows "Major breach — e500" instead of "≥500". Embed NotoSans Math font OR replace `≥` with `>=`. ~5 LOC + font change.

### #18 — HIPAA B-2: Practice owner defaults to `isComplianceOfficer` instead of `isSecurityOfficer`
Both creation paths (`onboarding/create-practice/actions.ts:43`, `sign-up/actions.ts:141`) seed `isComplianceOfficer: true`. HIPAA §164.308(a)(2) requires Security Officer. Two-line fix.

### #19 — OSHA B-3 / I-5: Form 300 "Employee" column shows reporter, not injured staff
Form 300 PDF maps `reportedByUserId` to the Employee column. §1904.35(b)(2)(v) governs *injured* employee privacy. Add `injuredUserId` field to `Incident`, surface "Which staff member was injured?" in the form. ~80 LOC.

### #20 — Allergy B-1 root-cause triage
(Listed at #14; calling out the triage step itself.) Read `src/lib/events/projections/allergyEquipment.ts` + `allergyDrill.ts` and compare to `credential.ts:33-40` rederive pattern. Likely 2-4 line fix per projection or a framework-gating doc clarification.

## Nice-to-have (not blocking)

- HIPAA B-7: friendly error page for invalid `/accept-baa/[token]`
- HIPAA B-8: PDF inline-vs-download UX consistency
- OSHA U-3: number-input triple-click-to-clear UX nit on Form 300A worksheet
- OSHA U-4: Death/Days dropdown collision (rename "Death" → "Fatal")
- Credentials B-1: Title auto-fill captures wrong type during keyboard nav
- Credentials B-3: No confirmation dialog on credential Remove
- Credentials B-4: /programs/staff has no credentials integration
- Credentials B-5: No search/filter on credentials list
- Allergy B-5: "All items present" checkbox defaults to checked (UX safety)
- Allergy B-6: /programs/policies vs /modules/allergy framework-activation inconsistency
- Allergy U-4: Form auto-clear inconsistency (Drill clears, Fridge doesn't)
- Cross-area: large component splits — `CredentialDetail.tsx` 848 LOC, `CompetencyTab.tsx` 522 LOC

## Cross-area pattern matrix

| Pattern | HIPAA | OSHA | Credentials | Allergy |
|---|---|---|---|---|
| C-1 cross-tenant projection guard gap | 1 (sraCompleted) | implicit | 5 (credential×5) | 5 (allergy×5) |
| C-2 OWNER/ADMIN role gate gap | Multiple actions | Multiple actions + PDF routes | 2 actions + export route | Per-target check missing on 2 attest actions |
| I-1 dates rendered in UTC | PDFs + notifications | 300 PDF + year boundary | PDF + 4 notification templates | All date displays |
| I-7/I-8 hardcoded citations | §164.x throughout | 1904.x + 1910.x | none (cite-free surface) | USP §21.x in 5 of 9 reqs |
| I-8/I-9 missing aria | SRA radios | Form 300A radios | Add form labels | Equipment + Drill forms (QuizRunner is GOOD) |
| "0 open gaps" stat disagreement | ✓ B-6 | (not measured) | ✓ B-6 | ✓ B-3 |
| No Edit/Delete on history rows | (incidents OK) | Form 300 row outcomes | Credential detail page | Drill + Fridge rows |

**New cross-area pattern surfaced by Allergy:**
- **C-5 silent projection mutations bypass ADR-0001** — `logCompoundingActivityAction` + `toggleStaffAllergyRequirementAction` directly mutate projection tables without emitting events. Worth re-checking HIPAA + OSHA + Credentials for similar holes (the ESLint rule `no-direct-projection-mutation` may have other gaps in the table coverage list).

**New cross-area pattern surfaced by Credentials:**
- **CSV injection (C-4)** — applies to ANY bulk-import or CSV-export surface. The `BulkCsvImport` shared component is used by credentials, vendors, tech-assets. Single fix unblocks all surfaces.
- **Boundary inconsistency across surfaces (I-5)** — credentials had 90-vs-60 day mismatch. HIPAA + OSHA may have similar derivation-window inconsistencies that didn't surface because prior reviews didn't have a directly-comparable cross-surface (Concierge + page + PDF + notification) consistency test.

## Recommended PR bundling for the triage cycle

1. **Bundle PR — cross-tenant guard sweep.** All 11+ projections lacking the guard. Single architectural pass + one shared `requirePracticeOwned()` helper. ~80-120 LOC. (#2 above)
2. **Bundle PR — OWNER/ADMIN role gate sweep.** ~30 LOC + audit pass through every server action. (#3 above)
3. **Bundle PR — practice timezone architectural fix.** Single Prisma migration + `formatPracticeDate(date, tz)` helper + replace UTC-truncating call sites system-wide. ~50 LOC. (#10 above)
4. **Bundle PR — citation registry.** ~40 LOC. (#11 above)
5. **Bundle PR — ARIA / form labelling sweep.** Use Allergy `QuizRunner` as the reference template. Likely 8-12 form components. (#12 above)
6. **Standalone PR — Allergy quiz answer-key fix.** Server-only correctId. ~30 LOC. (#1 above — may want to ship FIRST given the live exploit risk)
7. **Standalone PR — Allergy event-emission fix.** 2 new event types + projections + ESLint rule update. ~50 LOC. (#9 above)
8. **Standalone PR — OSHA §1904.7 fix.** Add `oshaOutcome: { not: "FIRST_AID" }` in 3 sites. ~10 LOC. (#5 above)
9. **Standalone PR — HIPAA SRA auto-save.** Save on each radio change, not just on step transition. ~30 LOC. (#4 above)
10. **Standalone PR — Practice switcher.** ~150 LOC + UserMenu wiring. (#7 above)

## Test coverage gaps (cross-area)

- **No `tests/integration/hipaa-derivation.test.ts`** (HIPAA I-10) — 5 newest HIPAA rules have zero coverage.
- **No `tests/integration/osha-300-log` direct test** (OSHA M-10) — covers the FIRST_AID exclusion + year-boundary.
- **No `tests/integration/credential-status-derivation.test.ts`** (Credentials I-11) — would have caught the 90-vs-60 day mismatch.
- **No `tests/integration/allergy-derivation-cascade.test.ts`** — would have caught Allergy B-1 (event → projection → rederive flip).
- **No CSV injection test** anywhere (Credentials C-4).
- **No quiz answer-key-leak test** (Allergy C-3) — `tests/integration/allergy-quiz.test.ts` should assert that the rendered HTML at `/programs/allergy/quiz` does NOT contain `correctId`.

## Sign-off

**All 4 area audits complete.** Findings docs and code-reviewer reports landed. Production verification covered every route in the per-area Chrome checklists. **Triage + fix is the next session.**

**Practice-data cleanup status:**
- HIPAA: orphan practice "HIPAA AUDIT 2026-04-29" remains in DB (Prod Smoke Test only path); recommend DB direct DELETE OR leave for the practice-switcher (B-3) ship.
- OSHA: audit OSHA incident resolved.
- Credentials: all 4 audit credentials removed (final state matches pre-audit).
- Allergy: audit fridge log + audit drill remain in DB (no UI delete); both clearly tagged "AUDIT-2026-04-29" for greppability.

**EventLog rows from all 4 audits remain by design** (append-only). Activity log filters by today will show the full audit trail.
