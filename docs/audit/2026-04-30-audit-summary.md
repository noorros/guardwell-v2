# Cross-Area Audit Summary — HIPAA / OSHA / Credentials / Allergy (second pass)

**Date:** 2026-04-30
**Method:** Read-only static code review by 4 parallel Claude agents (one per module) + live Chrome verification on prod.
**Prior audit:** [`2026-04-29-audit-summary.md`](2026-04-29-audit-summary.md). All Top-10 + 9/10 bucket-#2 items shipped to prod 2026-04-30 (revisions `00188-dq7` through `00200-r7w`).
**Production target:** `https://v2.app.gwcomp.com` (revision `guardwell-v2-00200-r7w`)
**Per-area findings docs:**
- [`2026-04-30-hipaa-findings.md`](2026-04-30-hipaa-findings.md)
- [`2026-04-30-osha-findings.md`](2026-04-30-osha-findings.md)
- [`2026-04-30-credentials-findings.md`](2026-04-30-credentials-findings.md)
- [`2026-04-30-allergy-findings.md`](2026-04-30-allergy-findings.md)
- [`2026-04-30-chrome-findings.md`](2026-04-30-chrome-findings.md) (live prod verification)

**Remediation plan:** [`docs/plans/2026-04-30-audit-plan.md`](../plans/2026-04-30-audit-plan.md)

---

## Headline numbers

| Area | Critical | Important | Minor | Total |
|---|---|---|---|---|
| HIPAA | 4 | 8 | 9 | **21** |
| OSHA | 4 | 10 | 8 | **22** |
| Credentials | 5 | 10 | 9 | **24** |
| Allergy | 4 | 12 | 8 | **24** |
| Chrome (live) | 0 | 3 | 3 | **6** |
| **Total** | **17** | **43** | **37** | **97** |

**Verdict:** Codebase has shipped substantial security + correctness fixes in the prior audit cycle, and most reference patterns (cross-tenant guards, role gates, EXPIRING_SOON SoT, citation registry, audit-#12 ARIA template) are now well-established. The remaining issues cluster into a few cross-cutting patterns that escaped prior sweeps — re-running each sweep against the new sites would close ~70% of the Critical findings.

---

## Top 10 must-fix items, ranked by impact

> Ordering criteria: live-validated > theoretical exploit; user-facing failure > internal correctness; audit-defense impact > UX papercut.

### #1 — Credentials CR-1: Edit + Renew silently null `holderId` on every save (LIVE-VALIDATED REGRESSION)
- **Files:** `programs/credentials/[id]/CredentialMetadataPanel.tsx:222-231, 380-392`, server at `actions.ts:152-162`, projection at `events/projections/credential.ts:79-89`.
- **Impact:** Every Edit or Renew on a credential (the most-used surface from audit #8 PR #204) wipes the holder, moving the credential from "Dr. Jane" to "Practice-level". Audit-trail event payload records `holderId: null` so the EventLog shows no continuity. State-board renewal evidence packets are mis-attributed.
- **Fix:** Server-side: change `updateCredentialAction` to default `holderId` from existing row when payload omits it. ~5 LOC + 1 test.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #2 — Credentials CR-2: `/api/audit/credentials-register` PDF route missing OWNER/ADMIN gate
- **File:** `src/app/api/audit/credentials-register/route.tsx:18-40`.
- **Impact:** Any STAFF/VIEWER can pull a PDF containing every credential's `licenseNumber`, holder name, holder email, DEA number, malpractice policy number. Audit #3 PR #201 closed the CSV export hole but missed the sibling PDF route. PDF is `Content-Disposition: inline` → no download trail in browser history.
- **Fix:** 5-line role-gate addition matching the OSHA-300 pattern.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #3 — OSHA C-1: Cross-tenant `injuredUserId` not validated — privacy + audit-trail leak
- **Files:** `programs/incidents/actions.ts:81-114, 427-474`.
- **Impact:** Both `reportIncidentAction` and `updateIncidentOshaOutcomeAction` accept `injuredUserId` from the client and write it onto the Incident with no check that the user belongs to the caller's practice. UI doesn't expose it (dropdown is same-practice only) but a hand-crafted POST writes another practice's user onto Form 300/301 PDFs. Defeats audit-#19's whole §1904.35(b)(2)(v) employee-privacy intent.
- **Fix:** Validate `injuredUserId` belongs to a `practiceUser` in `pu.practiceId` with `removedAt: null`. ~30 LOC + 2 tests.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #4 — Credentials CR-3: `/audit/activity` exposes `licenseNumber` to STAFF/VIEWER
- **Files:** `src/app/(dashboard)/audit/activity/page.tsx:99`, `src/lib/audit/format-event.ts:164-170`.
- **Impact:** Bypass of CR-2 / audit #3. Activity log renders `detail: #<licenseNumber>` for every CREDENTIAL_UPSERTED event — STAFF sees DEA numbers / state license numbers / malpractice policy numbers row-by-row even without ever loading the credentials surface.
- **Fix:** Either gate `/audit/activity` to OWNER/ADMIN, or redact `detail` for CREDENTIAL_UPSERTED when the viewer isn't OWNER/ADMIN. The redact option preserves audit-trail visibility for staff.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #5 — HIPAA C-1: Policy + BAA projections lack cross-tenant guards
- **Files:** `events/projections/policyAdopted.ts:22-103`, `policyContentUpdated.ts:22-50`, `policyAcknowledged.ts:18-32`, plus 3 BAA projections.
- **Impact:** Audit C-1 cross-tenant sweep added `assertProjectionPracticeOwned` to SRA / Credentials / Allergy projections, but Policy + BAA projections were missed. Defense-in-depth gap on the same class of bug C-1 was meant to close. §164.530 + §164.316 evidence integrity.
- **Fix:** Mirror the assertion in 8 projections + extend `projection-cross-tenant-guards.test.ts`.
- **Effort:** M | **Severity:** CRITICAL | **Audit-defense:** YES

### #6 — HIPAA C-2: SRA actions still ungated to ADMIN
- **Files:** `programs/risk/actions.ts:55-101, 103-142`.
- **Impact:** `completeSraAction` + `saveSraDraftAction` still use `getPracticeUser()` (any role). Any STAFF/VIEWER can complete the practice's SRA wizard, flipping `HIPAA_SRA` to COMPLIANT. Audit #3 sweep missed this. §164.308(a)(1)(ii)(A) requires a "thorough, accurate" risk analysis.
- **Fix:** Wrap with `requireRole("ADMIN")`. Pair with regression test in `role-gate-sweep.test.ts`.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES

### #7 — Credentials CR-4: removed-staff credentials silently disappear from list
- **File:** `programs/credentials/page.tsx:32-74`.
- **Impact:** Operator off-boards Dr. Jane (sets `PracticeUser.removedAt`). Dr. Jane's DEA registration silently vanishes from the credentials page — but is still active, still counts toward `DEA_REGISTRATION` framework rule, still appears on auditor's PDF. State board renewal can't be tracked. Orphaned DEA number with no UI to renew it.
- **Fix:** Drop the `orderedKeys` filter so credentials with removed-holder still render under a "Former staff" section. Re-include `removedAt: { not: null }` PracticeUsers in the page query.
- **Effort:** M | **Severity:** CRITICAL | **Audit-defense:** YES

### #8 — Allergy CR-3: `submitQuizAttemptAction` allows same-practice user to overwrite another user's prior quiz attempt
- **Files:** `programs/allergy/actions.ts:202-243` + `events/projections/allergyCompetency.ts:111-185`.
- **Impact:** Projection's `assertProjectionPracticeOwned` only checks `practiceId` — but NOT `practiceUserId`. STAFF user B can submit at user A's attemptId; existing row's `practiceUserId` is preserved (correct), but `score` / `passed` / `correctAnswers` are overwritten with B's results onto A's record. Worse: B's competency points to A's attempt row.
- **Fix:** Add `practiceUserId` check in projection. 1 line + 1 test.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES (USP §21 evidence chain)

### #9 — Allergy CR-2: notification generators don't filter `retiredAt: null`
- **File:** `src/lib/notifications/generators.ts:406-410, 448-452, 472-476`.
- **Impact:** Audit #15 soft-delete invariant cascades correctly to derivation rules but NOT to notifications. Operator soft-deletes the only kit log → expects "no kit log" notification → doesn't get one. Or: retired drill's `nextDrillDue` keeps firing "drill overdue" alerts on rows the user can't view.
- **Fix:** Add `retiredAt: null` to 3 `where` clauses.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** indirect (visibility layer disagreeing with compliance state)

### #10 — Allergy CR-4: gap-year qualification bypass
- **File:** `events/projections/allergyCompetency.ts:80-88`.
- **Impact:** "Any prior year qualified ⇒ renewal eligibility" — but USP §21.3 requires re-qualification (3 fingertips) after a year off. Gap scenario: 2024 qualified → 2025 dormant → 2026 takes 1 fingertip → silently isFullyQualified=true. State pharmacy boards expect re-qualification after a lapse to start over.
- **Fix:** Replace "any prior year" query with "year = c.year - 1 AND no inactivity flag at year-end". Add 2 tests.
- **Effort:** S | **Severity:** CRITICAL | **Audit-defense:** YES (USP §21)

---

## Cross-cutting patterns

### Pattern A: Role-gate sweep incomplete
- **Audit #3 hit a wide sweep but missed:**
  - SRA actions (`completeSraAction`, `saveSraDraftAction`) — HIPAA C-2
  - Credentials register PDF route (`/api/audit/credentials-register`) — Credentials CR-2
  - Activity log page (`/audit/activity`) — Credentials CR-3
  - HIPAA breach memo PDF (`/api/audit/incident-breach-memo/[id]`) — HIPAA C-3
  - Incident summary PDF (`/api/audit/incident-summary`) — HIPAA C-3 + OSHA M-2
  - Cybersecurity actions (phishing / MFA / backup) — OSHA I-10
  - Training summary PDF (`/api/audit/training-summary`) — HIPAA I-8
- **Recommendation:** Bundle into one role-gate sweep PR. Update `role-gate-sweep.test.ts` to cover every flagged path.

### Pattern B: Cross-tenant guard sweep incomplete
- **Audit #2 hit SRA / Credentials / Allergy but missed:**
  - Policy projections (5) + BAA projections (3) — HIPAA C-1
  - `injuredUserId` validation in incident actions — OSHA C-1
- **Recommendation:** Bundle into one cross-tenant PR.

### Pattern C: Timezone helper not threaded through new edit forms
- **Audit #10 (timezone) replaced UTC slicing in PDFs/dashboards/badges, but missed:**
  - `DrillTab.tsx` EditDrillForm — `drill.conductedAt.slice(0, 10)` (audit #15)
  - `EquipmentTab.tsx` EditEmergencyKitForm — `check.epiExpiryDate.slice(0, 10)` (audit #15)
  - `EquipmentTab.tsx` `fmtDate(iso)` helper — fridge readings list
  - `CredentialMetadataPanel.tsx` `isoToYmd` — Edit + Renew dates (audit #8 path)
  - `NotificationLog.tsx`, `AcknowledgeForm.tsx`, `acknowledgments/page.tsx` — HIPAA I-3
  - OSHA Form 300 calendar-year filter (`osha-300/route.tsx:49-56`) — OSHA C-4 (rendering uses formatPracticeDate, query doesn't)
- **Recommendation:** Add `formatPracticeDateForInput(date, tz)` helper returning `YYYY-MM-DD`-in-tz. Replace all `.slice(0, 10)` and `isoToYmd` callers. Add a "TZ helper coverage" test that asserts every editable date input round-trips through the practice timezone.

### Pattern D: ARIA sweep missed forms shipped post-PR-#212
- **Audit #12 covered SraWizard, IncidentReportForm, AddCredentialForm, NewDestructionForm, BulkCsvImport, BreachDeterminationWizard but missed:**
  - `OshaOutcomePanel` (PR #213) — OSHA I-5
  - `AcknowledgeForm` (policy signing) — HIPAA I-4
  - `AcceptBaaForm` (e-signature) — HIPAA I-4
  - `PhishingDrillForm`, `BackupVerificationForm` — HIPAA I-4
  - LogDrillForm `aria-required` indicator — Chrome CHROME-6
- **Recommendation:** Extend `audit-12-aria-sweep.test.tsx` to cover these. Sweep + test in one PR.

### Pattern E: ESLint rule + ADR-0001 enforcement gaps
- **Allergy CR-1:** `no-direct-projection-mutation.js` missing `allergyDrill`, `allergyEquipmentCheck`, `allergyQuizAttempt`, `allergyQuizAnswer` from `PROJECTION_TABLES`. Audit #15 added the soft-delete invariant but the lint rule doesn't enforce it.

### Pattern F: Notification pipeline not aware of audit-#15 soft-delete
- **Allergy CR-2** — drill, kit, fridge generators don't filter retiredAt.
- May also affect credential reminder generators if credentials grow a `retiredAt` (currently they're event-deleted via CREDENTIAL_REMOVED — not the same model).

---

## Test coverage gaps (top priorities)

1. **`tests/integration/hipaa-derivation.test.ts` does not exist** — every other framework has one. HIPAA has 16 federal rules + 50 state-overlay rules with no direct unit-test coverage. **Largest defensive win per LOC.**
2. **`tests/integration/role-gate-sweep.test.ts` has gaps** — SRA actions, credentials register PDF, activity log page, breach memo PDF, incident summary PDF, cybersecurity actions, training summary PDF.
3. **No cross-tenant test for Policy / BAA projections** — extend `projection-cross-tenant-guards.test.ts`.
4. **No cross-tenant test for `injuredUserId`** — add to `audit-15-history-row-edits.test.ts`.
5. **No timezone-edge test for OSHA Form 300 calendar-year row inclusion.**
6. **No test for `BreachDeterminationWizard` rendering on non-PRIVACY/SECURITY incidents** — would catch OSHA C-2.
7. **No test for retiredAt cascade to allergy notifications** — would catch Allergy CR-2.
8. **No test for credential `holderId` preservation through Edit/Renew** — would catch Credentials CR-1.
9. **No test for `EXPIRING_SOON` boundary across non-UTC `now`** — Credentials MN-8.
10. **No test for the gap-year initial-vs-renewal path in Allergy** — would catch Allergy CR-4.

---

## What's well done (vs. prior audit)

- **Audit #1 (quiz answer-key isolation)** — strongest evidence trail in the codebase. Compile-time type assertions in tests guard against regression.
- **Audit #2 cross-tenant guards** + `assertProjectionPracticeOwned` helper — clean abstraction, consistently applied to SRA/Credentials/Allergy. Just needs to be extended (Pattern B).
- **Audit #6 CSV injection (`csvEscape`)** — explicit OWASP comment + 4 test cases. Cross-cutting fix that hardens vendor + tech-asset bulk imports too.
- **Audit #8 Edit/Renew/Retire** — preserves credential id + EvidenceLog history + CeuActivity rows through Renew. Despite CR-1 holderId regression, the structural pattern (separate component, mode-switching state, server-side `existing.retiredAt` guard) is solid.
- **Audit #10 timezone (`formatPracticeDate`)** — clean helper, well-tested, consistently used in PDFs/dashboards/badges. Just needs to be threaded into edit forms (Pattern C).
- **Audit #11 citation registry** — centralized + clean. Just needs more entries (DEA term, state board, CMS revalidation).
- **Audit #12 ARIA sweep** — 7 jest-axe cases covering 6 forms. Reference QuizRunner pattern is the team's good-pattern template.
- **Audit #15 history row edits** — soft-delete cascade correctly hits all 4 derivation rules. Reference component (`HistoryRowActions`) is reusable across modules. Notifications are the gap (Pattern F).
- **Audit #16 EXPIRING_SOON SoT** — `src/lib/credentials/status.ts` is the best-in-class consolidation pattern; this is the model other surfaces should follow.
- **Audit #19 `injuredUserId`** — schema + projection + PDF rendering all coordinated. Cross-tenant guard is the only gap.

---

## Production state confirmation

Live verification on `https://v2.app.gwcomp.com` (revision `00200-r7w`) confirmed:
- All 6 forms touched by audit #12 are axe-clean (40 inputs / 32 radios / 8 radiogroups on SraWizard alone — 0 issues).
- SRA auto-save fires within 1-2s ("Draft saved just now" indicator).
- Credentials Edit form pre-fills all 6 fields correctly.
- Allergy quiz HTML scan: 0 `correctId` / 0 `explanation` matches.
- Drill + fridge edit affordances visible on existing rows.
- OSHA Form 300 PDF returns 200 application/pdf.

**6 live findings** captured during Chrome verification (CHROME-1 through CHROME-6) — see [`2026-04-30-chrome-findings.md`](2026-04-30-chrome-findings.md).
