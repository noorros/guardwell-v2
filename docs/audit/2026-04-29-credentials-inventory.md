# Credentials Surface Inventory — GuardWell v2

**Date:** 2026-04-29
**Source:** Explore agent run + manual verification, working dir `D:/GuardWell/guardwell-v2/`
**Purpose:** Input for code-reviewer pass + Chrome interactive verify

## Totals
- ~25 files directly touching Credentials across UI / actions / API / projection / PDF / notifications / tests
- ~2,624 LOC across the direct UI + actions + projection + PDF + export surface (verified via `wc -l`)
- Add ~775 LOC across the 5 integration tests + ~427 LOC of derivation rules + ~150 LOC seed = ~3,975 LOC including indirect surface

## 1. Module page & UI components
- `src/app/(dashboard)/programs/credentials/page.tsx` (196 LOC) — Credentials list page (filters, status badge, holder/type/expiry columns, Add/Bulk Import/Export actions, empty state)
- `src/app/(dashboard)/programs/credentials/AddCredentialForm.tsx` (217 LOC) — Inline add form (credential type combobox, holder picker, license # / issuing body / dates / notes)
- `src/app/(dashboard)/programs/credentials/CredentialActions.tsx` (30 LOC) — Per-row delete (`removeCredentialAction`)
- `src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx` (98 LOC) — Renders the 4-state status badge: ACTIVE / EXPIRING_SOON / EXPIRED / NO_EXPIRY (status DERIVED at render time from `(retiredAt, expiryDate)` — no `status` column on the model)
- `src/app/(dashboard)/programs/credentials/[id]/page.tsx` (146 LOC) — Credential detail server page (fetches credential + CEU activities + reminder config + renders `<CredentialDetail>`)
- `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx` (848 LOC, **largest file in surface**) — Rich detail page: edit metadata, CEU progress bar, log/remove CEU activity, reminder config editor, retire button, history feed
- `src/app/(dashboard)/programs/credentials/bulk-import/page.tsx` (80 LOC) — Bulk-import server page wrapper
- `src/app/(dashboard)/programs/credentials/bulk-import/CredentialBulkImport.tsx` (112 LOC) — CSV upload + dry-run preview + per-row results table
- **Note:** there is NO `/modules/credentials` route. Credentials live entirely under `/programs/credentials/`. Credential evidence DOES feed cross-framework derivation (DEA / CLIA / CMS) — see §3.

## 2. Prisma schema models (Credentials-relevant)
Verified from `prisma/schema.prisma` lines 604-744:

- **`CredentialType`** (reference data, seeded read-only) — `id`, `code`, `category`, `displayName`, `defaultExpiryMonths`, `ceuRequirementHours`, `ceuRequirementWindowMonths`, `requiresEvidence` (default flag for whether instances of this type should auto-COMPLIANT a CREDENTIAL_TYPE:* derivation rule)
- **`Credential`** (per-practice credential row, append-only via events) — `id`, `practiceId`, `holderId` (nullable; `PracticeUser.id`; null = practice-level credential), `credentialTypeId` (FK to `CredentialType`), `title`, `licenseNumber`, `issuingBody`, `issueDate`, `expiryDate` (nullable — null = NO_EXPIRY status), `notes`, `retiredAt` (nullable; soft-delete), timestamps
- **`CeuActivity`** (continuing-education hours) — `id`, `practiceId`, `credentialId` (FK with cascade-delete), `activityName`, `provider`, `hoursAwarded`, `activityDate`, `certificateEvidenceId` (nullable FK to `Evidence` — file-upload pipeline gated on Phase 3+ evidence-uploader), `retiredAt` (soft-delete), indices `(practiceId, credentialId, activityDate)` + `(credentialId, retiredAt)`
- **`CredentialReminderConfig`** (per-credential opt-in milestone overrides) — `id`, `credentialId` (`@unique` FK), `milestoneDays` (`Int[]`; default `[90, 60, 30, 7]` applied app-side when no row), `enabled`, timestamps
- **NO `CredentialEvent` table** — events flow through unified `EventLog`; projection writes directly to `Credential` / `CeuActivity` / `CredentialReminderConfig`.
- **NO `status` column on `Credential`** — the 4-state enum is computed at render time from `(retiredAt, expiryDate, EXPIRING_SOON_DAYS=90)`. Per memory: this is a deliberate convention shared with the Concierge `list_credentials` tool; both sites must use the same derivation function. Verify in code review.

## 3. Derivation rules + framework registration
Credential rows feed 5 derivation rules across 3 frameworks (verified via `Grep credentialTypePresentRule|credentialTypeId|CredentialType`):

- **`src/lib/compliance/derivation/shared.ts`** (155 LOC) — `credentialTypePresentRule(credentialTypeCode)` factory: queries active (non-retired, non-expired) Credential rows of the given type. Returns COMPLIANT if ≥1 found, GAP otherwise. **Used by all 5 credential-backed rules below.**
- **`src/lib/compliance/derivation/dea.ts`** (235 LOC) — `DEA_REGISTRATION` ← `credentialTypePresentRule("DEA_CONTROLLED_SUBSTANCE_REGISTRATION")`. The remaining 7 DEA rules query `DeaInventory` / `DeaOrderRecord` / `DeaDisposalRecord` / `EventLog` rows, NOT credentials.
- **`src/lib/compliance/derivation/clia.ts`** (37 LOC) — `CLIA_CERTIFICATE` ← `credentialTypePresentRule("CLIA_WAIVER_CERTIFICATE")`. The remaining 7 CLIA rules are manual-only (per Phase 1 PR 7 — documented in clia.ts header table).
- **`src/lib/compliance/derivation/cms.ts`** (~200 LOC, partial — credential-backed slice ~75 LOC) — `CMS_PECOS_ENROLLMENT`, `CMS_NPI_REGISTRATION`, `CMS_MEDICARE_PROVIDER_ENROLLMENT` all use the factory against the respective `CredentialType.code`.
- **HIPAA officer rules do NOT query Credential.** `hipaaSecurityOfficerRule` / `hipaaPrivacyOfficerRule` check `PracticeUser.isSecurityOfficer` / `isPrivacyOfficer` flags — separate path.
- **Two evidence code shapes per credential** (per `projectCredentialUpserted` rederive logic, lines 33-40 of `src/lib/events/projections/credential.ts`): rederive triggered for both `CREDENTIAL:<category>` (e.g. `CREDENTIAL:CLINICAL_LICENSE`) AND `CREDENTIAL_TYPE:<code>` (e.g. `CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION`). Future rules can target either granularity.

## 4. Policy templates + seed data
- `scripts/seed-credentials.ts` (~120 LOC) — Seeds the `CredentialType` reference table. Pulls from `scripts/_v1-credential-types-export.json` (52 types across 12 categories per memory, e.g. CLINICAL_LICENSE / FACILITY_LICENSE / TRAINING_CERTIFICATION / DEA / CLIA / CMS / IDENTITY).
- `scripts/_v1-credential-types-export.json` — Reference data export from v1 (52 credential types). Read-only; idempotent re-seed.
- **No credential-specific policies** — credentials track licenses/certifications, not policy adoption. Policies under `/programs/policies` are unrelated except where a credential type is referenced in policy text.

## 5. Training + onboarding
- **`tests/integration/training-completion.test.ts`** verifies the cross-cutting flow: completing a training course can produce credential evidence (e.g. CPR/BLS/OSHA training → Credential row) — but this is **not auto-wired** in v2 yet. The test confirms the projection works; the UI flow (training → "did this give you a credential? log it") is manual via `/programs/credentials/new`.
- No drip emails specific to credentials; `src/lib/onboarding/drip-content.ts` covers HIPAA/OSHA but not credentials directly.

## 6. (skip — incidents not credential-related)

## 7. (skip — SRA HIPAA-only)

## 8. (skip — vendors HIPAA-only)

## 9. (covered by §4)

## 10. Server actions + API routes
- **`src/app/(dashboard)/programs/credentials/actions.ts`** (470 LOC) — All credential server actions:
  - `addCredentialAction(input)` — `appendEventAndApply` `CREDENTIAL_UPSERTED` (v1). Validates: credential type exists, holder is in same practice (`verifyHolderInPractice`), holder not removed. Date inputs parsed as `YYYY-MM-DD` and serialized to noon-UTC ISO (line 38: comment says "to avoid TZ-drift edge cases" — **dates intentionally stored in UTC**, see HIPAA I-1 cross-pattern).
  - `updateCredentialAction(input)` — re-emits `CREDENTIAL_UPSERTED` (idempotent upsert).
  - `removeCredentialAction({ credentialId })` — emits `CREDENTIAL_REMOVED`. Soft-delete via projection.
  - `bulkImportCredentialsAction(rows)` — 200-row cap; intra-batch dedup by `(licenseNumber|title, credentialTypeCode)`; per-row results: `INSERTED | UPDATED | DUPLICATE_IN_BATCH | ALREADY_EXISTS | INVALID`. Email lookup is `.toLowerCase()`.
  - `logCeuActivityAction({ credentialId, activityName, provider, hours, activityDate })` — `CEU_ACTIVITY_LOGGED` event.
  - `removeCeuActivityAction({ ceuActivityId })` — `CEU_ACTIVITY_REMOVED` event (soft-delete via `retiredAt`).
  - `updateCredentialReminderConfigAction({ credentialId, milestoneDays, enabled })` — `CREDENTIAL_REMINDER_CONFIG_UPDATED` event.
  - **All actions:** `requireUser()` + `getPracticeUser()` for tenant scoping. **Role-gating not visible at first glance** — verify in code review whether OWNER/ADMIN gate is applied (HIPAA C-2 cross-pattern).
- **`src/app/api/credentials/export/route.ts`** (66 LOC) — GET endpoint, returns CSV (8 cols: credentialTypeCode, holderEmail, title, licenseNumber, issuingBody, issueDate, expiryDate, notes). Filters out retired credentials. Filename `credentials-{practice-name}.csv`.
- **No dedicated credential cron** — credential renewal/expiry/escalation notifications are generated by `src/lib/notifications/generators.ts` and dispatched via `src/app/api/notifications/digest/run/route.ts` (the daily digest cron, fired by Cloud Scheduler).

## 11. Tests
**5 integration test files (775 LOC total):**
- `tests/integration/credential-projection.test.ts` (236 LOC) — `CREDENTIAL_UPSERTED` → table write + rederive; `CREDENTIAL_REMOVED` → soft-delete + rederive
- `tests/integration/credential-ceu-projection.test.ts` (177 LOC) — `CEU_ACTIVITY_LOGGED` / `CEU_ACTIVITY_REMOVED` / `CREDENTIAL_REMINDER_CONFIG_UPDATED` projection tests
- `tests/integration/credential-ceu-action.test.ts` (185 LOC) — Server action validation: future-date reject, hour bounds (0 < hours ≤ 200), credential-must-exist guard
- `tests/integration/credential-renewal-reminders.test.ts` (175 LOC) — Milestone notification generation + 14-day escalation logic
- `tests/integration/training-completion.test.ts` — Cross-cutting flow (mostly training-focused; credential side covered)
- **Test result (2026-04-29 run):** 5 files, 23 tests, all passing, 3.10s

**Test gaps to verify in code review:**
- No direct test of `credentialTypePresentRule` factory across all 5 framework rules
- No test of bulk-import CSV with 200+ rows (cap enforcement)
- No test of `getCredentialStatus()` derivation function (the 4-state enum mapper) — tests check projection + notifications, but not the render-time derivation that drives the badge
- No `/api/credentials/export` happy-path or auth test
- No `credentials-register-pdf` snapshot test (PDF rendering)

## 12. Help articles + AI copy
- **`src/lib/ai/conciergeTools.ts`** — `list_credentials` tool definition uses the same 4-state derivation function. Per memory PR A2 polish round: a known fix landed for `NO_EXPIRY` ordering; both Concierge tool + the credentials page should agree on status. Verify both still match in code review.
- No dedicated `/help/credentials` article surface yet; help content for compliance modules is under `src/app/(marketing)/help/`.

## 13. State overlays + projections
- **`src/lib/events/projections/credential.ts`** (162 LOC) — 5 projection functions:
  - `projectCredentialUpserted(tx, { practiceId, payload })` — upsert into `Credential` table by `(practiceId, credentialTypeId, holderId, licenseNumber|title)`; rederive 2 evidence codes
  - `projectCredentialRemoved(tx, ...)` — set `retiredAt = now`; rederive
  - `projectCeuActivityLogged(tx, ...)` — upsert into `CeuActivity`
  - `projectCeuActivityRemoved(tx, ...)` — set `retiredAt = now`
  - `projectCredentialReminderConfigUpdated(tx, ...)` — upsert into `CredentialReminderConfig`
- **State overlays:** none. Credentials are practice-level, not state-specific. NJ/NY/CA license types ARE in the `CredentialType` reference table (e.g. medical license per state) but no state-overlay derivation rules query them differently. **Confirm in Chrome:** is the AZ practice's `Prod Smoke Test` credential list filtered to AZ-relevant types only, or is the full 52-type list shown?

## 14. Audit / PDF / export
- **`src/lib/audit/credentials-register-pdf.tsx`** (199 LOC) — Renders the credentials register as a PDF. Used by `/audit/overview` "Download audit packet" flow + likely by a per-page PDF button on `/programs/credentials`. Check: does this PDF use UTC dates (HIPAA I-1 / OSHA I-4 cross-pattern)?

## Notification surface
**4 notification generators feed the digest pipeline** (verified in `src/lib/notifications/generators.ts` lines 1259-1262):
- `generateCredentialNotifications` → `CREDENTIAL_EXPIRING` (when `expiryDate < now`)
- `generateCredentialRenewalNotifications` → `CREDENTIAL_RENEWAL_DUE` (at each milestone day before expiry, default `[90, 60, 30, 7]`)
- `generateCredentialEscalationNotifications` → `CREDENTIAL_ESCALATION` (when a `CREDENTIAL_EXPIRING` notification has gone unaddressed for 14+ days)
- `generateCmsEnrollmentNotifications` → `CMS_ENROLLMENT_EXPIRING` (parallel logic for CMS-credential-typed rows; potential dedup opportunity per agent's open question)

**`NotificationType` enum values** (from `prisma/schema.prisma` lines 367-369):
- `CREDENTIAL_EXPIRING`
- `CREDENTIAL_RENEWAL_DUE`
- `CREDENTIAL_ESCALATION`

(`CMS_ENROLLMENT_EXPIRING` may be its own enum value — confirm in schema.)

## Cross-framework dependencies summary
| Framework | Rule | Credential type queried |
|---|---|---|
| DEA | DEA_REGISTRATION | DEA_CONTROLLED_SUBSTANCE_REGISTRATION |
| CLIA | CLIA_CERTIFICATE | CLIA_WAIVER_CERTIFICATE |
| CMS | CMS_PECOS_ENROLLMENT | (matching CredentialType.code) |
| CMS | CMS_NPI_REGISTRATION | (matching CredentialType.code) |
| CMS | CMS_MEDICARE_PROVIDER_ENROLLMENT | (matching CredentialType.code) |

Removing a credential of a type listed above should flip the corresponding rule from COMPLIANT → GAP. Verify in Chrome by adding a DEA credential, observing DEA score increase, then retiring it and observing the score drop.

## Event types (5 total, registered in `src/lib/events/registry.ts`)
- `CREDENTIAL_UPSERTED` (v1)
- `CREDENTIAL_REMOVED` (v1)
- `CREDENTIAL_REMINDER_CONFIG_UPDATED` (v1)
- `CEU_ACTIVITY_LOGGED` (v1)
- `CEU_ACTIVITY_REMOVED` (v1)

## Open questions for the auditor (Chrome verify priorities)
1. **EXPIRING_SOON window:** is the 90-day threshold consistent across the badge, the Concierge tool, and the renewal-reminder generator? Verify by setting a credential to expire in 89 days vs 91 days.
2. **NO_EXPIRY badge:** what does the badge show for a credential with `expiryDate = null`? Is it visually distinct from ACTIVE?
3. **Date storage:** dates are noon-UTC per `actions.ts` line 38 — does the displayed date match what was entered in the form when the user is in a non-UTC timezone? Cross-pattern with HIPAA I-1.
4. **Status discrepancy:** does the credential page list show the same status as the Concierge `list_credentials` tool? Both should use the shared derivation function.
5. **Bulk import:** can a non-OWNER/non-ADMIN user trigger the bulk import? Cross-pattern with HIPAA C-2.
6. **CSV export:** can a non-OWNER/non-ADMIN user hit `/api/credentials/export`? Same role-gate question.
7. **CEU progress bar:** does the progress bar correctly compute `sum(CeuActivity.hoursAwarded WHERE activityDate >= now - ceuRequirementWindowMonths) / ceuRequirementHours`?
8. **Reminder config:** if the operator changes `milestoneDays` from `[90, 60, 30, 7]` to `[60, 30]`, do existing 90-day notifications get suppressed retroactively, or do they remain in the user's notification list?
9. **Bulk import CSV with bad email:** what's the per-row error display when `holderEmail` doesn't match a PracticeUser?
10. **Credential holder removed:** what happens when a `PracticeUser` is removed but their credential rows remain (`holderId` does NOT cascade)? Does the list still render the credential? Does it appear as "orphan"?
11. **Tenant isolation:** can a user from one practice see/modify another practice's credentials? (Cross-pattern with HIPAA C-1.)
12. **Audit PDF dates:** does `credentials-register-pdf.tsx` render dates in UTC or in the user's local time? Cross-pattern with HIPAA M-5.
13. **Cross-framework score impact:** does removing the only DEA credential drop the DEA score? (Already partially answered by Phase 1 PR 3.)
14. **Aria attributes:** does the credentials page have proper `role="table"` / `aria-label` on the list, and proper labels on the form radios/dates? Cross-pattern with HIPAA I-8 + OSHA U-3.

## Patterns expected to re-find from HIPAA + OSHA
Per the audit playbook, these cross-area patterns from HIPAA + OSHA findings should be confirmed or ruled out on Credentials:

- **C-1 cross-tenant guard gap on projections** — verify `projectCredentialUpserted` validates `payload.practiceId === args.practiceId` (HIPAA found this missing on `projectSraCompleted`).
- **C-2 OWNER/ADMIN role gate gap on actions** — verify `addCredentialAction`, `removeCredentialAction`, `bulkImportCredentialsAction`, `updateCredentialReminderConfigAction` all gate on role.
- **I-1 dates rendered in UTC** — verify `credentials-register-pdf.tsx` and the `<CredentialStatusBadge>` and the Concierge `list_credentials` all handle timezones.
- **I-7/I-8 hardcoded citations** — credentials code is mostly free of regulatory citations, but verify any help text / form-label hints.
- **I-8/I-9 missing aria on radio groups** — credentials uses fewer radios, but `<AddCredentialForm>` may have type/category pickers; `CredentialDetail` reminder config may have toggles.
