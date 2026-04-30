# Chrome verification findings — 2026-04-30 (second audit)

**Date:** 2026-04-30
**Reviewer:** Claude in Chrome (live prod verification on `https://v2.app.gwcomp.com`, revision `guardwell-v2-00200-r7w`).
**Method:** Logged in as practice OWNER (`noorrosllc@gmail.com`), drove key flows across HIPAA / OSHA / Credentials / Allergy as a real user.
**Practice:** "Prod Smoke Test" (AZ, single-state).

## Live findings

### CHROME-1 — IMPORTANT — OshaOutcomePanel edit form does not pre-select existing `injuredUserId`
- **Path:** `/programs/incidents/<id>` → click Edit on OSHA recordable details
- **File:** `src/app/(dashboard)/programs/incidents/[id]/OshaOutcomePanel.tsx:131-148`
- **What happens:** `useState(initial.injuredUserId ?? "")` is set on mount but the dropdown's `<option value="">Select staff member…</option>` empty option appears as the default selected value rather than the existing user. Confirmed via DOM inspection: `select.value === ""` even when `incident.injuredUserId` is non-null on the server.
- **Why it's a problem:** Saving without manually re-selecting the user clobbers `injuredUserId` to null on the Incident. Form 300 / 301 PDF then loses the §1904.35 employee column. Regression introduced by PR #213 (audit #15).
- **Reproducible:** YES — opened the existing OSHA needlestick incident, clicked Edit, observed empty selection.
- **Fix:** Either (a) plumb the injured user as a pre-selected option in the dropdown's options list (current code may be filtering), or (b) initialize the select's `defaultValue` from `initial.injuredUserId` and render the existing user as an option even if they're not in `memberOptions`.
- **Effort:** S.

### CHROME-2 — IMPORTANT — Edit forms use UTC `iso.slice(0, 10)` truncation; list/edit dates disagree
- **Path:** `/programs/allergy` → Drills tab → expand a drill → click Edit
- **Files:** `src/app/(dashboard)/programs/allergy/DrillTab.tsx:455-457` (EditDrillForm), similar pattern in `EquipmentTab.tsx`, `[id]/CredentialMetadataPanel.tsx:55-58` (`isoToYmd`).
- **What happens:** Drill list view shows "**2026-04-28**" (rendered via `formatPracticeDate(date, tz)` — practice timezone AZ MST = UTC-7). Edit form opens with date "**04/29/2026**" (rendered via `drill.conductedAt.slice(0, 10)` — UTC truncation). For a drill with `conductedAt = 2026-04-29T00:00:00Z`, AZ tz formatPracticeDate yields 2026-04-28 (17:00 prior day in MST), while UTC slice yields 2026-04-29.
- **Why it's a problem:** Same class of bug as audit #10 (timezone remediation). User sees one date in list, another in edit; clicking Save without changing rewrites `conductedAt` to a different day than the user expected. Affects:
  - `DrillTab.tsx` EditDrillForm — drill conductedAt + nextDrillDue
  - `EquipmentTab.tsx` EditEmergencyKitForm — epiExpiryDate
  - `EquipmentTab.tsx` `fmtDate(iso)` — fridge reading list dates
  - `CredentialMetadataPanel.tsx` `isoToYmd` — Edit + Renew issue/expiry dates (pre-existing audit #8 path; not caught in audit #10)
- **Fix:** Use a `formatPracticeDateForInput(date, tz)` helper that returns the date `<input type="date">` form (`YYYY-MM-DD`) in the practice timezone. Replace all `iso.slice(0, 10)` and `isoToYmd` callers across the audit-#15 + audit-#8 edit paths.
- **Effort:** M (helper + ~6 call-site replacements + tests).

### CHROME-3 — IMPORTANT — Incident detail page has generic title, not incident-specific
- **Path:** `/programs/incidents/<id>`
- **File:** `src/app/(dashboard)/programs/incidents/[id]/page.tsx`
- **What happens:** Browser tab title shows "GuardWell — Healthcare Compliance Platform" (the root-level fallback). All other detail pages use `metadata` to set proper titles (e.g. "Credential · My Programs | GuardWell", "Allergy Quiz · My Programs | GuardWell").
- **Why it's a problem:** SEO/UX inconsistency. Bookmarking an incident shows generic title; users juggling multiple tabs can't tell incidents apart.
- **Fix:** Add `export async function generateMetadata({ params })` that returns `{ title: `${incident.title} · Incidents | GuardWell` }` using the incident loader. Mirror the pattern in `programs/credentials/[id]/page.tsx`.
- **Effort:** S.

### CHROME-4 — MINOR — OSHA outcome rendered "DAYS AWAY" with underscore-replace, not title-case
- **Path:** `/programs/incidents/<id>` (OSHA recordable details, view mode)
- **File:** `src/app/(dashboard)/programs/incidents/[id]/OshaOutcomePanel.tsx:96` — `outcome.replace(/_/g, " ")` produces ALL-CAPS like "DAYS AWAY", "OTHER RECORDABLE", "FIRST AID".
- **Why it's a problem:** Visually noisy alongside title-case labels in the incident detail card.
- **Fix:** Use a label map matching the form's option labels: `{ DEATH: "Death", DAYS_AWAY: "Days away", RESTRICTED: "Restricted duty", OTHER_RECORDABLE: "Other recordable", FIRST_AID: "First aid only" }`.
- **Effort:** Trivial.

### CHROME-5 — MINOR — Audit-#18 OWNER security-officer default not backfilled for existing practices
- **Path:** `/programs/staff` (officer toggle row for practice OWNER)
- **File:** Audit-#18 fix (PR #205) defaults OWNER as Security Officer at practice creation time. Existing practices created before the fix are not retroactively updated.
- **Observation:** The Prod Smoke Test practice's OWNER has Privacy ✓, Compliance ✓, Security ✗, Safety ✗. The audit-#18 code only fires on `PRACTICE_CREATED` projection; it doesn't backfill.
- **Why it's a problem:** Practices created pre-audit-#18 may show a HIPAA Security Officer GAP they didn't have before — or worse, fail an OCR audit because no §164.308(a)(2) Security Officer is designated.
- **Fix:** One-shot data backfill script that finds all practices with no `SECURITY` officer and emits an `OFFICER_DESIGNATED` event for the OWNER. OR document the gap and require operators to manually set it.
- **Effort:** S (one-shot script).

### CHROME-6 — MINOR — `Date conducted *` label has bare-asterisk required indicator without `aria-required`
- **Path:** `/programs/allergy` → Drills tab → "Log a drill" form
- **File:** `src/app/(dashboard)/programs/allergy/DrillTab.tsx` (LogDrillForm).
- **Observation:** Required fields show "*" suffix in the visual label but the inputs lack `aria-required="true"`. Screen readers won't announce "required" — pattern audit #12 should have caught.
- **Fix:** Add `aria-required="true"` to all required inputs in LogDrillForm + audit other forms shipped post-#12.
- **Effort:** S.

## Positive confirmations

| Fix | Status (live) | Evidence |
|---|---|---|
| Audit #1 — Allergy quiz `correctId` answer-key leak | **PASSING** | `/programs/allergy/quiz` HTML scan: 0 `correctId` / 0 `explanation` matches |
| Audit #4 — SRA wizard auto-save | **PASSING** | Selected radio + typed note, "Draft saved just now" indicator appeared within 1-2s |
| Audit #8 — Credentials Edit/Renew/Retire | **PASSING** | Edit form pre-fills all 6 fields correctly (title, license, issuer, dates, notes) |
| Audit #12 — ARIA / form labelling | **PASSING** | DOM scan of SRA / IncidentReport / AddCredential / NewDestruction / BulkCsvImport / BreachDeterminationWizard: 0 missing-name issues, 0 broken aria-labelledby refs |
| Audit #15 — History row Edit/Delete | **PASSING** | Drill row + fridge row both show Edit/Delete buttons in expanded state; edit forms render |
| OSHA Form 300 PDF | **PASSING** | `GET /api/audit/osha-300` returns 200 `application/pdf` |

## Verification limitations

- Did not test multi-state operating practices (single-state AZ practice only).
- Did not test STAFF/VIEWER role gating live (would require seeding a STAFF user). Code-review agents covered the gates statically.
- Did not test bulk-import end-to-end (would require uploading a CSV with seeded data).
- Did not test BAA token routes (no executed BAA in this practice).
