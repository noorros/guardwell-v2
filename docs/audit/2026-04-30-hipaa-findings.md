# HIPAA findings — 2026-04-30 (second audit)

**Date:** 2026-04-30
**Reviewer:** Static code-review agent (read-only)
**Scope:** `src/app/(dashboard)/programs/{risk,incidents,policies,staff}/`, `src/lib/events/projections/{incident,policy,sra*,officer}*`, `src/lib/compliance/derivation/hipaa*`, `src/lib/notifications/critical-alert.ts`, `src/lib/regulations/citations.ts`, `src/app/api/audit/incident-breach-memo/`, `src/app/accept-baa/`, related components.
**Prior audit:** [`2026-04-29-hipaa-findings.md`](2026-04-29-hipaa-findings.md). All Top-10 + 9/10 bucket-#2 items shipped to prod 2026-04-30.

## Inventory
- ~50 HIPAA-related source files reviewed.
- **21 findings: 4 Critical / 8 Important / 9 Minor.**

## Critical (4)

### C-1 — Policy + BAA projections lack cross-tenant guards
- **Files:** `src/lib/events/projections/policyAdopted.ts:22-103`, `policyContentUpdated.ts:22-50`, `policyAcknowledged.ts:18-32`, plus `projectBaaAcknowledgedByVendor`, `projectBaaExecutedByVendor`, `projectBaaRejectedByVendor`.
- **What's wrong:** Audit C-1 cross-tenant sweep added `assertProjectionPracticeOwned` to SRA / Credentials / Allergy projections, but POLICY (`projectPolicyAdopted`, `projectPolicyRetired`, `projectPolicyReviewed`, `projectPolicyContentUpdated`, `projectPolicyAcknowledged`) and BAA projections were missed. They mutate `practicePolicy` / `policyVersion` / `baaRequest` rows by id with no `practiceId` verification. `tests/integration/projection-cross-tenant-guards.test.ts` covers SRA/Credentials/Allergy but not Policy/BAA.
- **Audit-defense impact:** YES — defense-in-depth gap on the same class of bug C-1 closed elsewhere. §164.530 + §164.316 evidence integrity.
- **Fix:** Mirror the `assertProjectionPracticeOwned` pattern in all 8 projections. Extend the projection-cross-tenant-guards test sweep.
- **Effort:** M

### C-2 — SRA actions still ungated to ADMIN
- **Files:** `src/app/(dashboard)/programs/risk/actions.ts:55-101` (`completeSraAction`), `:103-142` (`saveSraDraftAction`).
- **What's wrong:** Audit #3 OWNER/ADMIN role-gate sweep gated incident, policy, officer, and many other HIPAA actions, but the SRA action layer was missed. Both SRA actions still use `getPracticeUser()` (any role). Any STAFF/VIEWER can complete the practice's SRA wizard, flipping `HIPAA_SRA` to COMPLIANT. Privilege-escalation primitive.
- **Audit-defense impact:** YES — §164.308(a)(1)(ii)(A) requires a "thorough, accurate" risk analysis; non-officer submissions undermine the evidence chain.
- **Fix:** Wrap with `requireRole("ADMIN")`. Pair with regression test in `role-gate-sweep.test.ts`.
- **Effort:** S

### C-3 — Breach memo PDF + incident-summary PDF open to STAFF/VIEWER
- **Files:** `src/app/api/audit/incident-breach-memo/[id]/route.tsx:29-32`, `src/app/api/audit/incident-summary/route.tsx:24-27`.
- **What's wrong:** Unlike `osha-300/route.tsx` (gated to OWNER/ADMIN per audit #3), the HIPAA breach memo PDF and incident summary PDF only require `getPracticeUser()`. The breach memo includes the user-supplied `breachDeterminationMemo` text — practices may include patient identifiers, MRN, DOB, or condition details. Any STAFF or VIEWER can pull this PDF.
- **Audit-defense impact:** YES — §164.502(b) (minimum-necessary) and §164.514(d) (role-based access). The breach memo is the PHI-densest audit artifact.
- **Fix:** Add the same `pu.role !== "OWNER" && pu.role !== "ADMIN" → 403` gate as the OSHA-300 route.
- **Effort:** S

### C-4 — Public BAA token routes lack rate limiting (unfixed from prior C-3)
- **Files:** `src/app/accept-baa/[token]/page.tsx:29`, `accept-baa/[token]/actions.ts:32`, `api/baa-document/[token]/route.ts:30`.
- **What's wrong:** Prior audit C-3 flagged these public no-auth surfaces as needing rate limiting; no middleware exists. Token enumeration is still possible at unlimited rate. A successful enum hit reveals practice name, vendor name, BAA terms, and downloads the signed PDF via 302 to GCS.
- **Audit-defense impact:** YES — OCR audit standards expect explicit rate limiting on un-authenticated PHI-adjacent endpoints.
- **Fix:** Next.js middleware with IP-based limiter (10 lookups/IP/min, hard-block at 100/hr). Adapt `src/lib/ai/rateLimit.ts`.
- **Effort:** M

## Important (8)

### I-1 — `INCIDENT_NOTIFIED_STATE_AG` drops `stateCode` on the floor
- **File:** `src/lib/events/projections/incident.ts:257-277`.
- **What's wrong:** Action's `NotificationInput` zod schema requires `stateCode` for `STATE_AG`, but `projectIncidentNotifiedStateAg` stores only `stateAgNotifiedAt`. State code itself is discarded. Multi-state breach where AG notification is required to multiple states (TX 250+, CA, NY, FL all have AG-notice triggers) — only one timestamp wins, no record of which state(s) were notified.
- **Audit-defense impact:** YES — §164.504(a) and state-AG-specific statutes need per-state evidence.
- **Fix:** Add an `IncidentStateAgNotification` join row (or JSON array on Incident) keyed by stateCode. Render a list of notified AGs on the breach memo PDF.
- **Effort:** M

### I-2 — `MajorBreachBanner` doesn't guard against NaN/Infinity (unfixed from prior I-4)
- **File:** `src/components/gw/MajorBreachBanner/index.tsx:29`.
- **What's wrong:** `if (affectedCount < MAJOR_BREACH_THRESHOLD) return null;` — `NaN < 500` is false (banner renders, displaying "NaN individuals affected"); `Infinity < 500` is false (banner renders with "Infinity").
- **Audit-defense impact:** NO (UI-only) but visible regression.
- **Fix:** `if (!Number.isFinite(affectedCount) || affectedCount < MAJOR_BREACH_THRESHOLD) return null;` + tests.
- **Effort:** S

### I-3 — `NotificationLog` and `AcknowledgeForm` use UTC `.toISOString().slice(...)`
- **Files:** `src/app/(dashboard)/programs/incidents/[id]/NotificationLog.tsx:166`, `programs/policies/[id]/AcknowledgeForm.tsx:83`, `programs/policies/[id]/acknowledgments/page.tsx:271`.
- **What's wrong:** Audit timezone remediation (PR #196) replaced UTC slicing across PDFs, dashboards, and badges, but missed three user-facing display sites.
- **Audit-defense impact:** YES (low-magnitude) — same audit-#10 rationale; off-by-one days on rendered dates can mis-classify a notification as on-time vs late.
- **Fix:** Pass `practice.timezone` and use `formatPracticeDate` / `formatPracticeDateTime`.
- **Effort:** S

### I-4 — Implicit-association labels still in HIPAA forms (audit #12 ARIA sweep incomplete)
- **Files:** `programs/policies/[id]/AcknowledgeForm.tsx:171-179`, `accept-baa/[token]/AcceptBaaForm.tsx:138-150`, `programs/cybersecurity/PhishingDrillForm.tsx`, `programs/cybersecurity/BackupVerificationForm.tsx`.
- **What's wrong:** Audit #12 ARIA sweep (PR #212) covered SraWizard, IncidentReportForm, AddCredentialForm, NewDestructionForm, but missed several HIPAA-relevant forms — notably the AcceptBaaForm checkbox, which is the legally binding e-signature form per §164.504(e).
- **Audit-defense impact:** NO (a11y / WCAG only).
- **Fix:** Add explicit `htmlFor`/`id` pairs and add the missed forms to `audit-12-aria-sweep.test.tsx`.
- **Effort:** M

### I-5 — Officer toggle and policy actions render for all roles, fail only on click
- **Files:** `programs/staff/page.tsx:214-237`, `programs/policies/PolicyActions.tsx:64-101`.
- **What's wrong:** Action layer correctly gates `toggleOfficerAction` to OWNER and policy actions to ADMIN, but the page-level rendering doesn't check role. STAFF/VIEWER sees a fully-styled checkbox / Adopt / Mark reviewed / Retire button, only seeing "Requires OWNER role or higher" via `console.error` after click.
- **Audit-defense impact:** NO — security posture intact.
- **Fix:** Read `pu.role` on the page and conditionally hide / disable controls (matches `canManage` pattern in `OshaOutcomePanel`).
- **Effort:** S

### I-6 — `BreachDeterminationWizard` allows isBreach=true with affectedCount=0 (unfixed M-4)
- **File:** `src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx:67-99`.
- **What's wrong:** Wizard validates `parsedCount >= 0` but accepts 0. With factor-5 hard trigger, you get a breach record with no individuals to notify. Stuck `isBreach=true, resolvedAt=null` row drops `HIPAA_BREACH_RESPONSE` to GAP indefinitely. PDF says "Affected individuals: 0" + "HHS OCR notification required."
- **Audit-defense impact:** YES (low) — auditors will ask "explain how you have a reportable breach with zero affected".
- **Fix:** Require `affectedCount >= 1` when preview shows breach=true (wizard validator + `BreachInput` zod schema).
- **Effort:** S

### I-7 — No `tests/integration/hipaa-derivation.test.ts` (unfixed I-10)
- **File:** Missing.
- **What's wrong:** Every other framework has a `*-derivation.test.ts`. HIPAA has 16 federal rules + 50 state-overlay rules and ZERO direct unit-test coverage. The 5 newest rules + the policy-review-current rule have no direct test — only exercised via projection flows.
- **Audit-defense impact:** YES (defensive) — derivation drift would land silently. Largest defensive win per LOC.
- **Fix:** Author `hipaa-derivation.test.ts` covering each rule's COMPLIANT path, GAP path, null/zero-state, and freshness window edges.
- **Effort:** L

### I-8 — `training-summary` PDF route fetches all users globally
- **File:** `src/app/api/audit/training-summary/route.tsx:41-43`.
- **What's wrong:** `db.user.findMany({ select: {...} })` with no `where` — fetches every User in the database. Result is filtered in-memory; PDF output is correct but the query is unscoped. Also: no OWNER/ADMIN role gate.
- **Audit-defense impact:** YES — minimum-necessary violation; perf risk on large user tables.
- **Fix:** Scope to `where: { id: { in: userIds } }`. Add role gate.
- **Effort:** S

## Minor (9)

### M-1 — `HIPAA_CA_BREACH_NOTIFICATION_72HR` rule key still misnamed (unfixed)
- File: `src/lib/compliance/derivation/hipaa.ts:507`. Window is 15 business days, name says 72HR. **Fix:** Rename to `HIPAA_CA_BREACH_15_BIZ_DAYS`.

### M-2 — Vendor BAA register PDF excludes retired vendors
- File: `src/app/api/audit/vendor-baa-register/route.tsx:30`. **Fix:** Two-section PDF (Active + Retired, last 6 years per §164.530(j)).

### M-3 — `addBusinessDays` skips weekends but not federal holidays
- File: `src/lib/compliance/derivation/hipaa.ts:276-285`. **Fix:** Use `date-holidays` or document the conservative over-estimation as intentional.

### M-4 — `revalidatePath("/modules/hipaa")` missing on BAA actions
- File: `programs/vendors/[id]/actions.ts` (BAA-emit paths only revalidate `/programs/vendors`). **Fix:** Shared `revalidateHipaaSurfaces()` helper.

### M-5 — `executeBaaAction` doesn't log rejected attempts
- File: `src/app/accept-baa/[token]/actions.ts:45-72`. Pairs with C-4: without logging, can't alert on enumeration. **Fix:** Append `BAA_EXECUTE_REJECTED` event with reason + IP.

### M-6 — Inconsistent zero-workforce edge case across rules
- File: `derivation/shared.ts:70`, `:124` vs `derivation/hipaa.ts:321`. Some rules return GAP, others null. **Fix:** Normalize to null.

### M-7 — `hipaaSraRule` reads `tx.techAsset` — model populated by an asset-inventory step that may not exist
- File: `src/lib/compliance/derivation/hipaaSra.ts:32-35`. New practices return GAP because no TechAssets exist. **Fix:** Feature-flag the asset requirement until inventory onboarding ships, or seed a placeholder.

### M-8 — SRA notes textarea is a PHI sink (no warning, persisted to EventLog)
- Files: `programs/risk/new/SraWizard.tsx:312-322`, `events/registry.ts:344-375`. Notes flow into immutable EventLog via 800ms autosave. A user could write "Patient John Smith DOB 1/1/80" and it persists forever. **Fix:** Update placeholder + helper text warning against PHI; optionally add server-side scrub.

### M-9 — `HIPAA_BREACH_DISCOVERY_CLOCK` citation conflates §164.404 and §164.408
- File: `src/lib/regulations/citations.ts:36-40`. §164.408 is HHS notification; patient/affected-individual notice is §164.404(b). **Fix:** Split into two citations.

## What's well done
- `assertProjectionPracticeOwned` helper pattern is clean; SRA, Credentials, Allergy projections consistently use it.
- Incident-related projections (`INCIDENT_BREACH_DETERMINED`, `INCIDENT_RESOLVED`, the four `INCIDENT_NOTIFIED_*`) all have explicit cross-tenant guards.
- `BreachDeterminationWizard` validates `memoText.trim().length >= 40` both client-side and server-side, ensuring substantive §164.402 documentation.
- `recordIncidentNotificationAction` correctly uses `requireRole("ADMIN")`.
- `formatPracticeDate` family is clean, well-tested, and consistently used in the breach memo PDF.
- Audit #15 history-row edits (PR #213) correctly add cross-tenant guards on `INCIDENT_OSHA_OUTCOME_UPDATED` AND restrict to OSHA_RECORDABLE incidents.

## Test coverage gaps
- `tests/integration/hipaa-derivation.test.ts` does not exist (I-7).
- Policy/BAA cross-tenant projection guards (C-1) — projections AND tests both missing.
- `MajorBreachBanner.test.tsx` lacks NaN/Infinity tests (I-2).
- No SRA action role-gate test in `role-gate-sweep.test.ts` (C-2).
- No incident-breach-memo PDF route role-gate test (C-3).
- No state-AG multi-state notification test (I-1).
- No `executeBaaAction` rejection-logging test (M-5).
- No accept-baa rate-limit test (C-4).
- No `affectedCount=0 + isBreach=true` regression test (I-6).
