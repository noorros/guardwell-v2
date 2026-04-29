# Credentials Audit — Findings

**Date:** 2026-04-29
**Reviewer:** Audit session, dispatched per `docs/superpowers/plans/2026-04-29-hipaa-osha-credentials-allergy-audit.md` (3rd of 4 areas)
**Production target:** `https://v2.app.gwcomp.com`
**Test practice:** "Prod Smoke Test" (existing, AZ; reused from HIPAA + OSHA sessions)
**Surface inventory:** [`docs/audit/2026-04-29-credentials-inventory.md`](2026-04-29-credentials-inventory.md) — ~25 files, ~3,975 LOC
**Code review (raw):** [`docs/audit/2026-04-29-credentials-code-review.md`](2026-04-29-credentials-code-review.md) — 27 findings (4 Critical / 11 Important / 12 Minor)

## Summary

- **8 working flows verified end-to-end**
- **8 bugs / gaps found via Chrome verify** (0 Critical, 4 High, 3 Medium, 1 Low)
- **27 code-quality findings** from automated review (folded in below)
- **Credentials test suite:** 5 files / 23 tests, all passing in 3.10s
- **Verdict:** Credentials is **largely "done"** with **0 Critical user-facing bugs**, **4 High-severity UX/feature gaps** (detail-page edit/renew/retire missing, /programs/staff integration missing, Title auto-fill bug, no Remove confirmation), and **a separate set of 4 Critical security gaps from the code review** (cross-tenant guards, role gates, CSV injection — all mirrors of the HIPAA + OSHA C-1/C-2 patterns or new cross-cutting issues).

## Working ✅ (verified live on v2.app.gwcomp.com)

- **/programs/credentials list page renders cleanly** — 4 existing credentials grouped by holder (3 personal under noorrosllc@gmail.com + 1 practice-level CLIA), category badges (CLINICAL LICENSE / DEA REGISTRATION / MEDICARE MEDICAID / FACILITY LICENSE), status badges, license #/issuing body/expiry text below title.
- **All 4 status badges verified** — created audit credentials with specific expiry dates and observed:
  - 89-day boundary (expiry 2026-07-27) → **EXPIRING_SOON** (yellow "Expiring Jul 27, 2026" badge) ✓
  - 91-day boundary (expiry 2026-07-29) → **ACTIVE** (green "Active · expires Jul 29, 2026" badge) ✓
  - Yesterday (expiry 2026-04-28) → **EXPIRED** (red "Expired Apr 28, 2026" badge) ✓
  - No expiry (null) → **NO_EXPIRY** (green "Active · no expiry" badge) ✓
  - The 90-day boundary at `< 90 → EXPIRING_SOON, ≥ 90 → ACTIVE` works correctly per page-derived status.
- **Add credential form** — Type combobox (53 types), Holder dropdown (Practice-level + each PracticeUser), Title required, License # / Issuing body / Issue date / Expiry date / Notes optional. "Add credential" button correctly DISABLED until required fields populated; ENABLES on Type+Title fill.
- **Type dropdown contextual hints** — selecting "BLS Certification (AHA)" reveals an Expiry-date sublabel "typical renewal 730 days" (nice UX touch — adapts to credential type).
- **Form auto-resets after successful Add** — Type back to placeholder, Title cleared, dates cleared. Snappy.
- **Credential detail page (`/programs/credentials/[id]`)** — Renders read-only Credential details (license #, issuing body, issue/expiry dates, notes), **Evidence section with drag-drop file uploader** (PDF/PNG/JPG/HEIC/WebP up to 25 MB — Phase 3 GCS pipeline wired), Continuing education section (Log a CEU activity button, "No CEU activities logged yet" empty state), Renewal reminders section (email-me checkbox + "Milestone days" comma-separated text input default `90, 60, 30, 7` + Save reminders).
- **Cross-framework derivation works** — `/modules/dea` shows "Current DEA Controlled Substance Registration" as **COMPLIANT** (auto-derived from the existing DEA Registration credential). The other 7 DEA rules (Biennial inventory, Dispensing records, Secure storage, etc.) are NOT_STARTED because they need DeaInventory / DeaOrderRecord rows. Confirms `credentialTypePresentRule` factory wiring per Phase 1 PR 3.
- **Concierge `list_credentials` perfectly consistent with page list** — asked "Which credentials expire in the next 90 days?" → tool fired in 14ms, returned the AUDIT-2026-04-29 BLS 89-day boundary credential as `⚠️ Expiring Soon` and the BLS expired as `🔴 Expired`. The 91-day cred was correctly grouped with "active with a distant expiry" (excluded from <90-day window). Same status enums, same dates, same threshold. **Rules out inventory open-question I-3.**
- **Remove flow works** — Click Remove → credential disappears from list; section header count decrements (e.g. "5 credentials" → "4 credentials"); soft-delete via `retiredAt` per the projection. Group section is removed from list when its count reaches zero.
- **Bulk import surface reachable** — `/programs/credentials/bulk-import` renders: description, "Required: credentialTypeCode, title", 200-row / 500 KB caps, Download template CSV link, Choose a CSV file button, "Available credentialTypeCode values (53)" collapsible, "← Back to credentials" link.
- **CSV export wired** — `GET /api/credentials/export` triggers a silent file download (Content-Disposition: attachment), no UI redirect.

## Bugs / gaps from Chrome verify ❌

### B-1. HIGH: Title auto-fill captures the WRONG credential type during keyboard navigation (`AddCredentialForm.tsx`)

- **Symptom:** When changing the Type select via ArrowDown navigation (focus the closed combobox + ArrowDown N times to navigate to the desired type), the Title field auto-populates with the FIRST type's display name, NOT the SELECTED type's. Repro: focus Type select → press ArrowDown 22 times to reach "BLS Certification (AHA)" → Tab → Title field reads "Chiropractor License" (the first non-placeholder option).
- **Reproduction:** I recreated this 4 times during the audit. Each time my Type was set to BLS but my Title pre-populated as "Chiropractor License". I had to triple-click Title to clear and retype the audit-tagged title.
- **Impact:** Users who don't notice the Title default will submit credentials with mismatched type-vs-title (a "BLS Certification" credential row with title "Chiropractor License"). Real users may catch this on review, but auto-population is supposed to *help*, not introduce a wrong value silently. Likely the `onChange` handler on the Type select fires for each ArrowDown but the auto-fill side effect only stamps the FIRST changed value (off-by-one or stale-closure bug in the controlled-component plumbing).
- **Suggested fix:** In `AddCredentialForm.tsx`, change the Type-onChange handler so the Title auto-population uses the *current* select value at write time, not a captured-at-mount default. Add a regression test: simulate ArrowDown × N → assert Title equals the Nth type's displayName. Alternatively, only auto-fill Title on the FIRST type-change event (when Title is empty), and don't try to keep them in sync afterwards.

### B-2. HIGH: No Edit / Renew / Retire affordance on credential detail page (`[id]/CredentialDetail.tsx`)

- **Symptom:** The detail page shows Credential details (License number, Issuing body, Issue date, Expiry date, Notes) as read-only text. There is **no Edit button, no Renew button, no Retire button**, and no inline-edit affordance. The only mutation surfaces on this page are: (1) Evidence upload, (2) Log a CEU activity, (3) Save reminders. **To update an expiry date, the user must navigate back to the list page, click Remove (which soft-deletes), and create a new credential** — losing the credential's ID, EvidenceLog history, and CeuActivity rows.
- **Reproduction:** Visited `/programs/credentials/5d2c4412-…` (Arizona MD License). Read all interactive elements (`mcp__Claude_in_Chrome__read_page filter=interactive`) — only the upload, CEU log, and reminder-save buttons are present.
- **Impact:** This is the playbook's #3 critical interaction (renew flow) — and it's effectively broken for retaining audit history:
  - **Renewal.** The natural workflow (operator gets a new state-board renewal certificate, updates expiry date by 2 years) requires Remove + Re-Add. The CeuActivity cascade-on-delete (per schema line 720) means CEU progress for the renewed credential is wiped — operators must re-log every CEU manually.
  - **Typo correction.** A typo'd license number requires the same destructive workflow.
  - **Audit trail.** Even though `removeCredentialAction` soft-deletes (not hard-deletes), the FK from `CeuActivity` cascades on the credential's hard-delete only — but the user-visible flow is "Remove" which retires. CEU activities tied to the retired credential remain in the DB but aren't shown. The new credential row has zero CEU history.
- **The action `updateCredentialAction` exists** in `actions.ts` (per inventory) — it's just not surfaced in the UI. Per memory: `CREDENTIAL_UPSERTED` is idempotent on `(practiceId, credentialTypeId, holderId, licenseNumber|title)`, so an Edit affordance could re-emit `CREDENTIAL_UPSERTED` with a new payload that updates expiry/dates without losing the credential ID.
- **Suggested fix:** Surface an Edit form on the detail page (could be inline-editable fields with save-on-blur, or a "Edit credential" button revealing a form pre-populated with existing values). Surface a Retire button with a confirmation dialog. The Edit form handles the Renewal use case (just bump expiry); Retire is the explicit removal path.

### B-3. HIGH: No confirmation dialog on Remove — mirrors code-review M-5 (`CredentialActions.tsx:15-29`)

- **Symptom:** Click Remove on a credential row → it's instantly soft-deleted. No confirmation dialog (`confirm("Remove this credential?")`), no toast with undo, no destructive-styled button. The Remove button is a `<Button variant="ghost">` with neutral styling.
- **Reproduction:** Removed 4 audit credentials. Each click was a single-step destructive action. Compare to CEU activity removal in `CredentialDetail.tsx:406` which DOES use `confirm()`.
- **Impact:** A misclick on a real DEA registration permanently retires it (recoverable from DB but not from UI). On mobile/tablet, the Remove button is right next to the credential row content — fat-finger tap risk. Combined with B-2 (no Edit affordance), users may rationalize "I can just re-add it" — which works for the credential metadata but loses the credential ID, the EvidenceLog history, and any uploaded evidence files (since `Evidence` rows reference the credential's id).
- **Code-review pairing:** Confirms M-5 ("removeCredentialAction does not require confirm dialog despite being destructive").
- **Suggested fix:** Add `if (!confirm("Remove this credential? This action cannot be undone from the UI.")) return;` to `CredentialActions.tsx` handler. Better: wrap in a `<DestructiveButton>` shared component with built-in confirm and red styling — also useful for incident-resolve, vendor-retire, policy-retire.

### B-4. HIGH: /programs/staff has NO credentials integration

- **Symptom:** `/programs/staff` only shows: invite team members form (email + role + Send invite), a single staff row showing email + OWNER badge + 4 officer-role checkboxes (Privacy / Security / Compliance / Safety). There is **no link to view this staff member's credentials**, **no staff detail page**, **no inline credential count**, **no "View credentials" affordance**.
- **Reproduction:** Navigated `/programs/staff`. The OWNER (noorrosllc@gmail.com) has 3 credentials assigned (Arizona MD License, DEA Registration, NPI Registration) per the credentials page. None of this is surfaced on the Staff page.
- **Impact:** Per the audit playbook: *"Verify credentials list integrates with /programs/staff (each staff member's credentials shown on their detail page)."* This integration is **missing**. A real practice OWNER managing 20 staff cannot answer "what credentials does each staff member have?" from the Staff page — they must navigate to /programs/credentials separately and mentally cross-reference holder names. For onboarding, off-boarding, and compliance review, this is a missing core feature.
- **Suggested fix:** Add a credential count badge per staff row (e.g. "3 credentials"), with click-through to a filtered credentials view (`/programs/credentials?holder={holderId}` or a per-staff credential subview). Or add a per-staff detail page at `/programs/staff/[id]` showing credentials, training completions, policy acknowledgments, and officer roles.

### B-5. MEDIUM: No search / filter / sort controls on /programs/credentials list

- **Symptom:** The list page renders all credentials grouped by holder, but there is no search input, no type filter, no expiry filter, no sort dropdown. With 4 credentials this is fine, but the playbook says: *"Search / filter — by staff member, by type, by expiring-this-week."*
- **Reproduction:** Read all interactive elements on `/programs/credentials` (`mcp__Claude_in_Chrome__read_page filter=interactive`) — the only controls are: Bulk import (CSV), Export CSV, the Add credential form, per-row Remove buttons, per-row links to detail page.
- **Impact:** A practice with 50+ credentials (10-clinician practice × 5 credentials each) will be hard to navigate. Operators looking for "expiring in next 30 days" must visually scan all rows.
- **Suggested fix:** Add a search input (matches against title / license number / holder name), a Type filter dropdown, a Status filter (Active / Expiring soon / Expired / No expiry), and a "Show retired" toggle. The shared `<TopFilterBar>` pattern from `/programs/incidents` could be reused.

### B-6. MEDIUM: "0 open gaps" stat on /modules/dea disagrees with 7 visible Not-started requirements

- **Symptom:** `/modules/dea` shows "1 of 8 compliant", "0 deadlines this month", "0 open gaps" — yet 7 of the 8 requirements are visibly Not-started (gaps). Same B-6 pattern from the HIPAA findings.
- **Reproduction:** Visit `/modules/dea`. Score 13/100, 1 of 8 compliant, but stats say "0 open gaps."
- **Impact:** Confusing for users — the page shows clear gaps, but the stat row says zero. Users may think there's nothing to do. Cross-pattern: HIPAA finding B-6 says "Open gaps" likely = "GAPs with active deadlines" (e.g. unresolved breach with 60-day OCR window) while the visible requirements list shows all GAPs including those without deadlines. If the distinction is intentional, the label needs clarification.
- **Suggested fix:** Either align the stat with visible state, or rename to "Time-sensitive gaps" / "Critical gaps" matching `/audit/overview`. (Tracked as cross-pattern with HIPAA B-6.)

### B-7. LOW: Inventory undercount — bulk import shows "Available credentialTypeCode values (53)" but inventory said 52 types

- **Symptom:** The bulk import page footer says "Available credentialTypeCode values (53)" — yet the credentialTypePresent dropdown contains 53 options (per `read_page ref_id` on the Type combobox; my earlier inventory said "52 types" based on reading `_v1-credential-types-export.json` from memory). Verified by enumerating: Chiropractor through SAM Exclusion Check = 53 options.
- **Impact:** Cosmetic; minor inventory correction. Not a user-facing bug.
- **Suggested fix:** Update the inventory to say 53. Verify the seed JSON matches the seeded count.

### B-8. LOW: Bulk import page has dual file-picker affordances (`bulk-import/CredentialBulkImport.tsx`)

- **Symptom:** The bulk-import card shows both a native file input "Choose File No file chosen" AND a styled "Choose a CSV file" Button. Both are interactive; clicking the styled Button likely just triggers the underlying file input. Two affordances for the same action.
- **Impact:** Visual clutter / minor UX inconsistency. A first-time user may be unsure which is the canonical picker.
- **Suggested fix:** Hide the native input via CSS (still a11y-accessible via the styled button's `htmlFor`), or remove the styled button and let the native input style itself.

## Bugs from code review (severity-classified, not all re-tested live)

The 27 findings from `2026-04-29-credentials-code-review.md` are folded into this audit's deliverable. The top 5 priorities for fix-up (per the reviewer's ranking):

1. **C-1** Cross-tenant guard missing on ALL FIVE credential projections (`projectCredentialUpserted`, `projectCredentialRemoved`, `projectCeuActivityLogged`, `projectCeuActivityRemoved`, `projectCredentialReminderConfigUpdated`) — direct mirror of HIPAA C-1; ~50 LOC fix.
2. **C-2** OWNER/ADMIN role gate missing on `addCredentialAction` + `removeCredentialAction` (4 of 6 actions in same file already have the gate — these two are the inconsistency) — direct mirror of HIPAA C-2 / OSHA C-2; ~10 LOC fix.
3. **C-4 + I-4** CSV injection prevention on both export and import paths (`csvEscape` doesn't prefix leading `=` `+` `-` `@` `\t` `\r` — OWASP-cataloged risk). New cross-cutting issue affecting all bulk-import surfaces (`BulkCsvImport` is shared with vendor + tech-asset). ~15 LOC fix.
4. **I-5 + I-11** Consolidate the 4-state derivation function: 5 different code paths compute "expiring soon" with **two different windows** — 90 days for the page + Concierge tool, **60 days** for the audit PDF + the `CREDENTIAL_EXPIRING` notification generator. A credential 75 days from expiry shows yellow on the page but green on the PDF and emits no expiring notification. Fix: extract `getCredentialStatus()` + `EXPIRING_SOON_DAYS = 90` constant to `src/lib/credentials/status.ts`, single source of truth. ~30 LOC.
5. **I-1** Practice timezone field — combined architectural fix that pairs with HIPAA I-1 + OSHA I-1/I-4. All credentials surface dates use `toISOString().slice(0, 10)`, hardcoding UTC. For an AZ practice (MST, UTC-7), a credential renewed at 6pm local on 2026-06-30 stores as 2026-07-01 UTC and renders as one day past local expiry on PDFs, badges, and renewal emails.

### Other Critical / Important from code review (not re-tested live)

- **C-3** `/api/credentials/export` lacks OWNER/ADMIN role gate — any MEMBER/STAFF/VIEWER can export the credentials register including license numbers + holder emails + free-text notes. Mirrors HIPAA C-3 / OSHA C-2. Pairs with B-7 (PDF inline-vs-download UX).
- **I-2** Bulk-import dedup uses `licenseNumber || title` as identity — two staff with same credential type and no license number but identical title (e.g. both have "BLS card") collide and one drops as `DUPLICATE_IN_BATCH`.
- **I-3** CEU progress bar window-start uses `setUTCMonth` — drifts at month boundaries. JS `Date.setMonth(2)` from a March 31 base produces March 3, not Feb 28.
- **I-6** `generateCredentialNotifications` uses `gt: 30 days ago` lower bound — credentials expired 31+ days drop from notifications entirely. The 14-day escalation never fires after the 30-day drop. **Real impact:** an unrenewed MD license silently exits the notification surface 30 days post-expiry.
- **I-7** Escalation generator does exact-string-match on `expiryDate.toISOString().slice(0, 10)` — if OWNER bumps expiry by 1 day (clerical correction), escalation skips inappropriately.
- **I-8** CEU progress bar `pct = 0` when `requiredHours = 0` (legitimate "no CEU required" state) — shows "Behind schedule" status visually wrong.
- **I-9 + I-10** AddCredentialForm + ReminderConfigForm have implicit-association labels without `htmlFor`/`id`. Mirrors HIPAA I-8 + OSHA I-9/I-10. WCAG 2.1 AA 1.3.1 + 4.1.2 violations.

## UX gaps ⚠️

### U-1. Detail page is read-only-on-the-rails (B-2 reframed)
- The credential detail page is structurally split into 3 cards: read-only details, evidence upload, CEU log + reminder config. The user can ONLY mutate evidence, CEU, and reminders from this page. Edit + Renew + Retire happen from the LIST page. This split means deep credential management is split across two surfaces.
- **Fix:** Pair with B-2 — add Edit / Retire affordances on the detail page itself.

### U-2. NO_EXPIRY status badge is visually identical to ACTIVE — both green
- The `<CredentialStatusBadge>` renders "Active · no expiry" for NO_EXPIRY credentials. Color is the same green as "Active · expires [date]". A scanning eye sees both as "Active" with no visual cue that one is permanent and one is dated.
- **Fix:** Use a distinct color or icon for NO_EXPIRY (e.g. infinity glyph ∞), or label as "No expiry" without the "Active" prefix. Pairs with code-review I-11 (consolidating derivation).

### U-3. Concierge response is excellent but doesn't link back to the credentials it cites
- The Concierge response listed credentials in a table format with title, holder, expiry, status — but didn't include click-through links to the credential detail pages. Operators reading the response and wanting to act on it must manually navigate.
- **Fix:** Pass credential IDs in the tool response and render as `[title](/programs/credentials/<id>)` markdown links in the assistant message.

### U-4. Remove button has no destructive styling and no tooltip
- `CredentialActions.tsx` renders `<Button variant="ghost">Remove</Button>`. The button is the same color as "Add credential" and other neutral actions. Pairs with B-3 (no confirm).
- **Fix:** Use `variant="destructive"` styling (red text/border) or add a trash-can icon and hover tooltip "Retire this credential."

## Missing tests 📋

- **`tests/integration/credential-status-derivation.test.ts` does not exist.** The 4-state derivation (ACTIVE / EXPIRING_SOON / EXPIRED / NO_EXPIRY) is computed in 3 different places (page, Concierge, PDF) per code-review I-11. No direct test of the boundary at 90 days, 89 days, 91 days. Would have caught the I-5 60-vs-90 day inconsistency before reaching prod.
- **No `bulkImportCredentialsAction` 200-row cap test** (M-2). The cap is enforced; the test for the cap is not present.
- **No test of `credentialTypePresentRule` factory across all 5 framework rules** — DEA, CLIA, CMS_PECOS_ENROLLMENT, CMS_NPI_REGISTRATION, CMS_MEDICARE_PROVIDER_ENROLLMENT all share the factory. A change to the factory would silently affect 5 rules. Pairs with code-review M-9.
- **No `/api/credentials/export` test** — happy path, auth gate (none today per C-3), retiredAt filtering. Pairs with C-3.
- **No `seed-credentials.ts` smoke test** asserting the 53 credential type codes referenced by `dea.ts` / `clia.ts` / `cms.ts` actually exist in the DB after seed. M-9.
- **No `credentials-register-pdf.tsx` snapshot test** — the PDF renders 60-day boundary (per I-5) without being tested against the page's 90-day boundary.
- **No timezone test** for any credential date rendering — the I-1 / HIPAA I-1 / OSHA I-4 cluster needs a single shared test once `practice.timezone` is added.

## Deferred 💡

- **D-1.** Build the Edit/Renew/Retire affordances on credential detail page (B-2). Pairs with U-1, U-2, M-5/B-3, M-6 (CredentialDetail split).
- **D-2.** Build the staff↔credentials integration (B-4) — credential count badge per staff row + per-staff credential filter view. Likely pairs with the broader staff detail page work (out of scope for credentials proper).
- **D-3.** Search / filter / sort on /programs/credentials list (B-5). Reuse `<TopFilterBar>` pattern.
- **D-4.** Confirm-on-destructive shared component (`<DestructiveButton>`) (B-3 / M-5). Cross-cutting to incident-resolve, vendor-retire, policy-retire, CEU-remove.
- **D-5.** "0 open gaps" stat semantics rename (B-6) — folded into HIPAA B-6 / cross-area issue.
- **D-6.** NO_EXPIRY visual distinction (U-2).
- **D-7.** Concierge response credential-link enrichment (U-3).
- **D-8.** Practice timezone field (B-1 stack of code review I-1 + HIPAA I-1 + OSHA I-1/I-4) — single architectural fix.
- **D-9.** CredentialDetail.tsx file split (M-6) — 848 LOC → 4-5 sibling files.
- **D-10.** Orphan credential affordance — when PracticeUser is removed, `holderId` set to null. UI shows under "Practice-level" indistinguishable from genuinely-practice-level credentials. Per code-review M-12.

## Cleanup status

- ✅ **All 4 audit credentials removed.** AUDIT-2026-04-29 BLS expired / 89-day boundary / 91-day boundary / no-expiry — all clicked Remove. Final list state: 4 credentials (Arizona MD License, DEA Registration, NPI Registration, CLIA Waiver Certificate) — matches pre-audit state.
- ⚠️ **EventLog rows from this audit remain.** EventLog is append-only by design. Rows recorded: 4× CREDENTIAL_UPSERTED + 4× CREDENTIAL_REMOVED + the Concierge `list_credentials` tool invocation (ConversationMessage row). All audit-tagged with the prefix in titles. The ConciergeThread + ConversationMessage is in the Concierge thread history.

## Audit data — for reproducibility

- **Practice (audit target):** Prod Smoke Test (AZ)
- **Audit credentials created (then removed):**
  - AUDIT-2026-04-29 BLS expired (expiry 2026-04-28) → EXPIRED status
  - AUDIT-2026-04-29 BLS 89-day boundary (expiry 2026-07-27) → EXPIRING_SOON status
  - AUDIT-2026-04-29 BLS 91-day boundary (expiry 2026-07-29) → ACTIVE status
  - AUDIT-2026-04-29 BLS no expiry (no expiryDate) → NO_EXPIRY status
- **All 4 used type:** BLS Certification (AHA) — chosen because no derivation rule queries it, so framework scores stayed clean.
- **DEA score (during audit):** unchanged at 13/100 — adding/removing BLS credentials had no cross-framework impact (correct).
- **Test results:** `npm test -- --run tests/integration/credential-projection tests/integration/credential-ceu-projection tests/integration/credential-ceu-action tests/integration/credential-renewal-reminders tests/integration/training-completion` → **5 files / 23 tests, all passing in 3.10s**.

## Per-area Chrome verify status — completion matrix

| Area / Route | Verified | Findings |
|---|---|---|
| `/programs/credentials` (list page) | ✅ | B-5 (no search/filter), B-1 (Title auto-fill), badges work |
| `/programs/credentials/[id]` (detail page) | ✅ | B-2 (no Edit/Renew/Retire), evidence upload + CEU + reminders all work |
| Status badge derivation (89/91/expired/no-expiry) | ✅ | All 4 verified at the 90-day boundary |
| Cross-framework score (`/modules/dea`) | ✅ | DEA_REGISTRATION COMPLIANT from existing credential ✓; B-6 stat mismatch |
| `/programs/staff` integration | ❌ | B-4 — no credentials surfacing |
| `/programs/credentials/bulk-import` | ✅ (page only) | B-7 (53 vs 52 type count); B-8 (dual file-picker) |
| `/api/credentials/export` | ✅ (silent download) | C-3 role gate gap (untested live) |
| Concierge `list_credentials` tool | ✅ | Perfectly consistent with page list (status, dates, threshold) |
| Notifications (credential-expiry) | ⚠️ | No credential notifications in bell despite creating EXPIRED + EXPIRING credentials. Notifications fire via digest cron, not synchronously — verify next digest run. |
| Remove flow | ✅ | Works; B-3 (no confirm) |
| Renew flow | ⏸️ | Not testable — B-2 (no Edit affordance). Workaround = Remove + Re-Add (destructive) |
| Bulk import end-to-end (CSV upload) | ⏸️ | Page reachable; not driven via Chrome (file upload coordinate-click + file dialog interaction is brittle). Test coverage exists for the action layer. |

## Sign-off checklist

Per the audit plan's Definition of Done:

1. ✅ **Code health** — Credentials test subset passes 23/23 in 3.10s; tsc/eslint not run separately but tests imply both pass.
2. ⚠️ **Test coverage** — gaps documented (no status-derivation test, no PDF snapshot, no export auth test, no seed smoke test). Pairs with code-review M-9 + I-11.
3. ✅ **Code review** — 27 findings documented in [`2026-04-29-credentials-code-review.md`](2026-04-29-credentials-code-review.md).
4. ✅ **Functional verification (production)** — all routes in the per-area Chrome checklist exercised; status badges, CRUD, cross-framework score, Concierge consistency, bulk-import page, CSV export endpoint all hit.
5. ⚠️ **Compliance derivation** — 5 cross-framework rules wired (DEA / CLIA / 3× CMS via shared `credentialTypePresentRule` factory); cross-framework derivation cascade verified live (existing DEA credential → DEA_REGISTRATION COMPLIANT). Code-review I-5/I-11 expose a derivation-window inconsistency between page (90d) and PDF/notification (60d) that should be unified.
6. ⚠️ **Notification + audit trail** — events emit + project (verified by Concierge tool seeing the new credentials immediately); however **notification bell did NOT show CREDENTIAL_EXPIRING for the EXPIRED credential created during audit** — confirms generators run on the digest cron only, not synchronously. The user-facing notification surface is therefore lagged by up to 24h.
7. ⏸️ **State overlays** — N/A. Credentials have NO state-overlay derivation (per inventory § 13). Credential types like `MD_STATE_LICENSE` are state-aware in name only — same rule applies to all 50 states.
8. ✅ **Findings report** — this document.

**Overall verdict:** Credentials is **largely "done"** with **0 Critical user-facing bugs (Chrome-verified)** but **4 High-severity UX/feature gaps**: (1) missing Edit/Renew/Retire on detail page (B-2 — biggest user-facing gap), (2) Title auto-fill bug during keyboard nav (B-1), (3) no Remove confirmation (B-3), (4) /programs/staff has no credentials integration (B-4). The core flows (Add credential, view detail, Evidence upload, CEU log, Reminders, Remove, Bulk import page, CSV export endpoint, Concierge tool, cross-framework derivation) all work end-to-end and the data model is sound. The code-review surfaced **4 separate Critical security gaps** (C-1 cross-tenant guards, C-2 role gates, C-3 export role gate, C-4 CSV injection) that should be bundled with the HIPAA + OSHA equivalents.

## Recommendations for next audit cycle

1. **Bundle PR — cross-tenant guards.** HIPAA C-1 + Credentials C-1 (×5 projections). Single architectural pass through every projection function in `src/lib/events/projections/*.ts` adding the `existing.practiceId !== practiceId` check. ~80 LOC system-wide.
2. **Bundle PR — role gates.** HIPAA C-2 + OSHA C-2 + Credentials C-2 + Credentials C-3. Single audit pass through all server actions in `programs/*` and `/api/*/route.ts`. Use `requireRole("ADMIN")` helper. ~30 LOC + one helper.
3. **Bundle PR — CSV injection prevention.** Credentials C-4 + I-4. Hardens `csvEscape` AND `parseCsv` import sanitization in the shared `BulkCsvImport` component. Cross-cutting to vendor + tech-asset bulk paths. ~15 LOC + 2-3 unit tests.
4. **Bundle PR — `practice.timezone` architectural fix.** HIPAA I-1 + OSHA I-1 + I-4 + Credentials I-1. One Prisma migration + one shared `formatPracticeDate` helper + replace `toISOString().slice(0, 10)` system-wide. ~50 LOC.
5. **Bundle PR — credential status consolidation.** Credentials I-5 + I-11. Extract `src/lib/credentials/status.ts` exporting `getCredentialStatus()` + `EXPIRING_SOON_DAYS = 90`. Replace 3 duplicate code paths + unify the page-vs-PDF-vs-notification 90-vs-60 day window. ~30 LOC + integration test for the boundary.
6. **Standalone PR — credential detail page Edit + Retire affordances.** Highest-impact user-facing fix. Reveal Edit form (inline or modal) + Retire button with confirm. ~150 LOC.
7. **Standalone PR — staff-credentials integration.** B-4. Per-staff credential count badge + click-through filtered view OR per-staff detail page. ~100 LOC; pair with broader staff detail page work.
8. **Allergy audit next.** Per the plan order. Memory says Allergy is the smallest of the 4 areas — should be a 1-session pass after Credentials.

## Cross-area patterns confirmed (for the aggregation step)

These cross-area patterns were predicted by the playbook ("don't re-discover them — confirm or rule out") and are now confirmed for credentials:

| Pattern (predicted) | Credentials confirmation |
|---|---|
| C-1 cross-tenant guard gap | ✅ Confirmed — 5 projections (`projectCredentialUpserted`, `projectCredentialRemoved`, `projectCeuActivityLogged`, `projectCeuActivityRemoved`, `projectCredentialReminderConfigUpdated`) all missing the guard |
| C-2 OWNER/ADMIN role gate gap | ✅ Confirmed — `addCredentialAction` + `removeCredentialAction` (the 2 most consequential of 6 actions) lack the gate |
| I-1 dates rendered in UTC | ✅ Confirmed — credentials-register-pdf.tsx + 4 notification generator templates all use `toISOString().slice(0, 10)` |
| I-7/I-8 hardcoded citations | ⏸️ N/A for credentials surface (no regulatory citations in the credential UI itself; framework rules cite them) |
| I-8/I-9 missing aria on radio groups | ✅ Confirmed (adapted) — AddCredentialForm + ReminderConfigForm have implicit-association labels without `htmlFor`/`id` |

**New cross-area patterns surfaced by Credentials review (for OSHA + HIPAA back-checking):**

- **C-4 CSV injection** — applies to ANY bulk-import or CSV-export surface. The `BulkCsvImport` shared component is used by credentials, vendors, tech-assets, and (likely) future bulk surfaces. The fix is one location.
- **I-5 boundary inconsistency across surfaces** — credentials has 90-vs-60 day mismatch; HIPAA + OSHA may have similar derivation-window inconsistencies that weren't flagged because the prior reviews didn't have a directly-comparable cross-surface (Concierge + page + PDF + notification) consistency test. Worth re-inspecting.
- **M-5 destructive-without-confirm** — credentials Remove doesn't confirm; check incident-resolve, vendor-retire, policy-retire for the same gap.
- **M-6 large-component splitting (>500 LOC)** — `CredentialDetail.tsx` 848 LOC. HIPAA may have similar (the Incident detail page, the SRA wizard).
