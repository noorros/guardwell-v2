# OSHA findings — 2026-04-30 (second audit)

**Date:** 2026-04-30
**Reviewer:** Static code-review agent (read-only)
**Scope:** `src/lib/compliance/derivation/osha.ts`, `src/app/api/audit/osha-{300,301}/`, `src/lib/audit/osha-{300,301}-pdf.tsx`, `src/app/(dashboard)/programs/incidents/`, `src/components/gw/Extras/OshaExtras.tsx`, `src/lib/notifications/generators.ts` (posting reminder), `src/lib/audit-prep/`.
**Prior audit:** [`2026-04-29-osha-findings.md`](2026-04-29-osha-findings.md). Recent merges in scope: PR #198 (FIRST_AID exclusion), PR #211 (audit #19 injuredUserId), PR #212 (audit #12 ARIA sweep), PR #213 (audit #15 INCIDENT_OSHA_OUTCOME_UPDATED + OshaOutcomePanel).

## Inventory
- 8 derivation rules + 2 PDF routes + 5 incident actions + OshaExtras + 7 OSHA integration test files reviewed.
- **22 findings: 4 Critical / 10 Important / 8 Minor.**

## Critical (4)

### C-1 — Cross-tenant `injuredUserId` not validated — privacy + audit-trail leak
- **Files:** `src/app/(dashboard)/programs/incidents/actions.ts:81-114, 427-474`.
- **What's wrong:** Both `reportIncidentAction` and `updateIncidentOshaOutcomeAction` accept `injuredUserId` from the client and write it onto the Incident with no check that the user belongs to a `practiceUser` row in `pu.practiceId`. A caller could supply an arbitrary user id from another practice; that name then prints on this practice's Form 300 + 301 PDFs. The OSHA outcome panel only loads same-practice members for the dropdown, so the UI doesn't expose the bug — but a hand-crafted POST does.
- **Audit-defense impact:** YES — §1904.35(b)(2)(v) employee-privacy violation in reverse (leaks names of users from OTHER practices). Defeats the audit-#19 fix that motivated the field.
- **Fix:** In both actions, after `parsed.injuredUserId` is read, run `db.practiceUser.findFirst({ where: { userId: parsed.injuredUserId, practiceId: pu.practiceId, removedAt: null }})` and throw if absent.
- **Effort:** S (~30 LOC + 2 tests).

### C-2 — `BreachDeterminationWizard` renders for OSHA / DEA / NEAR_MISS / etc.
- **File:** `src/app/(dashboard)/programs/incidents/[id]/page.tsx:172-176`.
- **What's wrong:** Wizard renders for any incident with `isBreach === null` — no `incident.type` gate. Reported in prior audit as B-4 (MEDIUM); not addressed. An OSHA-recordable needlestick → detail page → 4-factor PHI risk wizard with `factor1Score` (PHI nature) for an injury. If a workforce member completes the wizard with random scores, `isBreach: true` flips and a critical-alert email fires for an OSHA injury.
- **Audit-defense impact:** YES — conceptual contamination of HIPAA breach record. EventLog now holds an `INCIDENT_BREACH_DETERMINED` event for an OSHA fatality.
- **Fix:** Wrap `BreachDeterminationWizard` render in `incident.type === "PRIVACY" || incident.type === "SECURITY"`. For non-HIPAA types, show a placeholder card.
- **Effort:** Trivial (~3 LOC).

### C-3 — `oshaDaysAway` / `oshaDaysRestricted` accept any non-negative integer; §1904.7(b)(3)(vii) caps at 180
- **Files:** `programs/incidents/actions.ts:60-61, 413-414`, `incidents/new/IncidentReportForm.tsx:108-113`, `incidents/[id]/OshaOutcomePanel.tsx:162-165, 270-291`.
- **What's wrong:** Schema accepts `Int?`; Zod uses `z.number().int().min(0)` with no max. §1904.7(b)(3)(vii): "If the worker is away from work for more than 180 calendar days, you may stop counting." A keyed-in `oshaDaysAway: 365` lands on Form 300 verbatim. Also `Number.parseInt(daysAway)` in OshaOutcomePanel:162 with no `Number.isFinite` guard.
- **Audit-defense impact:** YES — inflated TRIR/DART denominator on Form 300A worksheet → inspector-visible inconsistency.
- **Fix:** `z.number().int().min(0).max(180)` on both inputs. UI hint near the days-away input.
- **Effort:** S.

### C-4 — Form 300 calendar-year filter still uses UTC year boundaries
- **File:** `src/app/api/audit/osha-300/route.tsx:49-50, 56`.
- **What's wrong:** `new Date(\`${year}-01-01T00:00:00Z\`)` + `discoveredAt: { gte: yearStart, lt: yearEnd }`. PDF render path uses `formatPracticeDate` (good), but the upstream filter still queries on UTC year boundaries. AZ practice (UTC-7), incident reported Dec 31 17:00 PST = Jan 1 00:00 UTC → grouped onto next year's 300 Log. Inspector pulls 2026 Form 300 → injury Dec 31 2025 in practice TZ is missing.
- **Audit-defense impact:** YES — §1904.32 calendar-year-scoped record could omit injuries that should be in the year.
- **Fix:** Compute year-start/year-end in `pu.practice.timezone`. Same logic in `osha300LogRule` + `loadOsha300LogEvidence`.
- **Effort:** M.

## Important (10)

### I-1 — `oshaRequiredPostersRule` still uses local-server `getFullYear()`
- **File:** `src/lib/compliance/derivation/osha.ts:73-91`. **Fix:** Use `Date.UTC` constructor or thread `practice.timezone`.

### I-2 — OSHA 300A reminder window EXCLUDES the active posting period (Feb 2 – Apr 30)
- **File:** `src/lib/notifications/generators.ts:579-582, 945-951`. Reminder runs Jan 15 → Feb 1 inclusive. §1904.32(b)(6) requires the 300A be POSTED Feb 1 – Apr 30. Reminder cycle ends right when the obligation begins. **Fix:** Extend window through Apr 30 OR add a "posting still required" reminder Feb 5 – Apr 25.

### I-3 — `loadOshaNeedlestickEvidence` keyword search; `sharpsDeviceType` not consulted
- **File:** `src/lib/audit-prep/evidence-loaders.ts:572-608`. Schema has `sharpsDeviceType String?`. Loader still queries by `OR` of `title` / `description` `contains "needlestick" / "sharps"`. Misses incidents with non-trigger titles. **Fix:** `where: { sharpsDeviceType: { not: null } }`.

### I-4 — No fatality-alert path for OSHA `DEATH` outcome — §1904.39 8-hour reporting
- **Files:** `src/lib/notifications/critical-alert.ts` (HIPAA-only), `programs/incidents/actions.ts:81-137`.
- **What's wrong:** `emitCriticalBreachAlert` only fires from `completeBreachDeterminationAction`. When `reportIncidentAction` accepts `oshaOutcome: "DEATH"` (or amputation / inpatient hospitalization), no critical-alert is emitted. Safety Officer learns about the fatality only when they happen to open the dashboard. §1904.39(a)(1) requires reporting within 8 hours.
- **Audit-defense impact:** YES — practice misses 8-hour clock if fatality reported overnight.
- **Fix:** New `emitOshaCriticalIncidentAlert` triggered when `type === "OSHA_RECORDABLE" && oshaOutcome === "DEATH"`. Email + in-app notification with deadline countdown.
- **Effort:** M.

### I-5 — `OshaOutcomePanel` (PR #213) missing ARIA contracts
- **File:** `src/app/(dashboard)/programs/incidents/[id]/OshaOutcomePanel.tsx`.
- **What's wrong:** New client island shipped after audit-12 ARIA sweep (PR #212) but NOT included in `audit-12-aria-sweep.test.tsx`. No `aria-required` on the injured-employee select, no `aria-invalid` flip, no `aria-describedby` linking the error.
- **Fix:** Add `aria-required`, `aria-invalid`, `aria-describedby`. Wrap OSHA fields in `<fieldset><legend>`. Add OshaOutcomePanel to the audit-12 sweep test.
- **Effort:** S.

### I-6 — `Form 300 caseNumber` is index-based, mutates between regenerations
- **File:** `src/app/api/audit/osha-300/route.tsx:98`. `caseNumber: String(idx + 1).padStart(3, "0")`. Re-generating after deleting an old row renumbers. §1904.32(b)(1) treats each case as having a stable identifier. **Fix:** Persist `caseNumber: Int?` on Incident, populated at OSHA reporting time.

### I-7 — `Form 300A` worksheet inputs unbounded
- **File:** `src/components/gw/Extras/OshaExtras.tsx:144-156, 192-198`. `Number.parseInt(e.target.value, 10) || 0` clamps to 0+ but no upper bound. `Number.parseFloat` with `Math.round` would be safer for hours. **Fix:** `Number.isFinite` guards + caps + use `parseFloat`.

### I-8 — Incident list page shows ALL incidents — no scoping by status / type / state
- **File:** `programs/incidents/page.tsx:41-45`. Multi-state operators get one combined log. §1904.30 requires separate 300 Log per "establishment". **Fix:** Add `?state=AZ` query param.

### I-9 — No 5-year retention enforcement
- **File:** `src/lib/audit-prep/evidence-loaders.ts:484-525`. §1904.33(a) requires Form 300 retention for 5 years; §1904.33(b) explicitly says practices need NOT keep records beyond 5 years. Audit packet's "all-time" count includes incidents older than 5 years. **Fix:** Cap "all-time" to 5 years in the loader.

### I-10 — Cybersecurity actions (phishing / MFA / backup) lack role gate
- **File:** `programs/cybersecurity/actions.ts:32, 92, 148`. Only `requireUser()`, no `requireRole("ADMIN")`. STAFF/VIEWER can log phishing drills, mark MFA enrolled. Same C-2 shape as the prior HIPAA/OSHA role-gate sweep (PR #201). **Fix:** Add `requireRole("ADMIN")`.

## Minor (8)

### M-1 — `IncidentReportForm` — `new Date(discoveredAt).toISOString()` parses YYYY-MM-DD as UTC
- File: `programs/incidents/new/IncidentReportForm.tsx:98`. Date drift at day boundary. **Fix:** Append `T12:00:00` (noon practice-local) before parse.

### M-2 — `incident-summary` PDF route still no role gate, no audit-trail
- File: `src/app/api/audit/incident-summary/route.tsx`. Same shape as HIPAA C-3. **Fix:** Add `requireRole("ADMIN")` + `INCIDENT_SUMMARY_GENERATED` event emission.

### M-3 — `OshaExtras.OshaPostingChecklist` claims EAP "Required if 11+ employees"
- File: `src/components/gw/Extras/OshaExtras.tsx:262`. §1910.38(a) actually says EAP required for ALL workplaces with required portable fire extinguishers. The 11+ rule is a safe-harbor for *oral* communication. **Fix:** Reword.

### M-4 — `oshaPpeRule` (rolling 365d) silently drops to GAP at exactly day 366 with no warning
- File: `src/lib/compliance/derivation/osha.ts:98-111`. **Fix:** Add a derived "expires soon" field at evidence-loader time.

### M-5 — `Date.now()` non-deterministic in derivation rules
- File: `src/lib/compliance/derivation/osha.ts:50, 102`. **Fix:** Inject `now: Date` parameter via the `DerivationRule` signature.

### M-6 — OSHA 301 PDF doesn't differentiate "Injured employee" vs "Reported by" when same person
- File: `src/lib/audit/osha-301-pdf.tsx:135-143`. Visually noisy. **Fix:** Render only one line when both names match.

### M-7 — Outcome dropdown alphabetical D-collision
- Files: `IncidentReportForm.tsx:331-335`, `OshaOutcomePanel.tsx:253-257`. Pressing "d" cycles to "Death" before "Days away". **Fix:** Reorder by frequency or rename "Death" to "Fatal".

### M-8 — `INCIDENT_OSHA_OUTCOME_UPDATED` event has no UI label in module-activity feed
- Files: `incident.ts:286-324` (event written), `ModuleActivityFeed/index.tsx` (no label entry). **Fix:** Add label / template entry.

## What's well done
- §1904.7(b)(5) FIRST_AID exclusion now applied in all three sites + dedicated regression test.
- Audit #19 `injuredUserId` is a real schema column with index, fallback to `reportedByUserId` for legacy rows is documented + tested.
- Cross-tenant guard on `updateIncidentOshaOutcomeAction` is proper. Type-immutability enforced (refuses non-OSHA edits).
- Role gates on PDF routes tightened to OWNER/ADMIN with self-disclaimed audit comments referencing §1904.35(b)(2)(v).
- `INCIDENT_OSHA_LOG_GENERATED` audit-trail event fires from both 300 and 301 routes.
- Practice-tz-aware date rendering wired through `formatPracticeDate` in both PDFs.
- Citations registry centralized.
- Form 300 PDF cache headers explicit `private, no-store` — no PHI leakage via shared CDN cache.

## Test coverage gaps
- No cross-tenant `injuredUserId` test (C-1).
- No `oshaDaysAway > 180` validation test (C-3).
- No timezone year-boundary test for Form 300 row inclusion (C-4).
- No fatality-alert smoke test (I-4) — path doesn't exist.
- OshaOutcomePanel not in `audit-12-aria-sweep.test.tsx` (I-5).
- No regression test for `BreachDeterminationWizard` rendering on OSHA incidents (C-2).
- No test for `caseNumber` stability across PDF regenerations (I-6).
- No 5-year retention horizon test (I-9).

## Cross-reference to prior audit

| Prior finding | Status |
|---|---|
| C-1 (FIRST_AID exclusion) | **FIXED** — PR #198 |
| C-2 (role gates on PDF routes + actions) | **FIXED** — PR #201 |
| C-3 (Form 300A worksheet bounds) | **STILL OPEN** — flagged as I-7 |
| I-1 (poster annual-rule TZ) | **STILL OPEN** — flagged as I-1 |
| I-3 (General Duty references SRA without OSHA-domain check) | not re-verified |
| I-4 (Form 300/301 date rendering) | **PARTIAL** — render uses `formatPracticeDate`, but year FILTER still UTC (C-4) |
| I-5 (Form 300 Employee column) | **FIXED** — `injuredUserId` now plumbed |
| I-7 (formatDate dedup across PDFs) | **FIXED** — `formatPracticeDate` shared helper |
| I-8 (citations registry) | **FIXED** |
| M-3 (sharps keyword search) | **STILL OPEN** — I-3 |
| M-6 (caseNumber index-based) | **STILL OPEN** — I-6 |
| M-9 (incident-summary no audit) | **STILL OPEN** — M-2 |
| M-10 (OSHA_300_LOG tests) | **FIXED** |
| B-1 (Osha300AReminder banner) | **PARTIAL** — notification reminder Jan 15 – Feb 1 only; flagged as I-2 |
| B-3 (injured-vs-reporter on Form 300) | **FIXED** |
| B-4 (BreachWizard renders for OSHA) | **STILL OPEN** — flagged as C-2 |
| B-5 (incomplete OSHA fields on existing rows) | **FIXED** — PR #213 OshaOutcomePanel |
