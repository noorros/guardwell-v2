# Credentials findings — 2026-04-30 (second audit)

**Date:** 2026-04-30
**Reviewer:** Static code-review agent (read-only)
**Scope:** `src/app/(dashboard)/programs/credentials/`, `src/lib/credentials/status.ts`, `src/lib/events/projections/credential.ts`, `src/lib/notifications/generators.ts` (credential generators), `src/lib/audit/credentials-register-pdf.tsx`, `src/app/api/audit/credentials-register/`, `src/app/api/credentials/export/`, `src/components/gw/EvidenceUpload/`, related Concierge tools.
**Prior audit:** [`2026-04-29-credentials-findings.md`](2026-04-29-credentials-findings.md). Recent merges in scope: PR #201 (audit #3 role gates), PR #202 (audit #2 cross-tenant), PR #204 (audit #8 Edit/Renew/Retire), PR #205 (audit #18), PR #207 (audit #16 EXPIRING_SOON), PR #209 (audit #11 citations), PR #212 (audit #12 ARIA — touched AddCredentialForm).

## Inventory
- ~25 credential-related source files reviewed.
- **24 findings: 5 Critical / 10 Important / 9 Minor.**

## Critical (5)

### CR-1 — Edit AND Renew in `CredentialMetadataPanel` silently null the holder on every save
- **Files:** `programs/credentials/[id]/CredentialMetadataPanel.tsx:222-231` (Edit), `:380-392` (Renew); server side at `programs/credentials/actions.ts:152-162` and `lib/events/projections/credential.ts:79-89`.
- **What's wrong:** Both forms call `updateCredentialAction({...})` without passing `holderId`. The Zod schema treats `holderId` as `.optional().nullable()`, so missing → `undefined` → server emits `holderId: parsed.holderId ?? null`. The projection unconditionally writes `holderId: payload.holderId ?? null`. Net: clicking "Save changes" or "Save renewal" on Dr. Jane's AZ MD License removes Dr. Jane and reverts the row to practice-level.
- **Why it matters:** This is the single most-used surface added by audit #8 (PR #204 specifically about preserving the credential id + history through Renew). The fix preserved CEU rows / Evidence rows but silently broke holder ownership. After Renew, the credentials page re-renders and the credential moves from "Dr. Jane" section into "Practice-level" section with no warning.
- **Audit-defense impact:** YES — state-board renewal evidence packets are now mis-attributed; framework-rule derivation that aggregates per-holder gets confused; the audit trail event payload records `holderId: null` so the audit log shows no continuity.
- **Why prior tests didn't catch it:** `tests/integration/credential-update.test.ts` covers role gates, cross-tenant guards, retired-cred, holderId-from-other-practice, and credentialTypeCode preservation — but has no positive test of "holder is preserved through Edit/Renew."
- **Fix (preferred):** Server-side: change `updateCredentialAction` to read existing row's `holderId` and use that as the default when payload omits it. Makes "field omitted = preserve" the contract for ALL edge cases.
  ```ts
  holderId: parsed.holderId === undefined ? existing.holderId : (parsed.holderId ?? null),
  ```
- **Effort:** S (~5 LOC + 1 test).

### CR-2 — Credentials registry PDF endpoint lacks OWNER/ADMIN role gate
- **File:** `src/app/api/audit/credentials-register/route.tsx:18-40`.
- **What's wrong:** Authenticates via `requireUser()` + `getPracticeUser()` but performs no role check. Any STAFF/VIEWER can hit this endpoint and receive a PDF containing every active credential's `licenseNumber`, holder full name, holder email, issuingBody, issueDate, expiryDate. Audit #3 PR #201 specifically added a 403 to BOTH the OSHA 300 and credentials CSV (`/api/credentials/export:28-30`) — but missed this PDF route. Linked from `/audit/reports/page.tsx:68`, surfaced to all roles.
- **Audit-defense impact:** YES — VIEWER/contractor with read-only program access can exfiltrate the full HR-sensitive credentials register (DEA number, state license number, malpractice policy number) in a single GET. PDF is `Content-Disposition: inline` so it renders in-browser — no download trail in browser history, harder to detect leak.
- **Fix:** Add at line 28:
  ```ts
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```
- **Effort:** S.

### CR-3 — Activity log page exposes `licenseNumber` in CREDENTIAL_UPSERTED events to STAFF/VIEWER
- **Files:** `src/app/(dashboard)/audit/activity/page.tsx:99` (no role gate); `src/lib/audit/format-event.ts:164-170` renders `detail: p.licenseNumber ? "#${...}" : null` for every CREDENTIAL_UPSERTED event.
- **What's wrong:** `/audit/activity` only checks `getPracticeUser()` — any role can browse. The "credentials" category chip filters to CREDENTIAL_UPSERTED + CREDENTIAL_REMOVED, which renders `detail: #<licenseNumber>` for every save. STAFF/VIEWER sees DEA number, state license number, malpractice number for every staff member's credential without ever loading the credentials surface.
- **Audit-defense impact:** YES — bypass of CR-2 / audit #3's role gate. CR-2 closes the bulk-export hole; this leaks the same data row-by-row through the audit trail. Especially pernicious because the activity log is sold as "transparency for compliance" — STAFF trusts it for their training events but inadvertently sees licenseNumber for everyone.
- **Fix:** Either (a) gate `/audit/activity` page to OWNER/ADMIN+; (b) redact `detail` for CREDENTIAL_UPSERTED when viewer isn't OWNER/ADMIN; (c) move licenseNumber out of the rendered detail entirely. Option (b) is the smallest diff and preserves audit-trail visibility for staff while hiding sensitive fields.
- **Effort:** S.

### CR-4 — Removed-staff credentials silently disappear from `/programs/credentials` list
- **File:** `src/app/(dashboard)/programs/credentials/page.tsx:32-74` (especially `orderedKeys` build at lines 69-74).
- **What's wrong:** Page line 33 fetches `holders` filtered to `removedAt: null`. Lines 44-49 fetches all `credentials` (no holder-removed filter). `orderedKeys` (line 69) iterates `holders.map(h => h.id).filter(id => grouped.has(id))` — only IDs in the active-holders list. If a credential's `holderId` points to a `PracticeUser` whose `removedAt != null`, the credential is grouped under that key but the key isn't in `orderedKeys`, so the credential is never rendered. CSV export and credentials-register PDF DO render the row (with the removed holder's name).
- **Audit-defense impact:** YES — operator off-boards Dr. Jane (sets her PracticeUser.removedAt). Dr. Jane's DEA registration silently vanishes from the credentials page. The DEA registration is still active (`retiredAt: null`), still counts toward `DEA_REGISTRATION` framework rule, still appears on the auditor's PDF. State board renewal can't be tracked. **Worst-case: orphaned DEA number with no UI to renew it.**
- **Fix (preferred):** Remove the `orderedKeys` `.filter` on line 71-72 and keep all grouped keys, falling back to "Former staff" label when `holderNameById` doesn't have the id. Re-include `removedAt: { not: null }` PracticeUsers in the page query. Pairs with CR-1 fix (which would prevent the holder being silently nulled in the first place).
- **Effort:** M.

### CR-5 — `bulkImportCredentialsAction` crashes on a single malformed date
- **File:** `programs/credentials/actions.ts:310-315`.
- **What's wrong:** `issueDate: row.issueDate ? new Date(row.issueDate).toISOString() : null`. The Zod schema accepts `z.string().nullable().optional()` with no date format check. The client-side `parseDateOrISO` validates dates, but a direct API POST that bypasses the UI sends `{ issueDate: "garbage" }`. `new Date("garbage")` is `Invalid Date`; `.toISOString()` throws `RangeError: Invalid time value`. The throw escapes the per-row try/catch (the `for` loop has none), aborting the entire import and rolling back the half-completed transaction.
- **Audit-defense impact:** NO (correctness issue) but the UI per-row "INVALID" status is bypassed.
- **Fix:** Wrap the date conversion in a per-row try/catch that emits `{ status: "INVALID", reason: "issueDate could not be parsed" }`, or harden the Zod schema with `.refine` checking `Date.parse`.
- **Effort:** S.

## Important (10)

### IM-1 — `generateCredentialNotifications` 30-day past-expiry drop unfixed
- **File:** `src/lib/notifications/generators.ts:117`. `expiryDate: { lte: horizon, gt: new Date(Date.now() - 30 * DAY_MS) }` — past-expiry credentials drop after 30 days. Cascade: 14-day escalation generator fires on stale unread `CREDENTIAL_EXPIRING` rows — but if no rows were ever created, escalation never fires. **Fix:** Drop the `gt:` bound. Dedup via the date-string entityKey.

### IM-2 — Renew form defaults all credentials to +1 year — wrong for DEA (3yr), CPR/BLS (2yr)
- **File:** `programs/credentials/[id]/CredentialMetadataPanel.tsx:366-370`. Always sets default expiry = current expiry + 1 year. The `renewalPeriodDays` field exists in the schema and is used as a UI hint on the Add form, but is NOT passed through to the Renew form. **Fix:** Thread `credentialType.renewalPeriodDays` from the detail page through to `CredentialRenewForm`.

### IM-3 — CEU progress window-start uses `setUTCMonth` — drifts at month boundaries
- **File:** `programs/credentials/[id]/CredentialDetail.tsx:94-99`. `windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths)`. JS `Date.setMonth` clamps invalid dates: from 2026-03-31 with `windowMonths = 1` → 2026-03-03 (March wraps), not 2026-02-28. **Fix:** Use `date-fns` `subMonths` or explicitly clamp.

### IM-4 — Bulk-import dedup uses `licenseNumber || title` — collides for staff sharing identical title
- **File:** `programs/credentials/actions.ts:268`. Two staff each with a "BLS card" row and no licenseNumber collide → second drops as `DUPLICATE_IN_BATCH`. **Fix:** Include `holderEmail` in the dedup key.

### IM-5 — Bulk import never emits `ALREADY_EXISTS` or `UPDATED` — re-running CSV duplicates
- **File:** `programs/credentials/actions.ts:302-329`. Every row gets `randomUUID()` → `INSERTED`. The result interface promises four statuses but two are dead code. Re-uploading the same CSV creates duplicates. With CR-1 above, this is doubly bad. No DB-level unique constraint either. **Fix:** Lookup by `(practiceId, credentialTypeId, holderId, licenseNumber)` before insert. Add Prisma partial unique index.

### IM-6 — `CredentialReminderConfig` configId trusts client input
- **Files:** `programs/credentials/actions.ts:530`, `lib/events/projections/credential.ts:222-230`. **Fix:** Server should derive configId from `existingRow?.id ?? randomUUID()`.

### IM-7 — `Math.round` in `daysUntil` makes milestone matching non-deterministic
- **File:** `src/lib/notifications/generators.ts:32-34, 208-210`. Cron runs at unusual times (delayed batch, retry) can straddle a milestone day — fired twice (saved by entityKey dedup) or skipped. **Fix:** Check `days <= m` only and rely on entityKey dedup; or track which milestones have fired in `CredentialReminderConfig`.

### IM-8 — No citation registry entry for state board licensure or 21 CFR §1301.13 (DEA term)
- **File:** `src/lib/regulations/citations.ts:127-136`. Post-audit-#11 registry only has 2 DEA entries. Missing §1301.13 (term/renewal cycle), state board licensure references, CMS §424.515 (5-year revalidation). **Fix:** Add citations + wire into Concierge.

### IM-9 — `Concierge list_credentials` doesn't return credential `id`
- **File:** `src/lib/ai/conciergeTools.ts:260-270`. Returns `credentialTypeCode, holderId, title, expiryDate, status` — no `id`. Concierge LLM has nothing to anchor a click-through link. **Fix:** Include `id`.

### IM-10 — Holder cascade SetNull on PracticeUser hard-delete misaligned with soft-delete model
- **Files:** `prisma/schema.prisma:684,697`, `lib/events/projections/invitation.ts:182-185`. `holder PracticeUser? @relation(... onDelete: SetNull)`. But `MEMBER_REMOVED` is a soft-delete, not hard — so SetNull never fires. CR-4 is the user-facing symptom; this is the schema-design-level cause. **Fix:** Change to `onDelete: Restrict` so a Practice with credentials can't have a PracticeUser hard-deleted without an explicit credential-handover or retirement event.

## Minor (9)

### MN-1 — `CredentialActions` (list-page Remove button) still has no confirmation dialog
File: `programs/credentials/CredentialActions.tsx:15-23`. **Fix:** Add `confirm()`.

### MN-2 — CSV export omits UTF-8 BOM — Excel mangles non-ASCII
File: `src/app/api/credentials/export/route.ts:65-72`. **Fix:** Prepend `"﻿"`.

### MN-3 — `bulkImportCredentialsAction` MAX_BATCH check fires AFTER lookup queries
File: `programs/credentials/actions.ts:228-232`. **Fix:** `BulkInput = z.object({ rows: z.array(BulkCredentialRow).max(MAX_BATCH) })`.

### MN-4 — CredentialDetail.tsx is 805 LOC, mixing 6 concerns
**Fix:** Split CEU + reminder forms into `[id]/ceu/` and `[id]/reminders/` siblings.

### MN-5 — Activity-log `formatEventForActivityLog` for CREDENTIAL_UPSERTED treats `credentialTypeCode` as summary
File: `src/lib/audit/format-event.ts:165-170`. **Fix:** Format as `${p.credentialTypeCode} · ${truncate(p.title, 40)}`.

### MN-6 — `EvidenceUpload` allows STAFF/VIEWER to view "pending" evidence rows on credential detail
Files: `programs/credentials/[id]/page.tsx:57-65`, `EvidenceUpload.tsx`. STAFF can enumerate credential ids from the activity log (CR-3) and download evidence files. **Fix:** Filter by role on the detail page; gate `/api/evidence/[id]/download` by role for `entityType: "CREDENTIAL"`.

### MN-7 — `RemoveCeuInput` uses `Date.now()` in idempotencyKey — non-idempotent across rapid double-clicks
File: `programs/credentials/actions.ts:480-483`. **Fix:** Client-supplied stable idempotency key.

### MN-8 — `EXPIRING_SOON` boundary tests don't cover non-UTC `now` against UTC-stored expiry
File: `src/lib/credentials/status.test.ts`. **Fix:** Add boundary cases simulating non-UTC `now`.

### MN-9 — `<CredentialStatusBadge>` mixes server-side derivation with client-side display — extension trap
Files: `programs/credentials/page.tsx:159`, `CredentialStatusBadge.tsx`. **Fix:** Switch on `status` and throw on unknown.

## What's well done
- **Audit #16 EXPIRING_SOON SoT** — `src/lib/credentials/status.ts` + 7 boundary tests. Cleanly imported by page, PDF, Concierge, notifications, badge. Best-in-class consolidation pattern.
- **Audit #2 cross-tenant guards** — every projection (5) calls `assertProjectionPracticeOwned`.
- **Audit #8 Edit/Renew/Retire** — preserves credential id + EvidenceLog + CeuActivity through Renew (despite CR-1 holderId regression).
- **Audit #6 CSV injection (`csvEscape`)** — prefixes `=+-@\t\r` cells with single-quote, with explicit OWASP comment + 4 test cases.
- **Per-action defense-in-depth** — actions like `logCeuActivityAction` re-verify the credential's `practiceId`.
- **Renewal milestone idempotency** — `entityKey: credential:${cred.id}:milestone:${matchedMilestone}`.
- **Evidence GCS-key sanitization** — `sanitizeFileName` strips `..` traversal + non-allowlist chars.
- **Audit #3 CSV export role gate** — `/api/credentials/export` properly gated. Should be mirrored on the PDF route (CR-2).
- **`MEMBER_REMOVED` last-owner guard** — prevents OWNER from locking themselves out. Replicate for credential holderId removal (IM-10).

## Test coverage gaps
- No test of holder preservation through Edit/Renew (CR-1).
- No test of `/api/audit/credentials-register` PDF route role gate (CR-2).
- No test that `/audit/activity` redacts licenseNumber for STAFF/VIEWER (CR-3).
- No test of credentials-page rendering when holder is removed (CR-4).
- No test of `bulkImportCredentialsAction` with malformed dates (CR-5).
- No test of `generateCredentialNotifications` past-30-days drop (IM-1).
- No test of `Renew` form's renewalPeriodDays default (IM-2).
- No test of Concierge tool returning credential `id` (IM-9).
- No `tests/integration/credential-evidence-isolation.test.ts` (MN-6).
- No test of `MEMBER_REMOVED` cascade on credentials (IM-10).
- No DB-level uniqueness constraint enforcement test (IM-5).
