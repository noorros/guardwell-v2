# OSHA Code Review — Raw Findings

**Date:** 2026-04-29
**Source:** `superpowers:code-reviewer` subagent run against the OSHA surface inventory.
**Status:** Read-only sample review across 8 focus areas. Inventory at [`2026-04-29-osha-inventory.md`](2026-04-29-osha-inventory.md).

> Read-only review. Triage + fix is a separate cycle. Output feeds `2026-04-29-osha-findings.md`.

## CRITICAL (3)

### C-1. FIRST_AID-only injuries counted as recordable everywhere
- **Files:** `src/lib/compliance/derivation/osha.ts:50-58`, `src/app/api/audit/osha-300/route.tsx:45-61`, `src/lib/audit-prep/evidence-loaders.ts:484-512`
- **Issue:** `osha300LogRule` and the Form 300 query both filter `type: "OSHA_RECORDABLE"` only — no `oshaOutcome !== "FIRST_AID"`. The 300 Log will print rows with outcome "First aid only," which §1904.7(b)(5) explicitly excludes from the 300 Log. The derivation rule also flips OSHA_300_LOG to COMPLIANT off a first-aid incident, which is technically incorrect.
- **Why it matters:** Falsely inflated 300 totals; inspectors who see "First aid only" on Form 300 may flag for §1904.7 misunderstanding. First-aid-level exposure incidents belong in the BBP/sharps log, not Form 300.
- **Fix:** Add `oshaOutcome: { not: "FIRST_AID" }` to where clauses in 3 sites. Consider renaming `OSHA_RECORDABLE` enum to `OSHA_INCIDENT` with explicit `recordable` boolean derived from outcome.

### C-2. No role gate on incident reporting / breach determination / OSHA PDF generation
- **Files:** `programs/incidents/actions.ts:71-72,134-136,224-226`, `api/audit/osha-300/route.tsx:18-28`, `api/audit/osha-301/[id]/route.tsx:19-32`
- **Issue:** All actions check `requireUser()` + `getPracticeUser()` but never `requireRole("ADMIN")`. Any VIEWER can report incidents, run breach determinations, mutate notification timestamps, download OSHA 300/301 PDFs containing employee injury data subject to §1904.35(b)(2)(v) privacy.
- **Why it matters:** Mirrors HIPAA C-2. Breach determinations are legal artifacts; injury PDFs require role gate.
- **Fix:** Add `requireRole("ADMIN")` to `completeBreachDeterminationAction`, `recordIncidentNotificationAction`, OSHA-300/301 PDF routes. STAFF gate on `reportIncidentAction`.

### C-3. Form 300A worksheet numeric inputs lack upper bounds
- **File:** `src/components/gw/Extras/OshaExtras.tsx:144-156, 192-198`
- **Issue:** `Number.parseInt(..., 10) || 0` with no upper bounds. User pastes `1e10` → `(totalCases * 200_000)` exceeds `Number.MAX_SAFE_INTEGER`, rendering invalid TRIR. Decimal hours (some browsers permit) silently parseInt'd, dropping precision.
- **Why it matters:** Mirrors HIPAA I-4. The 300A is the form the Privacy/Safety Officer types into the federal PDF — garbage worksheet → garbage filings.
- **Fix:** `Number.isFinite` guard before TRIR/DART calc; cap fields (averageEmployees ≤ 50,000, hoursWorked ≤ 200,000,000); `Number.parseFloat` with rounding.

## IMPORTANT (10)

### I-1. Calendar-year poster rule uses local-server time vs UTC `createdAt`
- **File:** `src/lib/compliance/derivation/osha.ts:67-85`
- **Issue:** `new Date(new Date().getFullYear(), 0, 1)` constructs Jan 1 in server's local TZ; compared to UTC `eventLog.createdAt`. At Dec 31 23:00 PST → Jan 1 07:00 UTC drift, attestation submitted Dec 31 evening Pacific projects to UTC year Y+1. On Jan 1 Pacific morning, rule considers Y+1 the "current year" and misses the attestation.
- **Why it matters:** Mirrors HIPAA I-1. OSHA_REQUIRED_POSTERS would flip to GAP at the wrong moment.
- **Fix:** Use `Date.UTC(new Date().getUTCFullYear(), 0, 1)`. Long-term: add `practice.timezone` field.

### I-2. Annual posters (calendar-year) and PPE (rolling 365d) windows overlap awkwardly
- **File:** `src/lib/compliance/derivation/osha.ts:67-105`
- **Issue:** PPE rule: `Date.now() - YEAR_MS` (rolling). Posters: calendar year. Both individually OK, but Feb 1 2026 attestation satisfies posters for all 2026 (annual), while same date for PPE silently drops to GAP on Feb 1 2027 with no warning. UX cliff.
- **Fix:** Align both on calendar-year, OR add a "deadline approaching" warning state when within 30 days of cutoff.

### I-3. `OSHA_GENERAL_DUTY` rule references SRA without checking practice frameworks
- **File:** `src/lib/compliance/derivation/osha.ts:118-145`
- **Issue:** Composite rule queries `practiceSraAssessment` directly but doesn't confirm the SRA addressed OSHA-domain hazards. HIPAA-only SRA satisfies General Duty Clause check. Reward for HIPAA-only practices.
- **Fix:** Add `frameworks: string[]` to `PracticeSraAssessment`, require `OSHA` membership. OR split into a dedicated OSHA hazard assessment surface.

### I-4. Form 300/301 PDFs render dates via `toISOString().slice(0,10)` (UTC)
- **Files:** `src/lib/audit/osha-300-pdf.tsx:113-115`, `osha-301-pdf.tsx:100-102`
- **Issue:** `discoveredAt: 2026-01-01T03:00:00Z` (= Dec 31 2025 22:00 EST) prints as "2026-01-01" even though injury occurred Dec 31 2025 in practice TZ. With calendar-year filtering on same UTC field, injury could end up on the wrong year's Form 300 entirely.
- **Why it matters:** §1904.30 deficiency — date in wrong calendar year on signed/submitted Form 300.
- **Fix:** Same as I-1 — practice timezone field, render dates in that TZ.

### I-5. Form 300 column "Employee" misrepresents the injured party
- **Files:** `src/app/api/audit/osha-300/route.tsx:77-90`, `osha-300-pdf.tsx:158-160`
- **Issue:** PDF's Employee column comes from `reportedByUserId` — the user who FILED the report, not the injured employee. If Privacy Officer files all incidents on staff's behalf, every row says her name. Header hint disclaims "verify and hand-correct" but the leak is still visible to inspectors.
- **Why it matters:** §1904.35(b)(2)(v) governs employee privacy on Form 300 — concern is about INJURED employee, not reporter. Hand-correction destroys the EventLog audit trail.
- **Fix:** Add `injuredUserId` field to `Incident` (separate from `reportedByUserId`), default to reporter if not provided; surface in form. Update form to ask "Which staff member was injured?"

### I-6. `IncidentType` enum re-declared as string literal in 3 files
- **Files:** `incidents/new/IncidentReportForm.tsx:11-20,82-87`, `incidents/page.tsx:17-25`, `incidents/[id]/page.tsx:29-37`
- **Issue:** Three files re-declare the same hand-rolled string-literal union for `IncidentType` and OSHA outcome enum. Brittle to schema changes.
- **Fix:** `import type { IncidentType, IncidentSeverity } from "@prisma/client"`; use a local `OSHA_OUTCOMES` const tuple for runtime validation.

### I-7. `formatDate` helper duplicated across 300/301 PDFs
- **Files:** `osha-300-pdf.tsx:113-115`, `osha-301-pdf.tsx:100-102`, breach memo
- **Issue:** Identical helpers across PDFs. When timezone work happens (I-1, I-4), three+ files need to change in lock-step.
- **Fix:** Extract `formatPracticeDate(d, tz)` into `src/lib/audit/format.ts`.

### I-8. Hardcoded regulatory citations across 6+ files (no central registry)
- **Files:** `osha-300-pdf.tsx:148-151` ("29 CFR §1904.4"), `osha-301-pdf.tsx:121` ("29 CFR §1904.7"), `OshaExtras.tsx:135,291`, derivation comments, `seed-osha.ts:48-122`
- **Issue:** Mirrors HIPAA I-7. Citations duplicated across PDFs, badges, comments, seed.
- **Fix:** Pass `requirement.citation` to PDF generators; `getCitation(code)` helper for OshaExtras.

### I-9. `BreachDeterminationWizard` radios missing `aria-required` / `aria-invalid` / `aria-describedby`
- **File:** `programs/incidents/[id]/BreachDeterminationWizard.tsx:119-123`
- **Issue:** `role="radiogroup"` + `aria-label` present (good — addresses HIPAA I-8). But no `aria-required="true"`, no `aria-invalid` flip on submit-without-scoring, no `aria-describedby` linking the error `<p>`.
- **Why it matters:** WCAG 2.1 AA failure for form error association.
- **Fix:** Add `aria-required="true"`, set `aria-invalid="true"` + `aria-describedby={errorId}` on the radiogroup when error non-null.

### I-10. `Form300AWorksheet` form fields lack `<fieldset>` + `aria-describedby`
- **File:** `OshaExtras.tsx:183-206`
- **Issue:** `<ul>` of `<label>` instead of `<fieldset>` + `<legend>`. Hint text below each input is `<p>` not associated via `aria-describedby` to its input.
- **Why it matters:** WCAG 2.1 AA for form labeling and grouping.
- **Fix:** `<fieldset><legend>Form 300A inputs</legend>...</fieldset>`; convert hints to `<span id="...">` + `aria-describedby` on input.

## MINOR (14)

### M-1. PPE/Poster projections re-derive only the synthetic event code, not framework score directly
- **File:** `src/lib/events/projections/oshaAttestation.ts:24,31`
- **Fix:** Integration test asserting evidence code resolves to non-empty list of requirements.

### M-2. `IncidentReportForm` writes `discoveredAt: new Date(date).toISOString()` without TZ awareness
- **File:** `IncidentReportForm.tsx:78`
- **Fix:** Append `T12:00:00` (noon practice-local) before parsing.

### M-3. `loadOshaNeedlestickEvidence` searches keywords "needlestick"/"sharps" via case-insensitive contains
- **File:** `audit-prep/evidence-loaders.ts:559-595`
- **Issue:** Schema has `sharpsDeviceType` field; loader still uses substring search across title+description. Misses incidents w/ device but no keyword; false-positives on "I sharpened my pencil".
- **Fix:** `where: { sharpsDeviceType: { not: null } }`, OR fallback for legacy rows.

### M-4. OSHA derivation rules don't handle deleted incidents
- **File:** `osha.ts:50-58`, `osha-300/route.tsx:45-50`
- **Fix:** Document the assumption ("no soft-delete on Incident — recordable injuries are immutable for §1904 retention") in rule docstring.

### M-5. OSHA actions don't `revalidatePath("/audit/reports")`
- **File:** `incidents/actions.ts:110-114,208-211,365-368`
- **Fix:** Add `revalidatePath("/audit/reports")` or rely on `dynamic = "force-dynamic"`.

### M-6. OSHA 300 PDF "Case #" is index-based, not stable
- **File:** `osha-300/route.tsx:83`
- **Issue:** `caseNumber: String(idx + 1).padStart(3, "0")` — case numbers re-renumber every regeneration. §1904.32(b)(1) treats each case as having stable identifier.
- **Fix:** Persist `caseNumber` to Incident at creation (auto-increment per practice per year).

### M-7. Sharps log not produced as distinct deliverable
- **Issue:** §1910.1030(g)(7) requires separate sharps injury log (not the 300). Schema captures `sharpsDeviceType` but OSHA 300 PDF prints sharps inline. No dedicated sharps-log PDF.
- **Fix:** `/api/audit/osha-sharps-log` route filtering `sharpsDeviceType IS NOT NULL`.

### M-8. `oshaOutcome` cast pattern in IncidentReportForm fragile
- **File:** `IncidentReportForm.tsx:82-87,254-260`
- **Fix:** `const OSHA_OUTCOMES = [...] as const`; derive type; map for `<option>`.

### M-9. `incident-summary` PDF route has no audit-event emission
- **File:** `api/audit/incident-summary/route.tsx:18-74`
- **Issue:** Unlike osha-300 route (emits `INCIDENT_OSHA_LOG_GENERATED`), incident-summary has no event emission. Anyone can pull incident roster with no log.
- **Fix:** Add `appendEventAndApply` for `INCIDENT_SUMMARY_GENERATED` event.

### M-10. No integration test for OSHA_300_LOG, FIRST_AID exclusion, year-boundary, BBP 95% threshold
- **File:** `tests/integration/osha-derivation.test.ts:73-99`
- **Fix:** Add tests for (a) 300_LOG flips on first OSHA_RECORDABLE within 365d, (b) ages out at day 366, (c) FIRST_AID outcome doesn't flip the rule, (d) BBP training at 94% vs 95% boundaries.

### M-11. `OshaExtras` worksheet doesn't persist — no save-to-events offered
- **File:** `OshaExtras.tsx:142-236`
- **Fix:** Add "Attest 300A posted" button emitting POSTER_ATTESTATION + new `FORM_300A_FINALIZED` event.

### M-12. `Date.now()` in derivation rules is non-deterministic
- **File:** `osha.ts:50,96`
- **Fix:** Pass `now: Date` argument through rule signature for deterministic testing.

### M-13. Sentinel value handling — empty input → 0 awkward
- **File:** `OshaExtras.tsx:144-156`
- **Fix:** Allow empty string in state, treat as 0 only at calculation time.

### M-14. `v1` ambiguity in event registry comments
- **File:** `events/registry.ts:407`
- **Fix:** Replace "v1" with "schema version 1".

## Top 5 fix-up priorities

1. **C-1** Exclude FIRST_AID from Form 300 / `osha300LogRule` — §1904.7 fix in 3 sites + pair with M-10 tests.
2. **C-2** Add `requireRole("ADMIN")` to incident actions and OSHA PDF routes — mirrors HIPAA C-2; system-wide PR.
3. **I-5** Separate `injuredUserId` from `reportedByUserId` — Form 300 prints wrong name (privacy/§1904.35).
4. **I-1 + I-4 (combined)** Practice timezone field + UTC-safe year boundary — single architectural fix solves OSHA poster annual rule, 300 Log calendar-year filtering, and PDF date rendering. Unblocks HIPAA I-1 too.
5. **M-10** OSHA_300_LOG integration tests including FIRST_AID exclusion + year-boundary — currently zero direct test coverage.
