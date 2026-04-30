# Allergy / USP §21 findings — 2026-04-30 (second audit)

**Date:** 2026-04-30
**Reviewer:** Static code-review agent (read-only)
**Scope:** `src/app/(dashboard)/programs/allergy/`, `src/lib/compliance/derivation/allergy.ts`, `src/lib/events/projections/allergy*`, `src/lib/notifications/generators.ts` (allergy generators), `eslint-rules/no-direct-projection-mutation.js`, related tests.
**Prior audit:** [`2026-04-29-allergy-findings.md`](2026-04-29-allergy-findings.md). Recent merges in scope: PR #197 (audit #1 quiz answer-key), PR #200 (audit #9 compounding events), PR #202 (audit #2 cross-tenant), PR #213 (audit #15 history row edits — adds `retiredAt`, 4 new event types, inline edit forms).

## Inventory
- 11 allergy module source files reviewed (~3,100 LOC).
- **24 findings: 4 Critical / 12 Important / 8 Minor.**

## Critical (4)

### CR-1 — `allergyDrill` and `allergyEquipmentCheck` projection tables NOT covered by the no-direct-projection-mutation ESLint rule
- **File:** `eslint-rules/no-direct-projection-mutation.js:5-28`.
- **What's wrong:** `PROJECTION_TABLES` includes `allergyCompetency` and `practiceUser` (added in audit-#9), but **does not include `allergyDrill`, `allergyEquipmentCheck`, `allergyQuizAttempt`, or `allergyQuizAnswer`**. Every one of those tables has projection logic (audit-#15 added soft-delete + edit lanes), and ADR-0001 requires all writes to go through `appendEventAndApply`. A future contributor can `db.allergyDrill.create({...})` outside `src/lib/events/` and pass lint cleanly — exactly the regression class audit-#9 was supposed to prevent.
- **Audit-defense impact:** YES — audit-#15 work invested heavily in soft-delete + replay invariants; without lint enforcement the next "quick fix" silently bypasses retiredAt + tenant guards.
- **Fix:** Add the 4 names to `PROJECTION_TABLES` alongside `allergyCompetency`. Test files are in `ALLOWED_PATHS` so existing `db.allergyDrill.create` setup is fine.
- **Effort:** Trivial.

### CR-2 — Notification generators do NOT filter `retiredAt: null` on AllergyDrill or AllergyEquipmentCheck
- **File:** `src/lib/notifications/generators.ts:406-410, 448-452, 472-476`.
- **What's wrong:** Three queries find the "latest" drill, fridge reading, and kit check to drive ALLERGY_DRILL_DUE / ALLERGY_FRIDGE_OVERDUE / ALLERGY_KIT_EXPIRING notifications. None filter `retiredAt: null`. Concrete failure case post-audit-#15:
  1. Admin logs a drill on 2026-04-01.
  2. Realizes typo and soft-deletes it (sets `retiredAt`).
  3. Drill no longer counts toward `ALLERGY_ANNUAL_DRILL` derivation (correct).
  4. But the next notification cron sees the retired drill as "latest" → either (a) suppresses the "no drill" alert that should fire, or (b) issues an "overdue" alert tied to a row the user can't view.
- **Audit-defense impact:** YES — notification pipeline is the visibility layer that tells admins to act; it's now silently disagreeing with the compliance derivation pipeline.
- **Fix:** Add `retiredAt: null` to all three `where` clauses. Add regression test in `audit-15-history-row-edits.test.ts` that emits a delete then runs `generateAllergyNotifications`.
- **Effort:** S.

### CR-3 — `submitQuizAttemptAction` allows same-practice user to overwrite another user's prior quiz attempt
- **Files:** `programs/allergy/actions.ts:202-243` + `lib/events/projections/allergyCompetency.ts:111-185`.
- **What's wrong:** Action takes `attemptId` from user input. Projection's `assertProjectionPracticeOwned` only checks the prior attempt's `practiceId` matches — but does NOT check that the prior attempt's `practiceUserId` matches `payload.practiceUserId`. Upsert UPDATE path mutates `score`, `passed`, `correctAnswers`, `totalQuestions`, `completedAt` on the existing row but leaves `practiceUserId` unchanged. Concrete attack within a single practice:
  - STAFF user A starts a quiz at attemptId=X.
  - STAFF user B (same practice) somehow learns X (e.g., shared browser, log leak).
  - B's session calls `submitQuizAttemptAction({ attemptId: X, answers: [...] })` → action's payload sets `practiceUserId: B`.
  - Projection finds existing AllergyQuizAttempt at id=X with practiceId match → guard passes → UPDATE writes B's score onto A's attempt row.
  - Worse: line 174-177 — `tx.allergyCompetency.update({...})` for B's competency points to A's attempt row.
- **Audit-defense impact:** YES — entire competency evidence chain assumes attempts can't be retroactively rewritten with someone else's identity. UUID guessing impractical (128-bit), but if attemptIds ever leak the integrity guarantee is gone.
- **Fix:** In `projectAllergyQuizCompleted`, after the existing-attempt check around line 122-129, add:
  ```ts
  if (existingAttempt && existingAttempt.practiceUserId !== payload.practiceUserId) {
    throw new Error(`ALLERGY_QUIZ_COMPLETED refused: attempt ${payload.attemptId} belongs to another user`);
  }
  ```
- **Effort:** S (1 line + select field + 1 test).

### CR-4 — `recomputeIsFullyQualified` treats *any* prior-year qualification as renewal eligibility, ignoring lapse gaps
- **File:** `src/lib/events/projections/allergyCompetency.ts:80-88`.
- **What's wrong:**
  ```ts
  const priorQualified = await tx.allergyCompetency.findFirst({
    where: { practiceUserId: c.practiceUserId, year: { lt: c.year }, isFullyQualified: true },
  });
  const fingertipNeeded = priorQualified ? 1 : 3;
  ```
  Query says "ANY prior year where the user was qualified makes this a renewal". USP §21.3 specifies the **3-fingertip initial requirement returns** if there's a lapse. Concrete scenario:
  - 2024: Compounder qualifies (3 fingertip passes). `isFullyQualified=true`.
  - 2025: Compounder takes no quiz, no fingertip, no media fill. No 2025 row exists.
  - 2026: Compounder takes 1 fingertip pass. Projection runs → `priorQualified` finds the 2024 row → `fingertipNeeded = 1` → `isFullyQualified=true` after just 1 fingertip + quiz + media fill.
- **Audit-defense impact:** YES — state pharmacy boards inspecting "annual competency" expect re-qualification after a lapse to start over. Current behavior allows a lapsed compounder to show "fully qualified" with minimal effort.
- **Fix:** Replace "any prior year" query with "year = c.year - 1 AND isFullyQualified=true AND no inactivity flag at year-end". Add gap-year + inactive-prior-year tests.
- **Effort:** S.

## Important (12)

### IM-1 — `attestFingertipTestAction`, `attestMediaFillTestAction`, `logCompoundingActivityAction` allow targeting a removed practice user
- **File:** `programs/allergy/actions.ts:62-66, 95-99, 126-129, 158-164`. All four target-validation blocks check `target.practiceId === pu.practiceId` but NOT `target.removedAt === null`. **Fix:** Add `target.removedAt === null` to all four guards.

### IM-2 — AllergyDrill `participantIds` has no FK enforcement and no removedAt awareness
- **File:** `prisma/schema.prisma:1714, 1724` + `DrillTab.tsx:299-301`.
- **What's wrong:** `participantIds: String[]` stores PracticeUser IDs without FK. Three failure modes:
  1. **Removed users:** Drill with later-removed participant shows "Unknown" — auditors may see "Unknown" in a USP §21 evidence packet and disqualify it.
  2. **Duplicate IDs:** Zod `z.array(z.string().min(1)).min(1)` doesn't enforce uniqueness. Form's `Set<string>` prevents UI dupes, but a malicious POST could send `["A", "A"]` and count would say "2 participants" when only 1 person was there.
  3. **Cross-tenant IDs:** Never validated against the practice's PracticeUser. Forged event with another practice's participantIds persists with poison data.
- **Fix:** Zod refine for uniqueness; in `logDrillAction` + `updateDrillAction`, validate every participantId belongs to same practice with `removedAt: null`; surface "User no longer at practice" instead of "Unknown".

### IM-3 — Allergy missing from the audit-prep evidence-loaders / packet-pdf pipeline
- **File:** `src/lib/audit-prep/protocols.ts` (no Allergy) + `evidence-loaders.ts` (no allergy queries). Audit-prep covers HHS_OCR_HIPAA, OSHA, CMS, DEA. State pharmacy board / FDA inspections of an allergy-compounding practice are a higher-frequency audit risk than DEA/CMS for many customers. **Fix:** Add ALLERGY protocol + evidence loaders.

### IM-4 — Concierge AI has no Allergy-aware tools
- **File:** `src/lib/ai/conciergeTools.ts` (no allergy mentions). Concierge prompt advertises "USP §21 (Allergy)" support but no `list_allergy_compounders`, `get_allergy_drill_status`, or `get_fridge_readings` tools. **Fix:** Add allergy tools.

### IM-5 — 6-month inactivity boundary is exclusive vs. user expectation; SIX_MONTHS_MS inconsistent
- **File:** `lib/events/projections/allergyCompetency.ts:93-95`. Uses `>=`, so on the exact 183-day mark, `isInactive=true`. No boundary test. Also: `SIX_MONTHS_MS = 183 * day` while `page.tsx:13` uses `180 * day`. **Fix:** Add boundary tests at 182.99 / 183.0 / 183.01 days. Reconcile constants.

### IM-6 — `EquipmentTab` only displays the LATEST kit check; deleting it makes prior kit history invisible
- **File:** `programs/allergy/EquipmentTab.tsx:511, 516`. Only `latestKit` rendered. Temp section uses `.slice(0, 10)` history table; kit gets none. Operator never sees historical kit checks; can't audit kit history or correct an older typo without DB access. The audit-#15 edit affordance only operates on the visible row. **Fix:** Render kit history table similar to fridge.

### IM-7 — `updateEquipmentCheckAction` accepts both kit and fridge field sets without checking `existing.checkType`
- **File:** `programs/allergy/actions.ts:421-471`. `UpdateEquipmentInput` includes both kit fields and fridge fields. Action reads `existing.checkType` for rederive dispatch, but doesn't refuse cross-type updates. A buggy client could submit kit fields against a fridge row, nulling out the temperature. **Fix:** Read `existing.checkType` early and zod-narrow the input shape per-type.

### IM-8 — Race window on edit + delete of the same drill from two tabs
- **File:** `programs/allergy/actions.ts:333-371`. Defense-in-depth at projection layer works, but double-click on Save creates 2 ALLERGY_DRILL_UPDATED rows for one user action. Append-only pollution. **Fix:** Add idempotency on the EventLog (clientGeneratedId).

### IM-9 — `RefrigeratorForm` clear-on-success — likely already addressed
- **File:** `programs/allergy/EquipmentTab.tsx:206-221`. On success, `setTemperatureC("")` IS called. Mark prior B-2/U-4 as resolved.

### IM-10 — Anaphylaxis drill banner uses `drills[0]` (latest LIVE drill); if all retired, banner says "No drill on file"
- **File:** `programs/allergy/DrillTab.tsx:36-66`. Acceptable trade-off — schema `take: 20` limits to latest 20 live drills. Auditor verifying "did this practice EVER run a drill?" — answer is in EventLog, but UI conceals it. **Fix:** Document the design choice or add "View retired drills" admin link.

### IM-11 — `recomputeIsFullyQualified` does not record which years' competency state changed in the EventLog
- **File:** `lib/events/projections/allergyCompetency.ts:73-109`. When `isFullyQualified` flips (true→false due to inactivity, or false→true after compounding logged), it's a direct DB UPDATE with no event row. "When did Susan stop being qualified?" — no answer in EventLog. Same shape as audit-#9 problem. **Fix:** Add `ALLERGY_QUALIFICATION_RECOMPUTED` event with `{ practiceUserId, year, previous, next, reason }`.

### IM-12 — `HistoryRowActions` uses `window.confirm` for soft-delete
- **File:** `src/components/gw/HistoryRowActions/HistoryRowActions.tsx:53-56`. Native `window.confirm` is unstyled, can't render markdown citations to the rule it impacts, and prone to accidental "Enter to confirm". Cross-pattern with Credentials retire flow. **Fix:** Replace with shared `<DeleteConfirmDialog>` (shadcn Dialog).

## Minor (8)

### MIN-1 — Inconsistent SIX_MONTHS_MS definition across files
3 constants, 2 values (180 vs 183 days). **Fix:** Centralize.

### MIN-2 — `KIT_WINDOW_MS = 90` and `FRIDGE_WINDOW_MS = 30` duplicated as magic constants
**Fix:** Centralize.

### MIN-3 — Refrigerator in-range check uses inclusive boundary
USP §797 typically inclusive. **Fix:** Add boundary tests (2.0 / 8.0 / 1.99 / 8.01).

### MIN-4 — Negative temperatures (freezer mistake) accepted as valid input
**Fix:** UX nudge ("Did you mean to use the fridge thermometer?").

### MIN-5 — Quiz attempt UPSERT pattern accepts arbitrary attemptId from input
Related to CR-3 but lower severity. **Fix:** Server-generated attemptId.

### MIN-6 — `OverdueBanner` colors ages > 1 year as amber not destructive
USP §21.6 is hard-annual; anything past 365 days is failure. **Fix:** Escalate amber → destructive at >120% of the year.

### MIN-7 — `attestFingertip*` actions misleading payload field name
Naming `attestedByUserId` but value is `pu.id` (PracticeUser id, not User id). **Fix:** Rename payload field to `attestedByPracticeUserId`.

### MIN-8 — CompetencyTab is 522 LOC — beyond typical "single-component" threshold
**Fix:** Split AttestDialog, RequiredToggle, OverallBadge, MemberRow into separate files.

## What's well done
- **Quiz answer-key isolation (audit-#1)** is rigorously enforced. Strongest audit-fix evidence trail in the codebase.
- **Cross-tenant guards (audit-#2)** hit every projection.
- **Audit-#15 soft-delete cascade** correctly implemented at the derivation layer (all 4 derived rules filter `retiredAt: null`). Notifications are the gap (CR-2).
- **isFullyQualified recompute** is centralized in `recomputeIsFullyQualified` and called from all 4 mutation paths. Single source of truth.
- **Empty states** well-handled in CompetencyTab.
- **Idempotency** consistent — quiz attempt by attemptId, equipment check by equipmentCheckId, drill by drillId, soft-delete idempotent on retiredAt.
- **Audit-#9 ESLint rule expansion** to `practiceUser` and `allergyCompetency` is meaningful regression guard, though now incomplete (CR-1).
- **QuizRunner ARIA** — reference good pattern. Keep.

## Test coverage gaps
- **CR-1 / CR-2 / CR-3 / CR-4** all need new tests.
- **No test for the gap-year initial-vs-renewal path** — only consecutive-year renewal tested. Would have caught CR-4.
- **No test for retiredAt cascade to notifications** — audit-15 test proves derivation correctly skips retired rows but never invokes `generateAllergyNotifications` after retirement.
- **No quiz pass/fail boundary test** — does score=80% pass? does 79% fail? `grade.ts:91` uses `>= 80` so 80 should pass; not asserted.
- **No `removedAt` defense test** — confirming admin can't attest fingertip on a removed user.
- **No participant-FK-integrity test** — IM-2 cases.
- **No `submitQuizAttemptAction` end-to-end test** — would cover CR-3.
- **No test for kit-checked > 6 months ago** (page.tsx 6-month query truncation).
- **No test that `updateEquipmentCheckAction` preserves the original checkType** (IM-7).
- **No test for `OverdueBanner` thresholds** (DrillTab.tsx:36-66). 364-day drill should not trigger; 366-day should.
