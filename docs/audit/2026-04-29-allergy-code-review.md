# Allergy Code Review — Raw Findings

**Date:** 2026-04-29
**Source:** Senior code-reviewer pass against the Allergy surface inventory.
**Status:** Read-only sample review across 8 focus areas. Inventory at [`2026-04-29-allergy-inventory.md`](2026-04-29-allergy-inventory.md).

> Read-only review. Triage + fix is a separate cycle. Output feeds the cross-area aggregation step alongside `2026-04-29-hipaa-code-review.md`, `2026-04-29-osha-code-review.md`, and `2026-04-29-credentials-code-review.md`.

**Summary: 5 Critical / 11 Important / 11 Minor**

> **False-positive note.** The inventory pre-flagged a HIGH PRIORITY role-gate vulnerability on `toggleStaffAllergyRequirementAction`. **This is confirmed FALSE.** At `src/app/(dashboard)/programs/allergy/actions.ts:135` the action DOES call `requireAdmin()`, AND lines 138–140 perform a per-target tenant check (`target.practiceId !== pu.practiceId`). The action is properly gated. The false-positive is NOT counted in the findings totals.

## CRITICAL (5)

### C-1. Allergy projections lack cross-tenant guard (5 projections)
- **Files:** `src/lib/events/projections/allergyCompetency.ts:20-43` (`ensureCompetency`), `:86-145` (`projectAllergyQuizCompleted`), `:147-168` (`projectAllergyFingertipTestPassed`), `:170-190` (`projectAllergyMediaFillPassed`), `src/lib/events/projections/allergyEquipment.ts:8-59` (`projectAllergyEquipmentCheckLogged`), `src/lib/events/projections/allergyDrill.ts:8-42` (`projectAllergyDrillLogged`)
- **Issue:** Same hole HIPAA C-1 found on `projectSraCompleted` and Credentials C-1 found on five credential projections. None of the five allergy projections verify that the row being mutated actually belongs to `args.practiceId`. The reference implementation at `sraDraftSaved.ts:52` (`if (existing && existing.practiceId !== practiceId) throw`) is NOT mirrored anywhere in the allergy projection layer.
  - `ensureCompetency` (`allergyCompetency.ts:24-32`) does `findUnique({ where: { practiceUserId_year: { practiceUserId, year } } })`. The `@@unique([practiceUserId, year])` constraint is global — if a row exists for that (practiceUserId, year) tuple in Practice B, the projection returns `existing.id` and the calling projection then `update`s Practice B's row with Practice A's payload (incrementing fingertipPassCount, setting mediaFillPassedAt, setting quizPassedAt, setting fingertipAttestedById to a Practice-A user, etc.). Cross-tenant data corruption.
  - `projectAllergyQuizCompleted` (`allergyCompetency.ts:92-112`) upserts on `payload.attemptId` (a global cuid). The `update` branch (line 105-111) sets `completedAt`, `score`, `passed`, `totalQuestions`, `correctAnswers` on whatever attempt has that id — including attempts in another practice. The subsequent `tx.allergyQuizAnswer.createMany` (line 117) writes new answer rows attached to the foreign-practice's `attemptId`, polluting Practice B's audit trail with Practice A's content.
  - `projectAllergyEquipmentCheckLogged` upserts on `payload.equipmentCheckId`. The `update` branch overwrites `checkedAt`, `epiExpiryDate`, `epiLotNumber`, `allItemsPresent`, `temperatureC`, `inRange`, `notes`. A forged event whose `equipmentCheckId` matches a Practice B row silently overwrites it with Practice A's payload — and triggers `rederiveRequirementStatus(tx, practiceId /* = A */, "ALLERGY_EMERGENCY_KIT_CURRENT")` mis-rederiving Practice A's score with no actual evidence.
  - `projectAllergyDrillLogged` upserts on `payload.drillId` with the same primitive — overwrite Practice B's drill scenario, observations, corrective actions, and participantIds.
- **Why it matters:** Action-level UUID generation (`actions.ts:216`, `:256`) covers the public action surface for equipment + drill (UUIDs are fresh per call), and the public quiz route generates `attemptId` server-side at `quiz/page.tsx:48`. So the public-API attack surface is constrained today. BUT ADR-0001 specifies `appendEventAndApply` is the only mutation path, and the lint rule (`eslint-rules/no-direct-projection-mutation.js`) does not even cover the allergy projection tables (see C-2 below) — meaning ANY future code path that emits these event types (cron, batch backfills, the future sync-from-v1 backfill described in `seed-allergy.ts`, or any non-action emitter) bypasses ID-uniqueness. The defense-in-depth model expects the projection itself to be tenant-safe.
- **Fix:** Mirror the `sraDraftSaved.ts:52` pattern at the start of each upsert call:
  ```ts
  // In ensureCompetency:
  const existing = await tx.allergyCompetency.findUnique({
    where: { practiceUserId_year: { practiceUserId, year } },
    select: { id: true, practiceId: true },
  });
  if (existing && existing.practiceId !== args.practiceId) {
    throw new Error(`ALLERGY_*_PASSED refused: competency belongs to a different practice`);
  }
  ```
  Same guard adapted for `AllergyQuizAttempt` (check by `attemptId`), `AllergyEquipmentCheck` (by `equipmentCheckId`), `AllergyDrill` (by `drillId`). Also: at `ensureCompetency` line 33-42, before the `create` branch, verify that `args.practiceUserId` resolves to a `PracticeUser` whose `practiceId === args.practiceId` — otherwise the create branch can produce a row with `practiceId` and `practiceUserId` that point to different practices.

### C-2. `attestFingertipTestAction` and `attestMediaFillTestAction` lack per-target tenant check
- **Files:** `src/app/(dashboard)/programs/allergy/actions.ts:43-64` (fingertip), `:71-92` (media fill)
- **Issue:** Both attest actions accept `practiceUserId: z.string().min(1)` from input (lines 39, 67) and pass it straight to the event payload (lines 48, 76) without any check that the target `practiceUserId` belongs to the calling practice. Compare with `logCompoundingActivityAction` (line 101-104) and `toggleStaffAllergyRequirementAction` (line 137-140), both of which DO perform `target.practiceId !== pu.practiceId` lookups. The two attest actions are inconsistent.
  - Practice A's OWNER calls `attestFingertipTestAction({ practiceUserId: <Practice B user cuid>, notes: null })`. `requireAdmin()` passes (Practice A's owner). `appendEventAndApply` writes an `ALLERGY_FINGERTIP_TEST_PASSED` event into Practice A's EventLog, but the projection (per C-1) finds Practice B's competency row keyed by `(practiceUserId, year)` and increments `fingertipPassCount` on Practice B's row. After 3 such attestations + a forged media fill + a forged quiz, Practice A's actor can flip Practice B's `isFullyQualified` to `true`, satisfying Practice B's `ALLERGY_COMPETENCY` rule for a user the legitimate Practice B owners may not even have qualified.
  - `attestedByUserId: pu.id` (lines 50, 78) leaks Practice A's `pu.id` into Practice B's competency row — visible in `fingertipAttestedById` / `mediaFillAttestedById` to anyone joining the audit trail.
- **Why it matters:** Mirrors HIPAA C-2 / OSHA C-2 / Credentials C-2 in spirit (insufficient privilege check) and pairs with C-1 — even with the projection-layer guard in C-1, the action layer should validate that `parsed.practiceUserId` belongs to `pu.practiceId` BEFORE emitting the event. Today, defense-in-depth fails at both layers for these two actions.
- **Fix:** Add the same target-lookup pattern that `logCompoundingActivityAction` already uses, before the `appendEventAndApply` call:
  ```ts
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  ```
  Apply to both `attestFingertipTestAction` and `attestMediaFillTestAction`. Optional: refactor a `requireAdminWithTarget(targetPracticeUserId)` helper at line 28 that returns `{ user, pu, target }` and bake the check in.

### C-3. Quiz `correctId` is shipped to the client, allowing trivial answer-key extraction
- **Files:** `src/app/(dashboard)/programs/allergy/quiz/page.tsx:38-45`, `src/app/(dashboard)/programs/allergy/QuizRunner.tsx:14-21`
- **Issue:** The server component at `quiz/page.tsx:38-45` serializes every quiz question with `correctId: q.correctId` and passes the array as a prop to the client component `<QuizRunner questions={serializedQuestions} />` (line 99-102). Next.js renders the client component's props into the page payload (HTML for the streaming-RSC payload + the React client bundle), which is fully readable from the browser:
  - View page source → search for the question text → adjacent `correctId` field exposes the answer.
  - React DevTools (any user can install) → inspect `<QuizRunner>` props → see `questions[].correctId` array.
  - `window.__NEXT_DATA__` (or the Next 16 streaming RSC payload) contains the full question objects with `correctId`.
  Once the user has the answer key, they pass the quiz with score=100 every attempt. The action's server-side scoring (`actions.ts:162-174`) re-checks `correctMap.get(a.questionId) === a.selectedId` — but the user submitted the correct answer keys they read off the client bundle, so the server agrees and returns `passed: true`. The "competency assessment" is structurally bypassable.
- **Why it matters:** **Audit-defense impact.** The §21 quiz is the documented evidence that a compounder has demonstrated knowledge of aseptic technique, BUDs, and emergency response. The compliance value is contingent on the quiz being a genuine assessment. A user can pass without reading the questions, and there is no behavioral signal (timing, answer-change patterns, etc.) tracked. State board inspectors examining `AllergyQuizAttempt.score = 100, passed = true` rows have no way to know that the score was obtained by reading the answer key from the page payload. This is the single most consequential design flaw in the surface — it invalidates the trust boundary of the entire competency system.
- **Fix:** Two layers, both required:
  1. **Strip `correctId` from the client payload.** The server component should serialize only `id`, `questionText`, `options`, `category` (no `correctId`, no `explanation`). The client-side scoring (`QuizRunner.tsx:215-223`) is for the post-submission **review panel** — for that panel, fetch the correct answers AFTER submission via a server action (`getQuizReviewAction(attemptId)`) so the answer key is only revealed once the user has submitted.
  2. **Bind `attemptId` to user identity on the server.** Today `attemptId` is generated in `quiz/page.tsx:48` and passed as a prop. A user can replay the same `attemptId` indefinitely until they get a passing score (the projection's upsert IS idempotent — line 92-112 — so re-submitting overwrites the same attempt row, but each new submission gets re-scored). At minimum, the server should record `(attemptId, practiceUserId)` as a one-shot reservation when the page renders, and refuse a second `submitQuizAttemptAction({ attemptId })` from any other user. Better: emit `ALLERGY_QUIZ_STARTED` on page render to lock the attemptId to the user, so the projection can refuse a `_COMPLETED` for an attemptId that was never started by that user.

### C-4. `submitQuizAttemptAction` lacks the OWNER/ADMIN gate AND lacks a `requiresAllergyCompetency` precondition
- **File:** `src/app/(dashboard)/programs/allergy/actions.ts:154-200`
- **Issue:** The action authenticates with raw `requireUser()` + `getPracticeUser()` (lines 157-159) — no role gate. This is intentionally laxer than the other 5 actions (compounders take their own quizzes), but two issues compound:
  - **No `requiresAllergyCompetency` precondition.** Any practice user — VIEWER, STAFF, MEMBER, ADMIN, OWNER, even a non-compounding receptionist — can take the quiz and create an `AllergyQuizAttempt` + (if passed) an `AllergyCompetency` row. While these rows don't flip `ALLERGY_COMPETENCY` to COMPLIANT (the derivation in `allergy.ts:20-26` only counts users with `requiresAllergyCompetency=true`), they pollute the audit table with "qualifications" for users who shouldn't be qualified at all. Auditor sees a 100-staff practice with 80 `AllergyCompetency` rows for `isFullyQualified=true` users and assumes 80 compounders, when the reality is 5 compounders + 75 receptionists who each took the quiz once for fun.
  - **Combined with C-3,** the lack of role gate means the answer-key bypass works for any user — including external auditors, contractors, or part-time consultants who happen to have a `PracticeUser` row.
- **Why it matters:** Audit-defense pollution + the trust boundary failure from C-3 cascades into a "anyone with a PracticeUser row creates qualification rows for themselves" primitive. The combination of C-3 + C-4 means the only safeguard is `requiresAllergyCompetency` flag — but the ALLERGY framework derivation is the only place that's checked. If a future report or external audit query joins on `AllergyCompetency` directly (without filtering by `requiresAllergyCompetency`), the report includes false positives.
- **Fix:** Add a precondition at `actions.ts:160`: load `pu` via the same `getPracticeUser()` call, then `if (!pu.requiresAllergyCompetency) throw new Error("This account is not designated as a compounder. Ask your admin to enable allergy competency for your account.");`. (Alternative: don't gate the action, but DO gate the route — `quiz/page.tsx:14-28` should redirect non-compounders to `/programs/allergy` with a "you are not designated as a compounder" message. Then the action layer can still defensively re-check.) Pairs with the broader C-3 fix.

### C-5. `logCompoundingActivityAction` bypasses the event-sourcing model (ADR-0001)
- **Files:** `src/app/(dashboard)/programs/allergy/actions.ts:98-127` (action), `eslint-rules/no-direct-projection-mutation.js:5-22` (lint rule's projection-table allowlist)
- **Issue:** `logCompoundingActivityAction` directly upserts `AllergyCompetency` (line 106-120) and then calls `recomputeIsFullyQualified` inside a separate transaction (line 122-124) — without emitting any event. ADR-0001 requires that all projection-table mutations go through `appendEventAndApply` (per the comment in `src/lib/events/append.ts:1-3` and the lint rule). The lint rule blocks this pattern for `complianceItem`, `practicePolicy`, `credential`, etc. — but `allergyCompetency` is NOT in the `PROJECTION_TABLES` set (`eslint-rules/no-direct-projection-mutation.js:5-22`). Same for `practiceUser` (used by `toggleStaffAllergyRequirementAction:141-144`).
- **Why it matters:**
  - **No EventLog audit trail.** USP §21's inactivity rule (lastCompoundedAt > 6 months → flip `isFullyQualified` false) is the only mechanism preventing a stale qualification from rolling forward. The `lastCompoundedAt` field is the entire compliance evidence — but there is NO event in `EventLog` recording when it was set, by whom, or for which staff member. Auditor asks "show me the audit trail of compounding sessions" → there is none. The competency row's `lastCompoundedAt` field changes silently with no parallel event. This breaks the v2 architectural bet (per `docs/specs/module-page-contract.md`: evidence-driven compliance with EventLog as the audit substrate).
  - **No idempotency.** Without `idempotencyKey`, retried calls (network blip → user clicks "Log session" twice) can over-write `lastCompoundedAt` with the same value harmlessly today, but the lack of an event also means there's no way to dedupe later: "did the compounder log 5 sessions today, or did the same click retry 5 times?"
  - **Lint blind-spot.** The lint rule's allowlist needs every projection table enumerated; the allergy projection tables (`AllergyCompetency`, `AllergyEquipmentCheck`, `AllergyDrill`, `AllergyQuizAttempt`, `AllergyQuizAnswer`) plus `PracticeUser` (touched by `toggleStaffAllergyRequirementAction`) are all missing. Future direct-mutation regressions on these tables ship lint-clean.
  - **Race condition.** `logCompoundingActivityAction` opens TWO DB sessions (the upsert at line 106 outside any transaction, then the recompute transaction at line 122). If the upsert succeeds and the process dies before the recompute, `lastCompoundedAt` is set but `isFullyQualified` is not recomputed — leaving the row in an inconsistent state until the next event triggers a recompute (or never, if the compounder never re-attests).
- **Fix:** Add a new event type `ALLERGY_COMPOUNDING_LOGGED` (payload: `{ practiceUserId, year, loggedAt }`). Move the action to use `appendEventAndApply` with a projection that does the upsert + recompute inside the single transaction. Add `idempotencyKey: \`compounding-${practiceUserId}-${YYYY-MM-DD}\`` so a daily click-burst is deduped. Separately, expand `eslint-rules/no-direct-projection-mutation.js:5-22` PROJECTION_TABLES to include `allergyCompetency`, `allergyEquipmentCheck`, `allergyDrill`, `allergyQuizAttempt`, `allergyQuizAnswer` so future regressions are caught at lint time.

## IMPORTANT (11)

### I-1. Dates rendered in UTC, not practice timezone
- **Files:** `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx:200-202` (`fmtDate`), `EquipmentTab.tsx:28-30` (`fmtDate`), `DrillTab.tsx:28-30` (`fmtDate`), `:71` (today prefill), `quiz/page.tsx` indirectly via attempt records, plus all 6 `new Date().getFullYear()` call sites in `actions.ts:46,74,105,176`, `page.tsx:28`, `notifications/generators.ts:503`
- **Issue:** Mirrors HIPAA I-1 / OSHA I-1+I-4 / Credentials I-1. Every date in the allergy surface uses `iso.slice(0, 10)`, hardcoding UTC. Worst-case scenario for an Arizona practice (MST, UTC-7):
  - **Year-boundary attestation drift.** A compounder's supervisor attests fingertip pass on 2026-12-31 18:00 MST. `actions.ts:74` computes `year = new Date().getFullYear()` on the Cloud Run server (UTC) → 2027. The competency row gets created for `year=2027` and the 2026 row remains incomplete forever. The compounder shows up in the unqualified list for 2026 (UTC year boundary issue) until someone notices.
  - **DrillTab pre-fill drift.** `DrillTab.tsx:71` does `today = new Date().toISOString().slice(0, 10)` to prefill the "Date conducted" field. For a Pacific user filling out the drill log at 5pm PT, the prefill says "tomorrow." Subtle confusion.
  - **CompetencyTab quiz-passed badge.** `CompetencyTab.tsx:309` renders `fmtDate(competency.quizPassedAt)`. A user who passed at 5pm PT sees the badge dated "tomorrow" in their local view — gives the impression the quiz was taken on a different day than they remember.
- **Why it matters:** Single architectural fix that pairs with HIPAA I-1, OSHA I-1+I-4, Credentials I-1. The year-boundary attestation drift (the most consequential of the three above) is an audit-trail data-integrity issue: the year on the `AllergyCompetency` row, the `AllergyQuizAttempt.year`, and the practice operator's mental model can diverge by 1.
- **Fix:** Single architectural fix that pairs with the other 3 reviews: add `practice.timezone String?` to the schema (default from `primaryState`), hoist a `formatPracticeDate(date, tz)` helper to `src/lib/audit/format.ts`, replace all `toISOString().slice(0,10)` dates AND `new Date().getFullYear()` calls in audit/PDF/notification code paths with timezone-aware equivalents (`getYear(now, tz)` for the year, `formatPracticeDate(date, tz)` for date strings).

### I-2. `recomputeIsFullyQualified` treats any prior-year qualification as renewal-eligible (skip-year exploit)
- **File:** `src/lib/events/projections/allergyCompetency.ts:55-63`
- **Issue:** The "renewal year" logic queries `priorQualified = await tx.allergyCompetency.findFirst({ where: { practiceUserId, year: { lt: c.year }, isFullyQualified: true } })`. This finds ANY previously-qualified year, not the immediately-prior year. Scenario: A compounder qualifies in 2024 (3 fingertip passes + quiz + media fill), is dormant in 2025 (no work, no AllergyCompetency row at all OR a row with `isFullyQualified=false`), then returns in 2026. At line 56-62 the projection finds 2024's qualified row → `fingertipNeeded = 1` (renewal). The compounder qualifies in 2026 with only 1 fingertip pass + 1 quiz + 1 media fill — even though USP §21's "annual renewal" framing implies continuous yearly qualification.
- **Why it matters:** USP §21 inactivity rules treat skipped years as a competency lapse. The 6-month inactivity rule (line 65-70) catches some cases via `lastCompoundedAt`, but only if `lastCompoundedAt` is being kept current by the (un-eventized — see C-5) `logCompoundingActivityAction`. A compounder who skipped a year and never logged a session has `lastCompoundedAt = null`, so `isInactive = false` (line 68-70: `c.lastCompoundedAt !== null && ...`), and they qualify as a renewal in the new year with only 1 fingertip pass. State board auditors checking continuous qualification will flag this.
- **Fix:** Change the prior-year query to require the IMMEDIATELY-prior year:
  ```ts
  const priorQualified = await tx.allergyCompetency.findFirst({
    where: { practiceUserId, year: c.year - 1, isFullyQualified: true },
    select: { id: true },
  });
  ```
  Add a regression test asserting that 2024 qualified + 2025 missing → 2026 needs 3 fingertip passes (initial requalification, not renewal).

### I-3. Multiple sources of truth for the 6-month inactivity window (180d vs 183d) and the 365-day drill window
- **Files:** `src/app/(dashboard)/programs/allergy/page.tsx:13` (`SIX_MONTHS_MS = 180 * DAY_MS`), `src/lib/events/projections/allergyCompetency.ts:46` (`SIX_MONTHS_MS = 183 * DAY_MS`), `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx:214` (`SIX_MONTHS_MS = 183 * DAY_MS`), `src/lib/compliance/derivation/allergy.ts:11-13` (`KIT_WINDOW_MS = 90d`, `FRIDGE_WINDOW_MS = 30d`, `DRILL_WINDOW_MS = 365d`), `src/app/(dashboard)/programs/allergy/DrillTab.tsx:32` (`ONE_YEAR_MS = 365d`)
- **Issue:** Three locations declare a `SIX_MONTHS_MS` constant. Two use 183 days (the projection + CompetencyTab UI), one uses 180 days (page.tsx — used to filter equipment checks at line 43). The 183-day value matches the CompetencyTab visual badge "Inactive >6mo" (line 383) and the projection's `isInactive` check. The 180-day value at page.tsx:13 is a 6-month equipment-checks lookback (separate semantic from the inactivity rule), but the variable name collision invites confusion. Same drift on the drill window: `DRILL_WINDOW_MS = 365d` in `allergy.ts:13` and `ONE_YEAR_MS = 365d` in `DrillTab.tsx:32`.
- **Why it matters:** Two failure modes:
  1. **Visual / projection drift.** The CompetencyTab's "Inactive >6mo" badge (line 383, computed at line 215-218 with 183d) and the actual `isFullyQualified` recompute (line 68-70 of `allergyCompetency.ts` with 183d) agree today. Good. But the page.tsx fetches `equipmentChecks` for the last 180 days (line 43) — so a check 181-183 days old is hidden from the UI but still affects `deriveAllergyEmergencyKit` (which uses 90 days, line 52 of `allergy.ts`). UI shows "no recent checks" while the rule shows COMPLIANT — which is fine for the rule, but the UX is confusing.
  2. **Constant duplication.** Three+ places define the same number. A future "increase to 240 days for clinical reasons" change will silently miss one site. Audit-trail rule changes are exactly the kind of business-logic update that has to land in lock-step.
- **Fix:** Centralize: extract `src/lib/compliance/allergy/constants.ts` exporting `INACTIVITY_WINDOW_DAYS = 183`, `KIT_WINDOW_DAYS = 90`, `FRIDGE_WINDOW_DAYS = 30`, `DRILL_WINDOW_DAYS = 365`, `EQUIPMENT_HISTORY_WINDOW_DAYS = 180` (different semantic, different name). Replace all 6+ inline constants. Add a unit test asserting that the inactivity badge in CompetencyTab agrees with the projection's `isInactive` calculation at the day-186 boundary.

### I-4. Equipment / drill / quiz windows use `Date.now()` non-deterministically
- **Files:** `src/lib/compliance/derivation/allergy.ts:52,72,92` (`Date.now()` in 3 derivation rules), `src/lib/events/projections/allergyCompetency.ts:70` (inactivity check uses `Date.now()`)
- **Issue:** Mirrors Credentials M-10 / OSHA M-12. `Date.now()` is evaluated at the moment the WHERE clause runs, not at a deterministic top-level. Within a single rederive batch (which calls multiple rules in sequence), an `AllergyEquipmentCheck.checkedAt` exactly at the 90-day boundary may flip between rules — `deriveAllergyEmergencyKit` says GAP (90+ days old at the time line 52 evaluated) and `deriveAllergyRefrigeratorLog` says COMPLIANT (line 72 ran 5ms later, still within 30 days for a different check type). Mostly cosmetic in production, but blocks deterministic testing — every test that creates a "just inside" or "just outside" boundary record needs to mock the clock.
- **Why it matters:** The agent's flagged test gaps (no boundary tests for 90-day kit window, 30-day fridge window, 365-day drill window) cannot be cleanly authored without injectable `now`. The current test suite relies on relative offsets (`Date.now() - 5 * DAY_MS`) which is fine when both the test and the rule observe the same wall-clock — but the boundary tests need `now` to be a fixed value.
- **Fix:** Pass `now: Date` through the `DerivationRule` signature; default to `new Date()` at the rederive top-level, then propagate. Same pattern for `recomputeIsFullyQualified`: accept a `now: Date` arg and use it instead of `Date.now()` on line 70. Allows deterministic boundary testing.

### I-5. Quiz pass-fail boundary has no test (79 vs 80)
- **File:** `tests/integration/allergy-competency.test.ts` (no test of boundary), `src/app/(dashboard)/programs/allergy/actions.ts:174-175` (`score = Math.round((correct / total) * 100); passed = score >= 80`)
- **Issue:** `Math.round((19 / 24) * 100) = 79` (fails). `Math.round((20 / 25) * 100) = 80` (passes). `Math.round((39.5 / 50) * 100) = 79`. `Math.round((40 / 50) * 100) = 80`. The boundary at 79.5 rounds UP to 80 → passes. So a 19/24 attempt fails (79.17 → 79), but a 20/25 attempt passes (80 exactly), and a 79.5 raw score (impossible at the integer level but a real concern if `score` ever becomes a fractional Float) passes. Untested.
- **Why it matters:** USP §21 doesn't specify a pass threshold beyond "competency demonstrated" — 80% is a v2 product choice (`actions.ts:175`). The boundary is exactly the kind of business rule that an audit team will probe ("does 79.5% really pass?"). Today there's no answer in the test suite. Pairs with C-3 — once C-3 is fixed and the answer key is hidden, the score boundary becomes the single most important compliance check on the surface.
- **Fix:** Add boundary tests in `allergy-competency.test.ts`:
  - `score = 79, passed = false` (22 of 28 = 78.57 → 79).
  - `score = 80, passed = true` (20 of 25 = 80 exact).
  - `score = 0` with `total = 0` returns score=0, passed=false (current behavior at line 174 with the `total === 0` guard).
  - `score = 100` with all correct.

### I-6. `submitQuizAttemptAction` re-stamps `quizPassedAt` on every replay of the same passed event
- **File:** `src/lib/events/projections/allergyCompetency.ts:128-138`
- **Issue:** When the projection replays a passed quiz event (e.g. via test backfill, replay tool, or future audit-rebuild path), it re-runs lines 134-137: `update({ quizAttemptId: attempt.id, quizPassedAt: new Date() })`. The `quizPassedAt` field is set to **the current wall-clock time at replay**, not the original completion time. The audit trail shows "the quiz was passed today" instead of "the quiz was passed on 2026-04-15" — destroys historical fidelity.
- **Why it matters:** ADR-0001's value proposition is that re-running projections from EventLog yields the same DB state. This invariant is broken: replaying yields a different `quizPassedAt`. For audit-defense, an inspector pulling the practice's records 3 months apart could see different `quizPassedAt` values for the same compounder/year if a backfill ran in between.
- **Fix:** Use `attempt.completedAt` (already set at line 99 / 106 from the projection's first run) as the source of truth, or pass an `occurredAt` field through the event payload (mirrors `IncidentNotificationLogged` pattern). Specifically:
  ```ts
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: { quizAttemptId: attempt.id, quizPassedAt: attempt.completedAt },
  });
  ```
  Same applies to fingertip / media fill projections where `fingertipLastPassedAt` and `mediaFillPassedAt` are set to `new Date()` (lines 161, 183).

### I-7. Hardcoded "USP 797 §21" / "§21.4" / "§21.6" citations across 6+ files
- **Files:** `src/components/gw/Extras/AllergyExtras.tsx:109,257` (`USP 797 §21.4`), `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx:518` (`USP 797 §21`), `:213,491` (`USP §21`), `src/app/(dashboard)/programs/allergy/page.tsx:63` (`USP 797 §21`), `quiz/page.tsx:66` (`USP 797 §21 annual assessment`), `src/lib/notifications/generators.ts:421` (`USP §21 §21.6`), `src/lib/events/registry.ts:67` (comment `USP 797 §21`), `src/lib/events/projections/allergyCompetency.ts:8,65` (USP §21 in comments), `scripts/seed-allergy.ts` lines 28-95 (per-requirement citation strings)
- **Issue:** Mirrors HIPAA I-7 / OSHA I-8. Citation strings duplicated across UI, notifications, comments, and seed data. The seed data IS the canonical source (the `RegulatoryRequirement.citation` field is loaded from `seed-allergy.ts`), but the UI duplicates the citation in plain text rather than reading from the requirement record. When USP §797 publishes an updated revision (which has happened twice in the last 5 years), every UI surface needs a hand-edit to reflect the new section numbering.
- **Why it matters:** Pairs with HIPAA I-7 and OSHA I-8 for a single architectural fix. State boards in different jurisdictions sometimes adopt different USP §797 revisions on different timelines — Texas pharmacy board may still cite the 2019 revision while Kansas adopts 2023. A jurisdiction-aware citation field on `RegulatoryRequirement` would let the same module render different citations per state. Today, hardcoded strings prevent that.
- **Fix:** Same as HIPAA I-7 + OSHA I-8: `src/lib/compliance/citations.ts` exporting `ALLERGY_CITATIONS` map. UI surfaces import from there or read `requirement.citation` from the live DB record. Pairs with the recommended `getCitation(code)` helper in OshaExtras.

### I-8. ARIA gaps on form controls (checkboxes, fieldsets, radio groups)
- **Files:** `EquipmentTab.tsx:131-140` (allItemsPresent checkbox, no `htmlFor`/`id`), `DrillTab.tsx:191` ("Participants *" is a `<p>` not a `<fieldset>`/`<legend>`), `:199-212` (each participant `<label>` wraps `<input>` without `id`/`htmlFor`), `CompetencyTab.tsx:142-160` (RequiredToggle wraps `<input>` in label without `htmlFor`/`id`)
- **Issue:** Mirrors HIPAA I-8 + I-9 / OSHA I-9 + I-10 / Credentials I-9 + I-10:
  - **EquipmentTab "All items present" checkbox** (line 131-140): `<label>` wraps `<input>` (implicit-association). No `id`/`htmlFor`. Works for sighted clicks but screen readers may not announce the label reliably across browsers.
  - **DrillTab participants section** (line 190-219): "Participants *" rendered as a `<p>` (line 191) instead of a `<legend>` inside a `<fieldset>`. WCAG 1.3.1 expects related form controls (the participant checkboxes) to be grouped via `<fieldset><legend>` so screen readers announce "Participants, group, 5 of 8 selected" instead of treating each checkbox as standalone.
  - **DrillTab participant checkboxes** (line 199-212): each `<label>` wraps `<input>` with no `id`/`htmlFor`.
  - **CompetencyTab RequiredToggle** (line 142-160): `<label>` wraps `<input>` with no `id`/`htmlFor`. Has `aria-label="Requires allergy competency"` on the checkbox itself (line 157), which is acceptable but redundant with the surrounding `<span>` — preferred pattern is `id` + `htmlFor`.
  - **QuizRunner radio groups** (line 289-318): GOOD — `role="radiogroup"` and `aria-label={q.questionText}` are present (line 289). Each input has `id={inputId}` and `htmlFor={inputId}`. This is a positive (vs HIPAA I-8 which lacked these). Worth calling out as the reference pattern for the rest of the surface.
- **Why it matters:** WCAG 2.1 AA 1.3.1 (Info and Relationships), 4.1.2 (Name, Role, Value). Screen readers announce un-grouped checkboxes as standalone, hiding the parent semantic ("these checkboxes select participants").
- **Fix:** 
  - EquipmentTab line 131: add `id="all-items-present"`, move to explicit `<label htmlFor="all-items-present">` pattern.
  - DrillTab line 190-219: wrap in `<fieldset>` with `<legend>Participants <span className="text-destructive">*</span></legend>`. Add `id={\`participant-${m.id}\`}` + `htmlFor` on each participant row's label.
  - CompetencyTab line 142-160: add `id={\`require-${practiceUserId}\`}` + `htmlFor`.

### I-9. Tests do not cover cross-tenant isolation, role gates, or the toggle action
- **Files:** All 4 test files in `tests/integration/allergy-*.test.ts`
- **Issue:** Mirrors HIPAA I-10 / Credentials gaps. The 4 integration test files cover positive paths (quiz pass + 3 fingertips + media fill → fully qualified, drill insertion, equipment check insertion, derivation flips). Missing:
  - **No cross-tenant test.** No test creates two practices and verifies that a malicious event payload (per C-1, C-2) is rejected. The C-1 / C-2 vulnerabilities pass the test suite trivially because the suite never asserts cross-tenant isolation.
  - **No role-gate test.** No test of `requireAdmin()` enforcement on the 5 admin actions.
  - **No `toggleStaffAllergyRequirementAction` test.** Coverage gap acknowledged in the inventory (§11). Same for `logCompoundingActivityAction` (no test asserts that it sets `lastCompoundedAt` and triggers `recomputeIsFullyQualified`).
  - **No quiz boundary test (79 vs 80).** See I-5.
  - **No initial-vs-renewal regression with skip-year (I-2).** Today `allergy-competency.test.ts:144-242` only covers the happy-path renewal (qualified prior year → 1 fingertip in current year). Skip-year case is untested.
  - **No inactivity-at-boundary test.** Today the test at line 244-338 sets `lastCompoundedAt` to 213 days ago (way past the 183d threshold). No test at days 182, 183, 184.
  - **No window-boundary tests for 90d / 30d / 365d.** Equipment + drill tests assert "compliant within window" but never assert "GAP at exactly window+1 days."
- **Why it matters:** Test coverage gaps mean the C-1, C-2, C-3, C-4, C-5, I-2, I-5, and I-6 issues all pass the existing CI. Audit-defense expects the test suite to enforce business invariants — today it documents only the happy path.
- **Fix:** Add:
  - `tests/integration/allergy-tenant-isolation.test.ts` — creates 2 practices, asserts that Practice A actor calling each action / projection with Practice B identifiers is refused (post C-1+C-2 fix).
  - `tests/integration/allergy-role-gate.test.ts` — STAFF / MEMBER / VIEWER each call each admin action; assert "Only owners and admins can manage allergy compliance" thrown.
  - `tests/integration/allergy-quiz-boundary.test.ts` — score=79 fails, score=80 passes.
  - Extend `allergy-competency.test.ts` with the skip-year scenario.
  - Extend `allergy-equipment.test.ts` with day-89 / day-91 boundary asserts (needs I-4 first for deterministic `now`).

### I-10. CompetencyTab.tsx is 522 LOC and houses 6 distinct concerns; recommend split
- **File:** `CompetencyTab.tsx` (entire file)
- **Issue:** Mirrors Credentials M-6. Single component file contains: (1) main `CompetencyTab` orchestrator, (2) `AttestDialog` (shared dialog ~70 LOC), (3) `RequiredToggle` (server-action-wired, ~50 LOC), (4) `OverallBadge` (status badge), (5) `MemberRow` (the per-row React component, ~220 LOC including state, handlers, and the per-component grid), (6) helpers (`fmtDate`, `fmtDateLong`, `isInactive`, `SIX_MONTHS_MS` constant). Each of `AttestDialog`, `RequiredToggle`, and `MemberRow` could be its own file (~80, 50, 220 LOC respectively).
- **Why it matters:** Anything touching the file invalidates the bundle for the entire allergy surface. Reviewability suffers — the PR diff for "tweak the inactivity badge" is 200 LOC of context for a 5-LOC change. Tests (`allergy-competency.test.ts`) currently exercise only the action entry-point, not the React state wiring; smaller components would make Vitest+jsdom tests on each form practical. Pair with the `fmtDate` consolidation per I-1.
- **Fix:** Move `AttestDialog`, `RequiredToggle`, `OverallBadge`, `MemberRow` to sibling files in `src/app/(dashboard)/programs/allergy/competency/`. Hoist `fmtDate`, `fmtDateLong`, `isInactive` to `src/lib/allergy/format.ts` (pairs with I-1's recommendation for `formatPracticeDate`). Move `SIX_MONTHS_MS` to the centralized constants file per I-3.

### I-11. AllergyDrill `participantIds: String[]` lacks FK enforcement
- **Files:** `prisma/schema.prisma:1705` (no FK on `participantIds`), `src/lib/events/registry.ts:998` (Zod `participantIds: z.array(z.string().min(1)).min(1)` — no per-id validation), `src/lib/events/projections/allergyDrill.ts:21` (write straight from payload)
- **Issue:** Schema comment at line 1695-1698 acknowledges this: "`participantIds` stores PracticeUser.id values without FK enforcement; resolve names with a separate findMany." But the Zod schema only validates that strings are non-empty — it does NOT validate that each ID resolves to a `PracticeUser` whose `practiceId === args.practiceId`. So:
  - **Cross-tenant participant pollution.** Practice A's owner emits an `ALLERGY_DRILL_LOGGED` event with `participantIds: [<Practice B user cuid>, <random non-existent string>]`. The projection writes the row verbatim (line 21). The drill's "Participants" column on Practice A's UI then shows "Unknown" (DrillTab.tsx:295: `memberMap.get(id) ?? "Unknown"`) for the foreign-practice participant — confusion, not corruption, but the foreign user's id is now persisted in Practice A's audit trail. Pair with C-1.
  - **Stale orphan participants.** A `PracticeUser.removedAt` is `SetNull`-cascade only on direct relations (e.g. `Credential.holderId`); `AllergyDrill.participantIds` is a string array with no FK so a removed user remains as an orphan id in past drills. UI shows "Unknown" — acceptable for audit (the drill genuinely happened), but not flagged distinctly from a typo.
- **Why it matters:** Schema-level data integrity. The participantIds[] array is prone to typos, stale references, and (per C-1) cross-tenant injection. A future "show drills attended by user X" query is harder to write without a join table — and the audit-PDF generator (when one is built per the PDF gap below) will need to filter unknown ids.
- **Fix:** Add a participant-id validation step at the action layer (`logDrillAction:253-279`):
  ```ts
  const validParticipants = await db.practiceUser.findMany({
    where: { id: { in: parsed.participantIds }, practiceId: pu.practiceId },
    select: { id: true },
  });
  if (validParticipants.length !== parsed.participantIds.length) {
    throw new Error("One or more participants not found in this practice");
  }
  ```
  Long term: introduce `AllergyDrillParticipant` join table with `(drillId, practiceUserId)` and `onDelete: Cascade` (preserves drill row when a participant is removed; keeps drill-by-user queries cheap).

## MINOR (11)

### M-1. SKIN_TEST_SUPPLIES enum value is a dead code path
- **Files:** `prisma/schema.prisma:1572` (enum value), `src/lib/events/registry.ts:976` (Zod enum), `src/app/(dashboard)/programs/allergy/actions.ts:203` (Zod enum), `src/lib/events/projections/allergyEquipment.ts:58` (comment "no rederive"), `EquipmentTab.tsx:273-276` (only filters EMERGENCY_KIT and REFRIGERATOR_TEMP — no UI)
- **Issue:** SKIN_TEST_SUPPLIES is a valid `AllergyCheckType` enum value, accepted by the action's Zod schema (line 203), and the projection has explicit handling that "no rederive" runs (line 58). But there is no UI to create one (`EquipmentTab.tsx` only has `EmergencyKitForm` and `RefrigeratorForm`), no derivation rule consumes it, and no notification generator references it. Dead code path that pollutes the schema.
- **Fix:** Either remove SKIN_TEST_SUPPLIES from the enum + Zod (post-launch breaking change), OR add a UI form for it + derivation rule. The latter likely the intent — the inventory mentions skin-test supplies as a future requirement. Tag with a `// TODO(post-launch)` comment marking the gap.

### M-2. `addDays` helper in AllergyExtras uses local-browser time without explicit Z
- **File:** `src/components/gw/Extras/AllergyExtras.tsx:146-155`
- **Issue:** `new Date(dateStr + "T12:00:00")` is parsed in the browser's LOCAL timezone (no Z suffix). The comment "noon avoids DST edge cases" is correct for the offset arithmetic, but the result depends on the user's browser timezone. For a user in Honolulu (HST UTC-10), `new Date("2026-04-29T12:00:00")` is 2026-04-29 22:00 UTC. Then `setDate(...)` and `toLocaleDateString` run in browser local time. For BUD calculations (compute `today + 14 days`), this works correctly because both ends observe the same browser TZ. But subtle: a server-rendered version of this label (e.g. for the audit PDF) would use the server's timezone (UTC on Cloud Run) and produce a different output for the same `dateStr`.
- **Fix:** Document the local-browser-time assumption in the comment. If/when the BUD calculator is server-rendered for PDF or email, switch to explicit timezone-aware date math.

### M-3. `parseInt(durationMinutes, 10)` silently drops content for malformed input
- **File:** `DrillTab.tsx:113`
- **Issue:** `parseInt("3.5e10", 10)` returns 3 (drops "5e10"), `parseInt("3 minutes", 10)` returns 3, `parseInt("not a number", 10)` returns NaN. The Zod schema (`actions.ts:247`) catches NaN via `z.number().int().min(0).nullable().optional()`, but a fractional input like "3.5e10" passes as 3 — silently truncated.
- **Fix:** Use `Number.parseInt` (explicit), or better `Number.isFinite(Number(durationMinutes)) && ...` followed by `Math.round`. Tighten the form's `<input type="number" min="0" max="240">` to bound the field at the input layer.

### M-4. CompetencyTab `ftLabel` ladder is verbose
- **File:** `CompetencyTab.tsx:251-258`
- **Issue:** The fingertip count label uses a nested ternary chain:
  ```ts
  const ftLabel = ftCount === 0 ? "0 of 3" : ftCount === 1 ? "1 of 3" : ftCount === 2 ? "2 of 3" : `${Math.min(ftCount, 3)} of 3`;
  ```
  All four branches reduce to `${Math.min(ftCount, 3)} of 3`. Dead branches.
- **Fix:** `const ftLabel = \`${Math.min(ftCount, 3)} of 3\`;`. Saves 6 lines.

### M-5. `OverallBadge` "In progress" label is misleading at 100% complete
- **File:** `CompetencyTab.tsx:181-196`
- **Issue:** If a compounder's `isFullyQualified` is `false` but `quizPassedAt` is set, `fingertipPassCount === 3`, AND `mediaFillPassedAt` is set (i.e. the qualifier flipped false due to inactivity per the 6-month rule at line 70 of `allergyCompetency.ts`), the badge falls through to `anyDone=true` → "In progress" (line 187-189). But the compounder isn't "in progress" — they're fully qualified except for inactivity. The "Inactive >6mo · re-eval required" badge IS rendered separately at line 382-385 — but the "In progress" badge at the top of the row is misleading.
- **Fix:** Add a 4th badge state: when `!isFullyQualified` AND `quizPassedAt && fingertipPassCount >= 3 && mediaFillPassedAt`, render "Re-eval required" or "Inactive" directly instead of "In progress."

### M-6. `actions.ts:174` `score = total === 0 ? 0 : ...` allows pass with 0 questions
- **File:** `actions.ts:173-175`
- **Issue:** When `total === 0` (caller submits empty answers array), `score = 0`, `passed = score >= 80 = false`. So a 0-question quiz fails. OK in this case. BUT the projection at `allergyCompetency.ts:128` only sets `quizPassedAt` if `payload.passed`, so a 0-question quiz doesn't pollute the row. The Zod schema at `registry.ts:933` allows `totalQuestions: z.number().int().min(1)` — but nothing prevents the action from submitting `answers: []` (length 0) which would yield a 0-of-0 attempt. The action should reject 0-length answers BEFORE scoring.
- **Fix:** Add `if (parsed.answers.length === 0) throw new Error("No answers submitted");` at line 161, OR change the Zod to `z.array(...).min(1)`. Pairs with I-5.

### M-7. Equipment + drill PDFs not implemented (audit-trail gap)
- **Files:** N/A (no allergy register PDF exists)
- **Issue:** HIPAA has the SRA register PDF + breach memo PDF, OSHA has Form 300 + 301 PDFs, Credentials has the credentials register PDF. ALLERGY has zero audit PDFs. Inspector arrives, asks "show me your USP §21 register" → the operator has only a UI that requires Chrome to navigate. No PDF deliverable that the practice can hand over, attach to an inspection response, or print for offline records.
- **Fix:** Out-of-scope for this audit but should be added to feature recovery. Recommended PDFs: ALLERGY_REGISTER (per-staff competency table + 12-month equipment log + drill log), ALLERGY_COMPOUNDING_LOG (per-staff `lastCompoundedAt` history once C-5 lands and events exist).

### M-8. `submitQuizAttemptAction` does not record the user-agent / IP for fraud trail
- **File:** `actions.ts:154-200`
- **Issue:** The quiz attempt record (`AllergyQuizAttempt` schema lines 1631-1650) captures `practiceId`, `practiceUserId`, `year`, `score`, `passed` — but no fraud-detection signals: time-to-complete (only `startedAt` + `completedAt` on the attempt model, neither populated by the projection), IP address, user-agent, answer change patterns. Pair with C-3 — once the answer-key bypass is fixed, the next mitigation layer would be detecting unusually fast completion times (full quiz in 30 seconds suggests answer key still leaking somehow).
- **Fix:** Out-of-scope for this audit, but worth tagging. The projection at `allergyCompetency.ts:99` sets `completedAt: new Date()` but does not record `startedAt` (which must come from the page-render time, not the action call time). To enable later fraud detection, capture both timestamps + the request headers via Next.js request context.

### M-9. `recomputeIsFullyQualified` re-runs `findUniqueOrThrow` then a `findFirst` — could be one query
- **File:** `src/lib/events/projections/allergyCompetency.ts:48-83`
- **Issue:** Three sequential queries: (1) line 52 `findUniqueOrThrow` for the competency row, (2) line 55 `findFirst` for any prior qualified year, (3) line 79 `update` (only if state changed). For a hot path called after every quiz/fingertip/media fill projection, three round-trips is one too many.
- **Fix:** Use `findUniqueOrThrow` with `include: { practiceUser: { include: { allergyCompetencies: { where: { year: { lt: c.year }, isFullyQualified: true } } } } }` to fetch both in one trip. Or accept a `priorQualified: boolean` arg passed in by the caller (the call site knows the year). Performance tuning, not correctness.

### M-10. `EquipmentTab.tsx:191` uses `parseFloat` then range-checks; should use Zod-side validation
- **File:** `EquipmentTab.tsx:191-216`
- **Issue:** Client-side: `parseFloat(temperatureC)` then `inRange = !isNaN(tempNum) ? tempNum >= 2 && tempNum <= 8 : null;`. Submitted via `temperatureC: tempNum, inRange: inRange ?? false` (line 205-206). Server-side Zod at `actions.ts:208` validates `z.number().min(-20).max(40)`. So a value like `100` gets caught at the server. But the client-side `inRange` is `false` (out of range, computed at line 192), and the server doesn't recompute it — it trusts the client's `inRange` boolean. A malicious or buggy client can submit `temperatureC: 100, inRange: true` and the server stores `inRange=true` despite the temperature being clearly out of the 2-8°C range. The derivation rule at `allergy.ts:77-79` reads `inRange` as truth.
- **Fix:** Recompute `inRange` server-side in the projection or action: `const inRange = parsed.temperatureC !== null && parsed.temperatureC !== undefined && parsed.temperatureC >= 2 && parsed.temperatureC <= 8;` and ignore the client's `inRange` field. Or constrain the Zod: `temperatureC: z.number().min(-20).max(40)` paired with a `.refine()` that requires the relationship between the temperature and `inRange` to be consistent.

### M-11. `dateOnlyString` Zod regex tolerates impossible dates like 2026-13-32
- **File:** `actions.ts:24-26`
- **Issue:** `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. The regex matches "2026-13-32" or "2026-02-30" — strings that look like dates but aren't real. The downstream `new Date(parsed.epiExpiryDate)` then yields an Invalid Date or wraps around (`new Date("2026-13-01")` = 2027-01-01 in some implementations). The Zod `.datetime()` for fully-qualified ISO datetimes (`registry.ts:980`) is strict, but the action-side `dateOnlyString` is lax.
- **Fix:** Use Zod's `.refine()` to verify the parsed Date is valid:
  ```ts
  const dateOnlyString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "...").refine(
    (s) => !Number.isNaN(new Date(s + "T00:00:00Z").getTime()) && s === new Date(s + "T00:00:00Z").toISOString().slice(0, 10),
    "Not a valid calendar date",
  );
  ```

## Top 5 fix-up priorities

1. **C-3 (quiz answer-key in client payload)** — ~30 LOC change in `quiz/page.tsx` (strip `correctId`/`explanation` from serialized output) + ~50 LOC for a new `getQuizReviewAction(attemptId)` that returns the correct answers AFTER submission. Single most consequential design flaw — invalidates the trust boundary of the entire competency surface. Highest impact-per-LOC by far. Pair with optional C-3 mitigation #2 (lock attemptId via `ALLERGY_QUIZ_STARTED` event).
2. **C-1 (cross-tenant guard on all 5 allergy projections)** — ~40 LOC across `allergyCompetency.ts`, `allergyEquipment.ts`, `allergyDrill.ts`. Mirrors the `sraDraftSaved.ts:52` guard; protects against future code paths bypassing action-layer validation. Pairs with the credentials C-1 architectural pattern.
3. **C-2 (per-target tenant check on `attestFingertipTestAction` + `attestMediaFillTestAction`)** — ~10 LOC of `target.practiceId !== pu.practiceId` lookups. Closes the most direct exploitation path of C-1.
4. **C-5 (`logCompoundingActivityAction` + `toggleStaffAllergyRequirementAction` need event-sourcing)** — ~80 LOC for a new `ALLERGY_COMPOUNDING_LOGGED` event + projection migration + lint-rule allowlist update. Restores ADR-0001's architectural invariant on the allergy surface AND adds the audit trail for inactivity-rule evidence.
5. **I-1 + (HIPAA I-1 + OSHA I-1/I-4 + Credentials I-1 — combined architectural fix)** — `practice.timezone` field + `formatPracticeDate(date, tz)` helper. One Prisma migration + one shared helper unblocks date correctness across HIPAA, OSHA, Credentials, and Allergy surfaces. The year-boundary attestation drift (§I-1 example) is the most consequential allergy-specific manifestation.

## Sampling caveats

- All 8 files in `src/app/(dashboard)/programs/allergy/` read fully (page, AllergyDashboard, CompetencyTab, EquipmentTab, DrillTab, QuizRunner, quiz/page, actions).
- All 3 allergy projection files read fully (`allergyCompetency.ts`, `allergyEquipment.ts`, `allergyDrill.ts`); cross-checked against `sraDraftSaved.ts` for the cross-tenant guard reference.
- `src/lib/compliance/derivation/allergy.ts` (the 4 model-driven rules) read fully.
- `src/lib/events/registry.ts`: only the 5 ALLERGY_* event schemas read in detail.
- `src/lib/notifications/generators.ts`: only `generateAllergyNotifications` (lines 354-482) and `generateAllergyCompetencyDueNotifications` (lines 484-540) read in detail.
- `src/lib/events/append.ts` read fully to confirm transaction semantics.
- `src/components/gw/Extras/AllergyExtras.tsx` read fully (BUD reference + vial label generator).
- All 4 integration tests read fully (`allergy-competency`, `allergy-equipment`, `allergy-drill`, `allergy-derivation`).
- `prisma/schema.prisma`: the 7 ALLERGY models (lines 1569-1716) + cross-references (e.g. PracticeUser.requiresAllergyCompetency) read in detail.
- `eslint-rules/no-direct-projection-mutation.js` read fully to confirm the lint blind-spot.
- `scripts/seed-allergy.ts` read partially (lines 1-80; remainder skipped — assumed reference-data only).
- A11y: visual JSX inspect only; no axe/VoiceOver run.
- Cross-cutting: no execution trace through Concierge tools / state-overlay / audit-PDF — none of those exist for ALLERGY today (M-7).
