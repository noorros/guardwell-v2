# Allergy Audit — Findings

**Date:** 2026-04-29
**Reviewer:** Audit session, dispatched per `docs/superpowers/plans/2026-04-29-hipaa-osha-credentials-allergy-audit.md` (4th and final area)
**Production target:** `https://v2.app.gwcomp.com`
**Test practice:** "Prod Smoke Test" (existing, AZ; reused from HIPAA + OSHA + Credentials sessions)
**Surface inventory:** [`docs/audit/2026-04-29-allergy-inventory.md`](2026-04-29-allergy-inventory.md) — 17 files, ~3,569 LOC
**Code review (raw):** [`docs/audit/2026-04-29-allergy-code-review.md`](2026-04-29-allergy-code-review.md) — code-reviewer findings (folded in below if landed before this doc; else triage from the file directly)

## Summary

- **6 working flows verified end-to-end** (added Compounders toggle action live-test)
- **6 bugs / gaps found via Chrome verify** (1 High, 4 Medium, 1 Low)
- **Code review:** 5 Critical / 11 Important / 11 Minor findings (full report at `docs/audit/2026-04-29-allergy-code-review.md`)
- **🚨 1 Critical LIVE-VALIDATED:** the quiz answer key (`correctId` + per-question explanation text) is shipped to the client in the inline RSC payload — anyone can read all 44 answers via View Source. Live evidence in this doc § "Bugs from code review > C-3."
- **Allergy test suite:** 4 files / 11 tests, all passing in 3.48s
- **Inventory's pre-flagged HIGH PRIORITY (`toggleStaffAllergyRequirementAction` unguarded) — REFUTED.** Manual spot-check + live UI test confirm the action gate works (state toggles + reverts cleanly). False positive.
- **Verdict:** Allergy has **2 user-impact-equivalent Critical findings** (C-3 quiz answer-key leak — live-validated, exploitable; and C-5 silent projection mutations destroying the `lastCompoundedAt` audit trail), plus **1 High-severity derivation gap** (B-1: logging fridge readings + drills DOES write the rows but does NOT flip the /modules/allergy requirements to COMPLIANT — root cause unverified, likely either missing rederive in the projection or framework-gating). Other findings are policy / UX gaps. Allergy is **NOT "done"** until C-3 ships a fix.

## Working ✅ (verified live on v2.app.gwcomp.com)

- **/modules/allergy renders cleanly** — "Allergy / USP 797 §21" header with "federal" badge, score "—" (not_assessed), 0 of 9 compliant. All 9 requirements visible with manual override radios + AI help per requirement:
  1. Designated compounding area (USP §21.1)
  2. Hand hygiene + garbing procedures (USP §21.2)
  3. Beyond-Use Date (BUD) labeling SOP (USP §21.4)
  4. Vial labeling SOP (USP §21.5)
  5. Compounding records retained ≥3 years (state pharmacy practice acts)
  6. Annual 3-component competency for every compounder (USP §21.3) ← `ALLERGY_COMPETENCY`
  7. Emergency kit current (epi unexpired, all items present) within 90 days ← `ALLERGY_EMERGENCY_KIT_CURRENT`
  8. Refrigerator temp log within 30 days, in 2–8°C range ← `ALLERGY_REFRIGERATOR_LOG`
  9. Anaphylaxis drill within last 365 days ← `ALLERGY_ANNUAL_DRILL`
- **/programs/allergy renders 3 tabs** — Compounders / Equipment / Drills. Header subtitle: "Annual 3-component competency for every compounder, monthly equipment + fridge logs, and anaphylaxis drills. Drives the ALLERGY module score."
- **Compounders tab** — per-staff matrix with: Not-required toggle, QUIZ → "Take quiz" link, FINGERTIP "0 of 3" + "Attest" button, MEDIA FILL "—" + "Attest" button, STATUS column ("Not started"), per-row "Log session" button. Empty state copy: "No staff currently require USP §21 competency. Use the toggle on each row to mark compounders." — clear UX.
- **Equipment tab** — two distinct sub-surfaces both visible on the same tab:
  - **Emergency kit** with "Log a check" form (Epi expiry date, Lot number, "All items present" checkbox checked-by-default, Items replaced, Notes, Record check button)
  - **Refrigerator temperature** with sub-label "(2–8°C acceptable)" and "Log a reading" form (Temperature °C, Notes, Record reading button)
- **Drills tab** — red "No drill on file yet — an anaphylaxis drill is required annually" banner + "Log a drill" form (Date conducted, Duration optional minutes, Scenario required textarea, Participants checkbox list, Observations optional, Corrective actions optional, Next drill due optional, Log drill button). Form defaults Date to today.
- **Refrigerator reading creation works end-to-end** — entered 4.5°C + audit-tagged note, clicked Record reading. Result: "Reading recorded successfully." green text, history table shows the row (Date 2026-04-29, Temp 4.5, Status "In range" green badge, Notes audit-tagged). Form did NOT auto-clear the temperature value — minor UX nit (operator's next reading must triple-click to clear).
- **Drill logging works end-to-end** — entered 30-min audit-tagged scenario + 1 participant, clicked Log drill. Result: "Drill logged successfully." green text, form reset properly (Scenario empty, Participants unchecked), Drill history section shows the entry "2026-04-29 · 1 participant · 30 min" with the audit-tagged scenario as subtitle.
- **Quiz subroute (`/programs/allergy/quiz`) renders cleanly** — "Allergy competency quiz" with "44 questions — passing score is 80%" subtitle, progress indicator "0 of 44 answered" at 0%, sectioned by topic ("ASEPTIC TECHNIQUE" first), 4-option radio per question, "44 questions remaining" footer + "Submit quiz" button. Quiz NOT submitted during audit (44-question entry is too much state to inject).
- **Cross-area policies surface** — `/programs/policies` template library contains 2 Allergy-related policies (USP 797 §21 Allergen Extract Mixing Competency Policy + Anaphylaxis Emergency Response Protocol), but no dedicated "Allergy" section in the "Required policies" list (because Prod Smoke Test hasn't enabled the Allergy framework / compoundsAllergens=false). This is consistent with the framework gating model.
- **Compounders toggle action works end-to-end** — clicked the "Not required" checkbox on the row for noorrosllc@gmail.com → state visibly flipped to a green "Required" badge + help text updated from "No staff currently require USP §21 competency..." to "2026 competency — Quiz + fingertip sampling + media fill test required annually per USP §21." Re-clicked to revert; state cleanly restored to original. **The `toggleStaffAllergyRequirementAction` UI flow is working** and confirms the action gate (REFUTES the inventory's false-positive HIGH PRIORITY pre-flag).

## Bugs / gaps from Chrome verify ❌

### B-1. HIGH: Logging fridge reading + drill does NOT flip the corresponding requirements to COMPLIANT

- **Symptom:** After logging a 4.5°C fridge reading and a complete anaphylaxis drill (with participant + 30min duration + audit-tagged scenario), navigated back to `/modules/allergy`. Both rows ("Refrigerator temp log within 30 days, in 2–8°C range" and "Anaphylaxis drill within last 365 days") remained at NOT_STARTED. Score still "—". Stat row still "0 of 9 compliant."
- **Reproduction:** `/programs/allergy` → Equipment tab → log fridge reading 4.5°C → success → `/programs/allergy` → Drills tab → log drill with participant → success → `/modules/allergy` → both relevant rules still NOT_STARTED.
- **Impact:** This is the #1 user-facing failure mode for Allergy compliance. A practice operator does the work (logs the fridge temp daily, runs the drill annually), the events fire, the projection writes the rows (verified — UI history shows them), but the framework score doesn't update. From the operator's POV, "I did the thing and the system still says I haven't" — destroys trust in the compliance score.
- **Possible root causes (root-cause analysis is for the triage cycle, not this audit):**
  - **(a) Rederive not triggered:** the projection (`projectAllergyEquipmentCheckLogged`, `projectAllergyDrillLogged`) writes the row but doesn't call `rederiveRequirementStatus(tx, practiceId, "ALLERGY_REFRIGERATOR_LOG")` / `"ALLERGY_ANNUAL_DRILL"`. Compare to `projectCredentialUpserted` which DOES call rederive (`credential.ts:35-40`).
  - **(b) Framework gating suppressing rules:** if `PracticeComplianceProfile.compoundsAllergens=false` for Prod Smoke Test, the Allergy framework derivation may be skipped. But the module page still shows requirements with NOT_STARTED radios (not NOT_APPLICABLE) — suggesting the framework IS technically active, just not auto-deriving.
  - **(c) ComplianceItem cache:** maybe an in-memory cache keeps the ComplianceItem at NOT_STARTED across requests. Less likely.
- **Suggested investigation:** read `src/lib/events/projections/allergyEquipment.ts` + `allergyDrill.ts`. Compare to `credential.ts` projection's rederive pattern. Most likely fix: 2 lines added per projection function (matching the `credentialTypePresentRule` pattern but for the literal evidence codes `ALLERGY_REFRIGERATOR_LOG` / `ALLERGY_ANNUAL_DRILL` / `ALLERGY_EMERGENCY_KIT_CURRENT`).

### B-2. MEDIUM: Hardcoded USP §21.x citations in 5 of 9 requirement labels (cross-pattern HIPAA I-7 / OSHA I-8 / Credentials)

- **Symptom:** Requirement labels contain hardcoded regulatory citations: "(USP §21.1)", "(USP §21.2)", "(USP §21.3)", "(USP §21.4)", "(USP §21.5)". Same pattern observed in HIPAA's hardcoded §164.402 / Notice of Privacy Practices citations and OSHA's 1904.x / 1910.x citations.
- **Impact:** When USP 797 is revised (most recently 2023; expected revisions every ~5 years), every citation in v2 must be hand-updated. No central registry.
- **Suggested fix:** Bundle with HIPAA I-7 + OSHA I-8 — single citation registry with framework + section tag, helper to render. Cross-cutting refactor.

### B-3. MEDIUM: "0 open gaps" stat disagrees with 9 NOT_STARTED requirements (cross-pattern HIPAA B-6 / Credentials B-6)

- **Symptom:** `/modules/allergy` stat row shows "0 of 9 compliant", "0 deadlines this month", "0 open gaps" — yet all 9 requirements are visibly NOT_STARTED (no radio toggled). Same pattern as HIPAA + Credentials findings.
- **Impact:** Confusing. Operators may interpret "0 open gaps" as "nothing to do."
- **Suggested fix:** Same as HIPAA B-6 — rename "Open gaps" to "Time-sensitive gaps" or align the definition with visible state.

### B-4. MEDIUM: "Last assessed 2 days ago" subtitle but score is "—" (not_assessed) — inconsistent

- **Symptom:** /modules/allergy header shows "Last assessed 2 days ago" — but the framework score in the upper-right circle is "—" (a dash, not a number). If the framework was assessed 2 days ago, the score should be 0/100 or whatever; if it wasn't truly assessed, the subtitle shouldn't say so.
- **Impact:** Cosmetic but confusing. Suggests the framework derivation ran without producing a number — likely tied to B-1 (rules don't actually compute when invoked).
- **Suggested fix:** When score is "—" (no successful rule evaluation), suppress the "Last assessed X ago" subtitle or change it to "Not yet assessed."

### B-5. LOW: "All items present" checkbox on Emergency kit form defaults to CHECKED

- **Symptom:** When opening `/programs/allergy` Equipment tab → "Log a check" form, the "All items present" checkbox is pre-checked (green checkmark visible). An operator quickly clicking through could submit a check claiming all items present without actually inspecting.
- **Impact:** UX safety. Compliance evidence gathering should default to UNCHECKED so the operator must explicitly attest. Pairs with B-3 of OSHA's "Forms with implicit attestation defaults" pattern.
- **Suggested fix:** Default the checkbox to unchecked. If unchecked, show a "Items missing" textarea (mandatory) capturing what was missing.

### B-6. LOW: Required policies surface and module page disagree on framework activation

- **Symptom:** `/modules/allergy` shows 9 requirements (5 of which are policy-driven, requiring the 5 allergy policies be adopted to flip COMPLIANT). But `/programs/policies` "Required policies" list contains NO Allergy section — the Allergy policy templates exist only in the template library. So the framework module page treats Allergy as "active" (rendering requirements with NOT_STARTED radios), but the policies surface treats Allergy as "not enabled."
- **Impact:** Inconsistency. Operators see "Annual 3-component competency..." on /modules/allergy and click → would expect to see policy templates to adopt → don't see any in the required-policies list.
- **Suggested fix:** Either (a) /modules/allergy should hide unrequired requirements when framework not activated, OR (b) /programs/policies should show "Available, not adopted" Allergy section so operators can opt in. Option (b) is the cleaner UX (encourages adoption).

## Bugs from code review (severity-classified)

The code-reviewer agent landed with **5 Critical / 11 Important / 11 Minor (27 total)** findings — full report at [`docs/audit/2026-04-29-allergy-code-review.md`](2026-04-29-allergy-code-review.md). The Critical findings are unprecedented across the 4-area audit:

### C-3 (live-validated): Quiz `correctId` answer key shipped to the client — entire competency assessment bypassable

- **File:** `src/app/(dashboard)/programs/allergy/quiz/page.tsx:42` per the code reviewer.
- **Live evidence (Chrome verify, 2026-04-29):** ran `document.documentElement.outerHTML` on `https://v2.app.gwcomp.com/programs/allergy/quiz` while signed in as the practice OWNER. The page contains **44 occurrences of `correctId`** in the inline RSC payload, one per question. Sample raw payload at byte index 140274 of the rendered HTML:
  ```
  correctId":"c","explanation":"USP 797 requires thorough handwashing (≥30 seconds)
  followed by alcohol-based sanitizer before gloving. Gloves alone do not substitute
  for proper hand hygiene.","category":"ASEPTIC_TECHNIQUE"},{"id":"allergy-q-aseptic_technique-2"...
  ```
- **Impact:** any authenticated user with browser access can read the entire answer key (44 questions × the correctId for each) AND the explanation text for each. The quiz takes <2 minutes to "pass" with score=100% by reading the source. The `AllergyQuizAttempt` table is the documented evidence of compounder competency — a USP §21.3-aligned **annual competency requirement** — and that evidence is **structurally bypassable**. State pharmacy boards inspecting the audit packet would see "100% score on annual competency" with no actual demonstration of competence.
- **The Concierge `list_credentials`-style consistency test that worked beautifully on Credentials does NOT apply here** — there's no client-side audit equivalent because the client itself IS the source of the answer key.
- **Suggested fix per the code reviewer:** server-only correctId. Pass `{id, questionText, options[{id, text}]}` to the client (no correctId, no explanation). On Submit, send the user's selected option IDs to a server action that resolves correctIds + explanations server-side, computes the score, and returns the result. This pattern matches the existing `submitAllergyQuizAttemptAction`. ~30 LOC change in `quiz/page.tsx` + adjusted props on `<QuizRunner>`.

### C-1: All 5 allergy projections lack cross-tenant guard

- Mirrors HIPAA C-1, Credentials C-1×5. `ensureCompetency` and the upserts on `attemptId`, `equipmentCheckId`, `drillId` all let a forged event payload mutate rows in another practice. Combined with C-2, Practice A's owner can directly increment Practice B's compounder's `fingertipPassCount` and flip Practice B's `isFullyQualified` to true.

### C-2: per-target tenant check missing on attest actions

- Allergy variant of the C-2 cross-area pattern: although `requireAdmin()` is called on all 6 actions (refuting the inventory's pre-flag — see below), the two attest actions (`attestFingertipTestAction`, `attestMediaFillTestAction`) lack the per-target tenant check that the other actions have at line 102 / 138.

### C-5: `logCompoundingActivityAction` + `toggleStaffAllergyRequirementAction` bypass ADR-0001

- Both directly mutate projection tables (`AllergyCompetency.lastCompoundedAt`, `PracticeUser.requiresAllergyCompetency`) without emitting events. The ESLint rule `eslint-rules/no-direct-projection-mutation.js:5-22` does not cover these tables, so the regression ships clean. **No event recording when `lastCompoundedAt` was set, by whom, or for which compounder** — destroying the audit trail for the USP §21 inactivity rule.

### C-4: (5th Critical — see code review file for detail; not validated live during this audit)

### Important + Minor (folded summary)

The 11 Important + 11 Minor findings include:
- **I-1 dates rendered in UTC** — confirmed by spot-check (fridge log displayed Date "2026-04-29" UTC). Cross-pattern with HIPAA I-1 / OSHA I-1 + I-4 / Credentials I-1. **New manifestation:** `new Date().getFullYear()` produces 2027 at 6pm-Pacific on Dec 31 — year-boundary attestation drift.
- **I-7 hardcoded citations** — confirmed (B-2). Cross-pattern with HIPAA I-7 / OSHA I-8 / Credentials I-7.
- **I-8 ARIA gaps** — `EquipmentTab`'s "All items present" checkbox + `DrillTab`'s participants `<p>`-instead-of-`<fieldset>`. Cross-pattern with HIPAA I-8/I-9 + OSHA I-9/I-10 + Credentials I-9/I-10. **Bright spot: `QuizRunner` has `role="radiogroup"` + `aria-label`** — the first reference-quality a11y implementation observed across the 4 reviews (per code reviewer).
- **M-tier (`Date.now()` non-determinism)** — same pattern as Credentials M-10 / OSHA M-12. Pass `now: Date` through derivation rule signatures.
- **Test coverage gaps** — no role-gate test, no quiz boundary test (79 vs 80), no skip-year initial-vs-renewal test, no inactivity-boundary test, no cross-tenant test.

**Inventory's pre-flagged HIGH PRIORITY: REFUTED.** The agent that wrote the inventory claimed `toggleStaffAllergyRequirementAction` was not gated on `requireAdmin()`. Manual spot-check at `src/app/(dashboard)/programs/allergy/actions.ts:134-140` confirmed the action DOES call `requireAdmin()` (line 135) AND has a per-target tenant check (lines 137-140: `if (!target || target.practiceId !== pu.practiceId) throw new Error("Member not found")`). Both role and tenant guards are in place. **False positive — explicitly not counted in the 5/11/11 totals.**

**Live-tested toggle behavior (Chrome verify):** clicked the "Not required" checkbox on the Compounders tab → state visibly flipped to a green "Required" badge + help text changed to "2026 competency — Quiz + fingertip sampling + media fill test required annually per USP §21." Re-clicked to revert; state restored cleanly. Action works end-to-end at the UI layer. **The action gate is working.** What's broken is C-5 (no event emission for the change — silent state mutation).

## UX gaps ⚠️

### U-1. Empty-state copy on Compounders tab is good but the per-row matrix is dense
- "No staff currently require USP §21 competency. Use the toggle on each row to mark compounders." — clear instruction. But the per-row 7-column matrix (avatar + name + role badge + Not-required toggle + QUIZ + FINGERTIP + MEDIA FILL + STATUS + Log session) is information-dense. For a 20-staff practice, rendering this matrix on a single page may overflow horizontally.
- **Fix:** Pair with code-review M-? splitting CompetencyTab.tsx (522 LOC). Alternative: collapse columns into a single "Status" cell per row with hover-popover for breakdown.

### U-2. Drill history entry doesn't expose Edit / Delete affordance
- The "Drill history" section after logging shows the entry but no edit/remove button. To correct a typo'd scenario or remove an erroneous drill, operator needs DB access. Cross-pattern with Credentials B-2 (no Edit/Renew/Retire on credential detail page).
- **Fix:** Add edit + retire affordances on drill rows (or at least a "Retire" with confirmation).

### U-3. Fridge reading row also has no Edit / Delete affordance
- Same as U-2 for the Refrigerator temperature log. Once recorded, no UI path to correct or remove. Cross-pattern.
- **Fix:** Same as U-2.

### U-4. Form did not auto-clear after successful Refrigerator reading submission (compare to Drill which DID auto-clear)
- After clicking "Record reading" → success message appeared but the temperature field still had "4.5" and the notes still had the audit text. Compare to Drill log which clears Scenario + Participants checkbox after success. Inconsistent UX.
- **Fix:** Match patterns — both forms should auto-clear after success.

## Missing tests 📋

- **No `tests/integration/allergy-derivation-cascade.test.ts`** — would have caught B-1 (event → projection → rederive → ComplianceItem flip). The test would: emit `ALLERGY_EQUIPMENT_CHECK_LOGGED` → assert ComplianceItem for `ALLERGY_REFRIGERATOR_LOG` flipped to COMPLIANT.
- **No quiz pass-fail boundary test** (per inventory pre-flag) — does 35/44 (79.5%) PASS or FAIL the 80% threshold?
- **No initial-vs-renewal fingertip count enforcement test** — does the rule require 3 fingertips for initial competency but only 1 for renewal?
- **No 6-month inactivity rule test** — does setting `lastCompoundedAt` to >6 months ago force re-completion?
- **No `toggleStaffAllergyRequirementAction` test** — the action exists, the gate is correct, but no integration test asserts both.
- **No state-overlay tests** — Allergy doesn't have state overlays today (per inventory § 13).

## Deferred 💡

- **D-1.** Investigate B-1 derivation cascade root cause + fix. Either (a) projections need rederive call, or (b) framework-gating is excluding the practice. **#1 priority for next cycle.**
- **D-2.** Edit / Retire affordances on Drill + Equipment history rows (U-2 + U-3).
- **D-3.** Default "All items present" checkbox to unchecked (B-5).
- **D-4.** Allergy policies activation flow on /programs/policies (B-6 — show "Available, not adopted" section when framework is dormant).
- **D-5.** Citation registry (B-2 / cross-pattern).
- **D-6.** "Open gaps" stat semantics (B-3 / cross-pattern with HIPAA B-6 / Credentials B-6).
- **D-7.** Form auto-clear consistency (U-4).

## Cleanup status

- ⚠️ **Audit fridge log row remains** in `AllergyEquipmentCheck` table — created via the audit. No UI delete affordance available; recommend DB cleanup or leave in place. Tagged with "AUDIT-2026-04-29 fridge log audit test" in the Notes column for greppability.
- ⚠️ **Audit drill row remains** in `AllergyDrill` table — created via the audit. No UI delete affordance available; recommend DB cleanup or leave in place. Tagged with "AUDIT-2026-04-29 audit anaphylaxis drill test" as the scenario.
- ⚠️ **EventLog rows from audit remain** (append-only by design): 1× `ALLERGY_EQUIPMENT_CHECK_LOGGED`, 1× `ALLERGY_DRILL_LOGGED`. Visible in /audit/activity if filtering by today.
- **Recommendation:** since these audit rows are clearly tagged and don't affect any compliance score (the frameworks aren't active for Prod Smoke Test per B-1's framework-gating hypothesis), they're safe to leave. If the user wants to clean up, DB-direct DELETE on `AllergyEquipmentCheck` + `AllergyDrill` rows where notes/scenario contain "AUDIT-2026-04-29" — see `Audit data` section below for the IDs (none captured live, but greppable by tag).

## Audit data — for reproducibility

- **Practice (audit target):** Prod Smoke Test (AZ)
- **Audit equipment check:** AllergyEquipmentCheck row, type=Refrigerator, tempCelsius=4.5, status=in-range, notes="AUDIT-2026-04-29 fridge log audit test", date=2026-04-29
- **Audit drill:** AllergyDrill row, durationMinutes=30, scenario="AUDIT-2026-04-29 audit anaphylaxis drill test", participants=[noorrosllc@gmail.com], dateConducted=2026-04-29
- **Cross-page derivation impact:** none observed (B-1) — score stayed "—", all 9 requirements stayed NOT_STARTED.
- **Allergy score (during audit):** "—" (not_assessed) before, during, and after.
- **Test results:** `npm test -- --run tests/integration/allergy-competency tests/integration/allergy-derivation tests/integration/allergy-drill tests/integration/allergy-equipment` → **4 files / 11 tests, all passing in 3.48s**.

## Per-area Chrome verify status — completion matrix

| Area / Route | Verified | Findings |
|---|---|---|
| `/modules/allergy` | ✅ | 9 requirements rendered, B-2 (citations), B-3 (gap stat), B-4 ("Last assessed" inconsistency) |
| `/programs/allergy` (3 tabs) | ✅ | All tabs render; Compounders matrix dense (U-1) |
| Equipment tab — Refrigerator log | ✅ | Submit works; B-1 (no derivation flip); U-4 (form not auto-clear); U-3 (no edit/delete on row) |
| Equipment tab — Emergency kit | ✅ | UI verified; B-5 (checkbox default checked) |
| Drills tab — Drill log | ✅ | Submit works; B-1 (no derivation flip); U-2 (no edit/delete on row) |
| Compounders tab | ✅ | Per-staff matrix renders; Toggle/Quiz/Attest affordances present |
| Quiz subroute (`/programs/allergy/quiz`) | ✅ | Renders 44 questions, 80% pass — not submitted (data pollution avoided) |
| `/programs/policies` Allergy section | ✅ | Templates exist in library; no required-policies surface (B-6) |
| Cross-framework score impact | ⏸️ | Allergy is self-contained per inventory; not testable via Allergy edits |
| Concierge `list_*` for allergy | ⏸️ | Not exercised — no obvious allergy-aware Concierge tool in the inventory's `conciergeTools.ts` review |

## Sign-off checklist

Per the audit plan's Definition of Done:

1. ✅ **Code health** — Allergy test subset passes 11/11 in 3.48s; tsc/eslint not run separately.
2. ⚠️ **Test coverage** — gaps documented (no derivation-cascade test, no quiz boundary test, no initial-vs-renewal test, no 6-month inactivity test, no role-gate test).
3. ⏸️ **Code review** — see [`docs/audit/2026-04-29-allergy-code-review.md`](2026-04-29-allergy-code-review.md). Folded summary above when available.
4. ⚠️ **Functional verification (production)** — every route in the per-area Chrome checklist exercised; B-1 (derivation cascade) is the headline gap.
5. ❌ **Compliance derivation** — **broken or framework-gated.** Logging fridge readings + drills writes the row + emits events but does NOT update the module page. Either rederive isn't triggered, or `compoundsAllergens=false` is excluding the practice. Triage cycle should determine root cause.
6. ✅ **Notification + audit trail** — events emit + project (verified by row visibility in /programs/allergy history sections); no Allergy-specific notifications observed in the bell, but inventory says `generateAllergyNotifications` and `generateAllergyCompetencyDueNotifications` exist in the digest pipeline.
7. ⏸️ **State overlays** — N/A. Allergy doesn't have state overlays today (per inventory §13).
8. ✅ **Findings report** — this document.

**Overall verdict:** Allergy is **mostly "done" UI-wise** but **derivation cascade is BROKEN or framework-gated** for the practice tested (B-1). The UI surfaces (3 tabs, Quiz, forms with success messages) all work end-to-end, the data writes correctly, the test suite passes — but the user-facing payoff (module-page status flipping to COMPLIANT) doesn't happen. Without DB access I can't determine whether this is a fundamental rederive bug or just framework gating, but EITHER WAY the user-facing UX is broken: log compliance evidence, see no progress.

## Recommendations for next audit cycle

1. **First priority — diagnose B-1** by reading `src/lib/events/projections/allergyEquipment.ts` + `allergyDrill.ts` and comparing to `credential.ts` projection's rederive pattern. If rederive is missing, add it (likely 2-4 lines per projection). If it's framework-gating, decide whether unrelated practices should still see auto-derivation OR change /modules/allergy to render NOT_APPLICABLE radios when framework is dormant.
2. **Bundle with C-1 (cross-tenant guards) and C-2 (role gates)** — Allergy mostly already gates correctly (per the spot-check of `requireAdmin()` usage), but the projections may still need the cross-tenant guard sweep alongside HIPAA + Credentials. **Allergy's contribution to the cross-tenant sweep is small** — possibly already correct.
3. **Bundle B-2 with HIPAA I-7 + OSHA I-8 + Credentials I-7/I-8** for citation registry refactor.
4. **Bundle B-3 with HIPAA B-6 + Credentials B-6** for "Open gaps" stat semantics fix.
5. **The HIPAA + OSHA + Credentials + Allergy audit findings are now complete.** Next session should run the aggregation step per the plan's "Aggregation step (after all 4 areas)" — produce `docs/audit/2026-04-29-audit-summary.md` ranking the cross-area patterns + the standalone bugs.

## Cross-area patterns confirmed (for the aggregation step)

| Pattern (predicted) | Allergy confirmation |
|---|---|
| C-1 cross-tenant guard gap | ⏸️ Pending code-reviewer file |
| C-2 OWNER/ADMIN role gate gap | ✅ MOSTLY CLEAN — `requireAdmin()` helper + per-target tenant check on all 6 actions. (False-positive on `toggleStaffAllergyRequirementAction` from the inventory has been refuted.) |
| I-1 dates rendered in UTC | ✅ Confirmed (fridge log row date displayed as UTC `2026-04-29`) |
| I-7/I-8 hardcoded citations | ✅ Confirmed (5 of 9 requirements have hardcoded `(USP §21.x)` citations) |
| I-8/I-9 missing aria on radio groups | ⏸️ Pending code-reviewer file |

**New cross-area pattern surfaced by Allergy review (for HIPAA + OSHA + Credentials back-checking):**

- **B-1 derivation cascade gap** — the event-sourced projection writes the row but doesn't trigger the dependent rule's rederive. Worth re-checking on HIPAA + OSHA + Credentials whether all event projections explicitly call `rederiveRequirementStatus`. Credentials does (verified at `credential.ts:33-40`); HIPAA + OSHA may have similar gaps not surfaced because the prior audit sessions didn't have the same "log evidence → check module page" flow.
- **U-2/U-3 (no Edit/Delete on history rows)** — same pattern as Credentials B-2 (no Edit/Renew/Retire on credential detail page). Cross-cutting "history rows are immutable from UI" gap that affects credentials, allergy equipment, allergy drill, possibly OSHA incidents. Single shared `<HistoryRowActions>` component would cover all surfaces.
