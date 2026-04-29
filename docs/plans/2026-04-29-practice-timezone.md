# Practice Timezone — Audit Item #10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Practice.timezone` column, default-derived from `primaryState`, and route every UTC-truncating date render (PDFs, notifications, badges, Concierge tools) through a shared `formatPracticeDate(date, tz)` helper so practices in non-UTC states see correct dates on every audit-defense surface.

**Architecture:** Two pure modules — `src/lib/timezone/stateDefaults.ts` (state→IANA map) and `src/lib/audit/format.ts` (`Intl.DateTimeFormat`-backed formatters). Schema gains `timezone String?` (nullable so existing rows don't fail the `prisma db push` deploy step). A one-shot backfill script populates rows that pre-date the column. Practice creation + settings save derive `timezone` from `primaryState` automatically; settings exposes an override dropdown for multi-zone states. Server components thread the practice's timezone via a React context (`PracticeTimezoneProvider` mounted in `(dashboard)/layout.tsx`); badges read it via `usePracticeTimezone()` so SSR + CSR formatting match (no hydration mismatch). PDF route handlers fetch `practice.timezone` and pass it as a typed input field. Notification generators receive `practiceTimezone` as a parameter from `runNotificationDigest`.

**Tech Stack:** Prisma 5.22 + Postgres (auto-migrated via Cloud Build `prisma db push`); Next.js 16 App Router; React 19; native `Intl.DateTimeFormat` (no new dep — `date-fns-tz` is **not** added); Vitest 4 with two projects (node integration + jsdom component); `@react-pdf/renderer` 4.3.

---

## Why this plan over alternatives

- **Why `Intl.DateTimeFormat` over `date-fns-tz`?** Native, zero-dep, identical behavior for our use case (formatting a UTC `Date` in a named IANA zone). Avoids a transitive footprint regression.
- **Why a context provider for badges instead of prop-drilling?** Badges live deep inside `CredentialDetail`, `VendorDetail`, `policies/[id]/page`. Prop-drilling timezone through ~20 components would be an invasive PR; one provider in the dashboard layout solves it.
- **Why `timezone String?` and not an enum?** IANA zones evolve (Crimea moved to `Europe/Simferopol`, etc.). String storage matches `primaryState` precedent and keeps Prisma migrations cheap.
- **Why default from `primaryState` instead of asking on signup?** Audit said "default from primaryState." Signup is already long; we avoid a forced new question. Settings exposes the override for the rare multi-zone case (FL panhandle, IN central-vs-eastern, TX El Paso vs the rest).

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/timezone/stateDefaults.ts` | `STATE_DEFAULT_TIMEZONE: Record<string, string>` (51 entries) + `defaultTimezoneForState(state: string): string` (fallback `America/New_York`) |
| `src/lib/timezone/stateDefaults.test.ts` | Unit tests: every `US_STATES` code has a default; spot-checks for AZ, HI, AK, DC, TX, FL |
| `src/lib/audit/format.ts` | `formatPracticeDate(date, tz): string` (YYYY-MM-DD), `formatPracticeDateLong(date, tz): string` ("Apr 29, 2026"), `formatPracticeDateTime(date, tz): string` (date + 24h time + offset) |
| `src/lib/audit/format.test.ts` | Unit tests: AZ/NY/HI edge cases, DST transitions, invalid TZ fallback |
| `src/lib/timezone/PracticeTimezoneContext.tsx` | `<PracticeTimezoneProvider value={tz}>` + `usePracticeTimezone(): string` (default `"UTC"`) |
| `src/lib/timezone/PracticeTimezoneContext.test.tsx` | Render badge inside provider, assert hook returns provided value |
| `scripts/backfill-practice-timezone.ts` | One-shot: for every Practice with `timezone: null`, set `timezone = defaultTimezoneForState(primaryState)` |
| `scripts/__tests__/backfill-practice-timezone.test.ts` | Integration test using real Postgres |
| `tests/integration/notifications-timezone.test.ts` | Asserts notification body for AZ + HI practice prints local-date |
| `tests/integration/pdf-timezone.test.ts` | Asserts `incident-breach-memo` PDF buffer contains AZ-local discoveredAt date |

### Modified files

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `timezone String?` to `Practice` (no index needed — never queried by it) |
| `src/components/gw/PracticeProfileForm/types.ts` | Add `timezone: string \| null` |
| `src/components/gw/PracticeProfileForm/index.tsx` | Add timezone select (US IANA zones); auto-fill when primaryState changes IF the prior value matched the prior state's default |
| `src/app/(dashboard)/settings/practice/page.tsx` | Hydrate `timezone` into initial form state |
| `src/app/(dashboard)/settings/practice/actions.ts` | Add `timezone` to `InputSchema` + `TRACKED_FIELDS`; persist to Practice |
| `src/lib/events/projections/practiceProfileSettings.ts` | Persist `timezone` field on update |
| `src/app/onboarding/create-practice/actions.ts` | Set `timezone = defaultTimezoneForState(primaryState)` at create time |
| `src/app/(dashboard)/layout.tsx` | Fetch `practice.timezone`; wrap children in `<PracticeTimezoneProvider value={...}>` |
| **PDF components** (13 files in `src/lib/audit/*.tsx` + `src/lib/audit-prep/packet-pdf.tsx`) | Replace inline `formatDate` and `toISOString().slice(0, 10)` with `formatPracticeDate(d, input.practiceTimezone)`; add `practiceTimezone: string` to each input interface |
| **PDF API routes** (~9 files in `src/app/api/audit/**/route.tsx` + `src/app/api/audit/**/route.ts`) | Pass `practiceTimezone: pu.practice.timezone ?? "UTC"` into the input object |
| `src/lib/notifications/run-digest.ts` | Fetch `primaryState` + `timezone`; pass `practiceTimezone` into `generateAllNotifications` |
| `src/lib/notifications/generators.ts` | Add `practiceTimezone: string` parameter to every generator + `generateAllNotifications`; replace `.toISOString().slice(0, 10)` with `formatPracticeDate(d, practiceTimezone)` |
| `src/lib/notifications/critical-alert.ts` | Same threading |
| `src/components/gw/Extras/DeaExtras.tsx`, `CliaExtras.tsx`, `AllergyExtras.tsx` | Read `usePracticeTimezone()`; replace UTC formatting |
| Badge components: `src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx`, `programs/risk/SraAssessmentBadge.tsx`, `programs/policies/AdoptedBadge.tsx`, `programs/training/TrainingStatusBadge.tsx`, `programs/vendors/BaaStatusBadge.tsx` | Replace `SSR_FMT` (hardcoded UTC) with `usePracticeTimezone()`-derived `Intl.DateTimeFormat` |
| `src/lib/ai/conciergeTools.ts` | `list_credentials` formats `expiryDate` via `formatPracticeDate` before returning to the model (so the model sees the practice-local date verbatim) |

---

## State → IANA timezone mapping

All 51 `US_STATES` codes resolved to their **most populous** IANA zone (multi-zone states pick the dominant zone; an admin can override in settings). AZ uses `America/Phoenix` (no DST — most of Arizona; the Navajo Nation observes DST but a practice there should override).

| State | TZ | State | TZ | State | TZ |
|---|---|---|---|---|---|
| AL | America/Chicago | KY | America/New_York | OH | America/New_York |
| AK | America/Anchorage | LA | America/Chicago | OK | America/Chicago |
| AZ | America/Phoenix | ME | America/New_York | OR | America/Los_Angeles |
| AR | America/Chicago | MD | America/New_York | PA | America/New_York |
| CA | America/Los_Angeles | MA | America/New_York | RI | America/New_York |
| CO | America/Denver | MI | America/New_York | SC | America/New_York |
| CT | America/New_York | MN | America/Chicago | SD | America/Chicago |
| DE | America/New_York | MS | America/Chicago | TN | America/Chicago |
| DC | America/New_York | MO | America/Chicago | TX | America/Chicago |
| FL | America/New_York | MT | America/Denver | UT | America/Denver |
| GA | America/New_York | NE | America/Chicago | VT | America/New_York |
| HI | Pacific/Honolulu | NV | America/Los_Angeles | VA | America/New_York |
| ID | America/Boise | NH | America/New_York | WA | America/Los_Angeles |
| IL | America/Chicago | NJ | America/New_York | WV | America/New_York |
| IN | America/Indiana/Indianapolis | NM | America/Denver | WI | America/Chicago |
| IA | America/Chicago | NY | America/New_York | WY | America/Denver |
| KS | America/Chicago | NC | America/New_York | | |

**Fallback for unknown / null state:** `America/New_York` (matches the largest population center default).

**Override list (settings dropdown):** the 9 unique zones plus `UTC` for B2B-only practices: `UTC`, `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `America/Boise`, `America/Indiana/Indianapolis`, `Pacific/Honolulu`.

---

## Helper signature + behavior

```ts
// src/lib/audit/format.ts

/**
 * Format a Date as YYYY-MM-DD in the practice's timezone.
 * Replaces every `.toISOString().slice(0, 10)` call site.
 *
 * - tz: an IANA zone (e.g. "America/Phoenix"). null/undefined/invalid → "UTC".
 * - date: any Date. null is the caller's responsibility — this helper
 *   throws on null to fail loud.
 *
 * Implementation note: uses Intl.DateTimeFormat which is V8-backed in
 * Node 20+ and matches the browser's Intl.DateTimeFormat exactly. We use
 * "en-CA" locale because it natively renders YYYY-MM-DD without manual
 * piecing of parts.
 */
export function formatPracticeDate(date: Date, tz: string | null | undefined): string;

/**
 * Format a Date as "Apr 29, 2026" in the practice's timezone.
 * For UI badges + email body where YYYY-MM-DD is too utilitarian.
 */
export function formatPracticeDateLong(date: Date, tz: string | null | undefined): string;

/**
 * Format a Date as "2026-04-29 15:42 MST" — date + 24h time + zone abbr.
 * Used by audit-trail PDF rows where a precise timestamp matters.
 */
export function formatPracticeDateTime(date: Date, tz: string | null | undefined): string;

/**
 * Returns true if `tz` is a valid IANA zone identifier accepted by V8/Intl.
 * Internal helper used by all three formatters; exported for testing.
 */
export function isValidTimezone(tz: string): boolean;
```

**Fallback rule:** if `isValidTimezone(tz) === false` OR `tz == null`, every formatter falls back to `"UTC"` and produces the same string the legacy code did. This means a never-backfilled row still renders correctly (just in UTC), so deploy is safe even if the backfill is delayed.

**No throwing on invalid TZ:** the helper logs once and degrades. PDFs / emails MUST NOT crash on a bad value.

---

## Per-site replacement plan

48 files contain `toISOString().slice(0, 10)`. Bucketed by sweep:

### Audit/PDF sweep (Task 3) — 13 files

`src/lib/audit/incident-breach-memo-pdf.tsx`, `osha-300-pdf.tsx`, `osha-301-pdf.tsx`, `credentials-register-pdf.tsx`, `vendor-baa-register-pdf.tsx`, `pp-attestation-pdf.tsx`, `dea-form-41-pdf.tsx`, `dea-form-106-pdf.tsx`, `dea-inventory-pdf.tsx`, `incident-summary-pdf.tsx`, `training-summary-pdf.tsx`, `compliance-report-pdf.tsx`, `src/lib/audit-prep/packet-pdf.tsx`.

Each PDF: (a) add `practiceTimezone: string` to its input interface, (b) replace local `formatDate(d)` body with `formatPracticeDate(d, input.practiceTimezone)`. Routes that invoke each PDF: pass `pu.practice.timezone ?? "UTC"`.

PDF route handlers to update (~9 files):
- `src/app/api/audit/incident-breach-memo/[id]/route.tsx`
- `src/app/api/audit/osha-300/[year]/route.tsx`
- `src/app/api/audit/osha-301/[id]/route.tsx`
- `src/app/api/audit/credentials-register/route.ts`
- `src/app/api/audit/vendor-baa-register/route.ts`
- `src/app/api/audit/dea-inventory/[id]/route.tsx`
- `src/app/api/audit/dea-form-41/[id]/route.tsx`
- `src/app/api/audit/dea-form-106/[id]/route.tsx`
- `src/app/api/audit/compliance-report/route.ts`

(Confirm exact paths during execution — Glob `src/app/api/audit/**/*.{ts,tsx}` first.)

### Notification sweep (Task 4) — 3 files

- `src/lib/notifications/generators.ts` (10 generators × ~16 call sites)
- `src/lib/notifications/run-digest.ts` (fetch `primaryState` + `timezone`; thread)
- `src/lib/notifications/critical-alert.ts` (same threading; check call sites)

### Badge / UI sweep (Task 5) — ~32 files

5 badge components:
- `src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx`
- (verify path) `src/app/(dashboard)/programs/risk/SraAssessmentBadge.tsx`
- (verify path) `src/app/(dashboard)/programs/policies/AdoptedBadge.tsx`
- (verify path) `src/app/(dashboard)/programs/training/TrainingStatusBadge.tsx`
- (verify path) `src/app/(dashboard)/programs/vendors/BaaStatusBadge.tsx`

3 Extras components: `DeaExtras.tsx`, `CliaExtras.tsx`, `AllergyExtras.tsx`.

Concierge tools: `src/lib/ai/conciergeTools.ts`.

Dashboard pages with inline `.toISOString().slice(0, 10)` — replace via `formatPracticeDate(d, usePracticeTimezone())`:
- `src/app/(dashboard)/programs/policies/[id]/page.tsx`
- `src/app/(dashboard)/programs/policies/[id]/history/page.tsx`
- `src/app/(dashboard)/programs/document-retention/page.tsx`
- `src/app/(dashboard)/programs/document-retention/[id]/page.tsx`
- `src/app/(dashboard)/programs/document-retention/NewDestructionForm.tsx`
- `src/app/(dashboard)/programs/cybersecurity/page.tsx`
- `src/app/(dashboard)/programs/cybersecurity/PhishingDrillForm.tsx`
- `src/app/(dashboard)/programs/cybersecurity/BackupVerificationForm.tsx`
- `src/app/(dashboard)/programs/allergy/DrillTab.tsx`
- `src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx`
- `src/app/(dashboard)/programs/vendors/[id]/VendorDetail.tsx`
- `src/app/(dashboard)/programs/dea/NewTheftLossForm.tsx`
- `src/app/(dashboard)/programs/dea/NewOrderForm.tsx`
- `src/app/(dashboard)/programs/dea/NewInventoryForm.tsx`
- `src/app/(dashboard)/programs/dea/NewDisposalForm.tsx`
- `src/app/(dashboard)/programs/incidents/page.tsx`
- `src/app/(dashboard)/programs/incidents/[id]/page.tsx`
- `src/app/(dashboard)/programs/incidents/new/IncidentReportForm.tsx`
- `src/app/(dashboard)/audit/calendar/page.tsx`
- `src/app/(dashboard)/audit/prep/page.tsx`
- `src/app/(dashboard)/audit/prep/[id]/page.tsx`
- `src/app/admin/practices/page.tsx`
- `src/app/admin/practices/[id]/page.tsx`
- `src/app/(auth)/sign-up/payment/success/page.tsx`
- `src/app/accept-invite/[token]/page.tsx`
- `src/app/accept-baa/[token]/page.tsx`
- `src/lib/cyber/readiness.ts`

### Out of scope (do NOT touch)

- `src/components/gw/BulkCsvImport/parseCsv.ts` — the `toISOString().slice(0, 10)` here is in CSV escape logic for the `today` row tag, not user-facing date rendering. Leave it.
- Anything that stores a date as a string in the DB (none exist in v2).
- Stripe / Resend timestamps — those render as ISO in admin tooling and don't need TZ awareness.

---

## Backfill strategy

`scripts/backfill-practice-timezone.ts` (idempotent):

```ts
import { db } from "@/lib/db";
import { defaultTimezoneForState } from "@/lib/timezone/stateDefaults";

export async function backfillPracticeTimezone(): Promise<{ updated: number; skipped: number }> {
  const candidates = await db.practice.findMany({
    where: { timezone: null },
    select: { id: true, primaryState: true },
  });
  let updated = 0;
  let skipped = 0;
  for (const p of candidates) {
    const tz = defaultTimezoneForState(p.primaryState);
    if (!tz) { skipped++; continue; }
    await db.practice.update({ where: { id: p.id }, data: { timezone: tz } });
    updated++;
  }
  return { updated, skipped };
}

if (require.main === module) {
  backfillPracticeTimezone()
    .then(({ updated, skipped }) => {
      console.log(`Done. updated=${updated} skipped=${skipped}`);
      process.exit(0);
    })
    .catch((err) => { console.error("Backfill failed:", err); process.exit(1); });
}
```

**Run sequence:**
1. Merge schema migration PR → Cloud Build runs `prisma db push` → `timezone` column exists, all rows null.
2. Run `npx tsx scripts/backfill-practice-timezone.ts` against prod via the same proxy ritual documented in `docs/deploy/auto-migrations.md` § "Manual migration fallback".
3. Verify: `SELECT primaryState, timezone, count(*) FROM "Practice" GROUP BY primaryState, timezone;` — every row should have a non-null timezone.

**Resilience:** if backfill is delayed, the helper falls back to UTC for any row with `timezone IS NULL`, matching legacy behavior. No production breakage if backfill never runs (just renders UTC dates for stragglers).

---

## Test plan

| Layer | File | Coverage |
|---|---|---|
| Helper unit | `src/lib/audit/format.test.ts` | AZ summer 6pm-local boundary, NY DST spring-forward + fall-back boundaries, HI midnight-UTC boundary, invalid TZ falls back to UTC, null TZ falls back to UTC, `isValidTimezone` accepts known zones + rejects garbage |
| State-default unit | `src/lib/timezone/stateDefaults.test.ts` | All 51 `US_STATES` codes have a default; AZ → Phoenix; HI → Honolulu; AK → Anchorage; DC → New_York; FL → New_York; TX → Chicago; ID → Boise; IN → Indianapolis; defaultTimezoneForState("XX") → America/New_York (fallback); empty string → America/New_York |
| Context unit | `src/lib/timezone/PracticeTimezoneContext.test.tsx` | hook returns provider value; hook returns `"UTC"` outside any provider |
| Backfill integration | `scripts/__tests__/backfill-practice-timezone.test.ts` | seed practices: one with timezone null + AZ, one with timezone null + HI, one with timezone already set; assert AZ → America/Phoenix, HI → Pacific/Honolulu, pre-set untouched |
| PDF integration | `tests/integration/pdf-timezone.test.ts` | seed AZ practice, render incident-breach-memo for an incident discovered 2026-06-30T23:30:00Z (which is 16:30 MST same day in AZ); assert PDF buffer text contains "2026-06-30" not "2026-07-01" |
| Notification integration | `tests/integration/notifications-timezone.test.ts` | seed HI practice with credential expiring 2026-12-31T08:00:00Z (which is 22:00 HI on 2026-12-30); run `generateCredentialNotifications`; assert proposal.body contains "2026-12-30" not "2026-12-31" |
| Form component | `src/components/gw/PracticeProfileForm/PracticeProfileForm.test.tsx` (extend) | timezone select renders; changing primaryState auto-updates timezone if it was the prior default; manual override survives primaryState change |
| Action integration | extend `tests/integration/practice-profile-settings.test.ts` (or matching name) | save with explicit timezone persists; save without timezone keeps the existing one |
| Badge component | (new) `CredentialStatusBadge.test.tsx` | render inside `<PracticeTimezoneProvider value="America/Phoenix">` with expiryDate `2026-07-01T01:00:00Z` (which is 6pm MST 2026-06-30); assert "Jun 30" appears, not "Jul 1" |

**Acceptance criteria:** combined test suite goes from 801 → ~830 (+29). All green. ESLint clean. `prisma db push` against the test database returns "already in sync" after the schema change is committed.

---

## Task 1 — Migration, state map, data wiring

**Files:**
- Modify: `prisma/schema.prisma:75-157` (Practice model)
- Create: `src/lib/timezone/stateDefaults.ts`
- Create: `src/lib/timezone/stateDefaults.test.ts`
- Modify: `src/components/gw/PracticeProfileForm/types.ts`
- Modify: `src/components/gw/PracticeProfileForm/index.tsx`
- Modify: `src/app/(dashboard)/settings/practice/page.tsx:32-51`
- Modify: `src/app/(dashboard)/settings/practice/actions.ts:26-65`
- Modify: `src/lib/events/projections/practiceProfileSettings.ts` (verify path; check imports in actions.ts)
- Modify: `src/app/onboarding/create-practice/actions.ts:9-23`
- Create: `scripts/backfill-practice-timezone.ts`
- Create: `scripts/__tests__/backfill-practice-timezone.test.ts`

- [ ] **Step 1.1: Write the failing state-default test**

Create `src/lib/timezone/stateDefaults.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { US_STATES } from "@/lib/states";
import { STATE_DEFAULT_TIMEZONE, defaultTimezoneForState } from "./stateDefaults";

describe("STATE_DEFAULT_TIMEZONE", () => {
  it("has an entry for every US_STATES code", () => {
    for (const s of US_STATES) {
      expect(STATE_DEFAULT_TIMEZONE[s.code], `missing ${s.code}`).toBeDefined();
    }
  });
  it.each([
    ["AZ", "America/Phoenix"],
    ["HI", "Pacific/Honolulu"],
    ["AK", "America/Anchorage"],
    ["DC", "America/New_York"],
    ["FL", "America/New_York"],
    ["TX", "America/Chicago"],
    ["ID", "America/Boise"],
    ["IN", "America/Indiana/Indianapolis"],
    ["NY", "America/New_York"],
    ["CA", "America/Los_Angeles"],
  ])("%s defaults to %s", (state, tz) => {
    expect(STATE_DEFAULT_TIMEZONE[state]).toBe(tz);
  });
});

describe("defaultTimezoneForState", () => {
  it("returns the entry for a known code", () => {
    expect(defaultTimezoneForState("AZ")).toBe("America/Phoenix");
  });
  it("normalizes lowercase", () => {
    expect(defaultTimezoneForState("az")).toBe("America/Phoenix");
  });
  it("falls back to America/New_York for unknown", () => {
    expect(defaultTimezoneForState("XX")).toBe("America/New_York");
    expect(defaultTimezoneForState("")).toBe("America/New_York");
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npx vitest run src/lib/timezone/stateDefaults.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement the state-default map**

Create `src/lib/timezone/stateDefaults.ts`:
```ts
// src/lib/timezone/stateDefaults.ts
//
// Maps each US_STATES code to its dominant IANA timezone. Multi-zone
// states pick the most populous zone; admins can override per practice
// in /settings/practice.

export const STATE_DEFAULT_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

const FALLBACK_TIMEZONE = "America/New_York";

/**
 * Returns the dominant IANA timezone for the given US state code.
 * Unknown / empty codes fall back to America/New_York (largest population).
 */
export function defaultTimezoneForState(state: string | null | undefined): string {
  if (!state) return FALLBACK_TIMEZONE;
  return STATE_DEFAULT_TIMEZONE[state.toUpperCase()] ?? FALLBACK_TIMEZONE;
}

/**
 * The canonical override list shown in /settings/practice's TZ dropdown.
 * Includes UTC for B2B-only practices that prefer absolute timestamps.
 */
export const SUPPORTED_TIMEZONES: readonly string[] = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Boise",
  "America/Indiana/Indianapolis",
  "Pacific/Honolulu",
] as const;
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `npx vitest run src/lib/timezone/stateDefaults.test.ts`
Expected: PASS — 13 tests green.

- [ ] **Step 1.5: Add `timezone` column to Prisma schema**

Edit `prisma/schema.prisma` — locate the Practice model (line 75). Add `timezone` after `entityType` (line 88), so the location-related cluster stays grouped:

```prisma
model Practice {
  id               String    @id @default(cuid())
  name             String
  primaryState     String // ISO state code, e.g. "AZ"
  operatingStates  String[]  @default([]) // additional states for multi-state practices
  // IANA timezone (e.g. "America/Phoenix"). null = pre-backfill row;
  // formatPracticeDate falls back to UTC. Default-derived from
  // primaryState at create time and via scripts/backfill-practice-timezone.ts.
  timezone         String?
  specialty        String?
  npiNumber        String?
  // ... rest unchanged
```

- [ ] **Step 1.6: Sync the local Prisma client + verify `db push` is in-sync against test DB**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx prisma generate && npx prisma db push --skip-generate
```
Expected: `prisma generate` succeeds; `db push` reports "Your database is now in sync with your Prisma schema." against the test database.

- [ ] **Step 1.7: Write the backfill test**

Create `scripts/__tests__/backfill-practice-timezone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { backfillPracticeTimezone } from "../backfill-practice-timezone";

describe("backfillPracticeTimezone", () => {
  it("backfills null timezones from primaryState defaults", async () => {
    await db.practice.create({
      data: { name: "AZ Practice", primaryState: "AZ" },
    });
    await db.practice.create({
      data: { name: "HI Practice", primaryState: "HI" },
    });
    await db.practice.create({
      data: { name: "Pre-set Practice", primaryState: "NY", timezone: "UTC" },
    });

    const result = await backfillPracticeTimezone();
    expect(result.updated).toBe(2);

    const az = await db.practice.findFirstOrThrow({ where: { name: "AZ Practice" } });
    const hi = await db.practice.findFirstOrThrow({ where: { name: "HI Practice" } });
    const preset = await db.practice.findFirstOrThrow({ where: { name: "Pre-set Practice" } });

    expect(az.timezone).toBe("America/Phoenix");
    expect(hi.timezone).toBe("Pacific/Honolulu");
    expect(preset.timezone).toBe("UTC");
  });

  it("is idempotent on a second run", async () => {
    await db.practice.create({
      data: { name: "Idempotent Test", primaryState: "TX" },
    });
    const first = await backfillPracticeTimezone();
    const second = await backfillPracticeTimezone();
    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
  });
});
```

- [ ] **Step 1.8: Run the backfill test (expect FAIL — script doesn't exist)**

Run: `npx vitest run scripts/__tests__/backfill-practice-timezone.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1.9: Implement the backfill script**

Create `scripts/backfill-practice-timezone.ts`:
```ts
// scripts/backfill-practice-timezone.ts
//
// One-shot migration: for every Practice with timezone null, set
// timezone = defaultTimezoneForState(primaryState). Idempotent.
//
// Run via: npx tsx scripts/backfill-practice-timezone.ts

import { db } from "@/lib/db";
import { defaultTimezoneForState } from "@/lib/timezone/stateDefaults";

export async function backfillPracticeTimezone(): Promise<{
  updated: number;
  skipped: number;
}> {
  const candidates = await db.practice.findMany({
    where: { timezone: null },
    select: { id: true, primaryState: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const p of candidates) {
    const tz = defaultTimezoneForState(p.primaryState);
    if (!tz) {
      skipped++;
      continue;
    }
    await db.practice.update({
      where: { id: p.id },
      data: { timezone: tz },
    });
    updated++;
  }

  return { updated, skipped };
}

if (require.main === module) {
  backfillPracticeTimezone()
    .then(({ updated, skipped }) => {
      console.log(`Done. updated=${updated} skipped=${skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 1.10: Run backfill test — expect PASS**

Run: `npx vitest run scripts/__tests__/backfill-practice-timezone.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 1.11: Wire timezone into `createPracticeAction`**

Edit `src/app/onboarding/create-practice/actions.ts:9-23`. Add the import and update the create call:

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { defaultTimezoneForState } from "@/lib/timezone/stateDefaults";

const Schema = z.object({
  name: z.string().min(1).max(200),
  primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
});

export async function createPracticeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = Schema.parse({
    name: String(formData.get("name") ?? ""),
    primaryState: String(formData.get("primaryState") ?? "").toUpperCase(),
  });

  const practice = await db.practice.create({
    data: {
      name: parsed.name,
      primaryState: parsed.primaryState,
      timezone: defaultTimezoneForState(parsed.primaryState),
    },
  });
  // ... rest unchanged
```

- [ ] **Step 1.12: Add timezone to PracticeProfileInput type**

Edit `src/components/gw/PracticeProfileForm/types.ts:7-26`:
```ts
export interface PracticeProfileInput {
  // Identity
  name: string;
  npiNumber: string | null;
  entityType: "COVERED_ENTITY" | "BUSINESS_ASSOCIATE";
  // Location
  primaryState: string;
  operatingStates: string[];
  /**
   * IANA timezone (e.g. "America/Phoenix"). null = use the
   * primaryState default. Surfaces in /settings/practice's
   * "Display timezone" select; never null after first save.
   */
  timezone: string | null;
  addressStreet: string | null;
  // ... rest unchanged
}
```

- [ ] **Step 1.13: Add timezone select to PracticeProfileForm**

Edit `src/components/gw/PracticeProfileForm/index.tsx`. Below the imports add:
```ts
import { SUPPORTED_TIMEZONES, defaultTimezoneForState } from "@/lib/timezone/stateDefaults";
```

Inside the component, replace the existing `update` function with one that also auto-syncs timezone when primaryState changes:
```ts
function update<K extends keyof PracticeProfileInput>(
  key: K,
  value: PracticeProfileInput[K],
) {
  setState((prev) => {
    const next = { ...prev, [key]: value } as PracticeProfileInput;
    // Auto-sync timezone when primaryState changes IF the prior tz
    // matched the prior state's default (i.e. user hadn't manually
    // overridden). This prevents stomping a deliberate override.
    if (key === "primaryState" && typeof value === "string") {
      const priorDefault = defaultTimezoneForState(prev.primaryState);
      if (prev.timezone === null || prev.timezone === priorDefault) {
        next.timezone = defaultTimezoneForState(value);
      }
    }
    return next;
  });
  setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  if (key === "specialty" && onSpecialtyChange) {
    onSpecialtyChange((value ?? null) as string | null);
  }
}
```

In the Location `<section>` (lines 146–238), add a new field after the `<StateMultiSelect>` block (after line 180, before the address grid):
```tsx
<div>
  <label htmlFor="timezone" className={labelClass}>
    Display timezone
  </label>
  <select
    id="timezone"
    value={state.timezone ?? defaultTimezoneForState(state.primaryState)}
    onChange={(e) => update("timezone", e.target.value)}
    className={inputClass}
  >
    {SUPPORTED_TIMEZONES.map((tz) => (
      <option key={tz} value={tz}>
        {tz}
      </option>
    ))}
  </select>
  <p className="mt-1 text-xs text-muted-foreground">
    Used for dates on PDFs, notification emails, and badges. Defaults from your primary state — change if your office is in a different zone.
  </p>
</div>
```

- [ ] **Step 1.14: Hydrate timezone in /settings/practice page**

Edit `src/app/(dashboard)/settings/practice/page.tsx:32-51`. Add `timezone` to the initial object:
```ts
const initial: PracticeProfileInput = {
  name: practice.name,
  npiNumber: practice.npiNumber,
  entityType:
    (practice.entityType as "COVERED_ENTITY" | "BUSINESS_ASSOCIATE") ??
    "COVERED_ENTITY",
  primaryState: practice.primaryState,
  operatingStates: practice.operatingStates ?? [],
  timezone: practice.timezone,
  addressStreet: practice.addressStreet,
  // ... rest unchanged
};
```

- [ ] **Step 1.15: Persist timezone in savePracticeProfileAction**

Edit `src/app/(dashboard)/settings/practice/actions.ts`:

In `InputSchema` (lines 26–44), add timezone after operatingStates:
```ts
const InputSchema = z.object({
  name: z.string().min(1).max(200),
  npiNumber: z.string().nullable(),
  entityType: z.enum(["COVERED_ENTITY", "BUSINESS_ASSOCIATE"]),
  primaryState: z.string().length(2),
  operatingStates: z.array(z.string().length(2)),
  timezone: z.string().nullable(),
  addressStreet: z.string().nullable(),
  // ... rest unchanged
});
```

In `TRACKED_FIELDS` (lines 50–65), add `"timezone"` after `"operatingStates"`:
```ts
const TRACKED_FIELDS = [
  "name",
  "npiNumber",
  "entityType",
  "primaryState",
  "operatingStates",
  "timezone",
  "addressStreet",
  // ... rest unchanged
] as const satisfies readonly (keyof PracticeProfileInput)[];
```

Open `src/lib/events/projections/practiceProfileSettings.ts` (verify the path matches the import on line 23 of actions.ts) and add `timezone` to the data object passed into `db.practice.update`. The exact code shape depends on the projection's current implementation — read it first, then add `timezone: data.timezone` alongside the other Practice fields. If the projection currently spreads `data` with `Pick<>` filters, add `"timezone"` to the field list.

- [ ] **Step 1.16: Run the full lint + type check**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit && npx eslint src/lib/timezone src/components/gw/PracticeProfileForm src/app/onboarding/create-practice src/app/\(dashboard\)/settings/practice scripts/backfill-practice-timezone.ts
```
Expected: clean.

- [ ] **Step 1.17: Run the full integration suite for affected paths**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run src/lib/timezone src/components/gw/PracticeProfileForm scripts/__tests__/backfill-practice-timezone.test.ts
```
Expected: all green.

- [ ] **Step 1.18: Commit**

```bash
cd D:/GuardWell/guardwell-v2 && git add prisma/schema.prisma src/lib/timezone src/components/gw/PracticeProfileForm src/app/\(dashboard\)/settings/practice src/app/onboarding/create-practice src/lib/events/projections/practiceProfileSettings.ts scripts/backfill-practice-timezone.ts scripts/__tests__/backfill-practice-timezone.test.ts && git commit -m "feat(practice): add timezone column + state-default map + backfill"
```

---

## Task 2 — formatPracticeDate helper + context provider

**Files:**
- Create: `src/lib/audit/format.ts`
- Create: `src/lib/audit/format.test.ts`
- Create: `src/lib/timezone/PracticeTimezoneContext.tsx`
- Create: `src/lib/timezone/PracticeTimezoneContext.test.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 2.1: Write failing helper tests**

Create `src/lib/audit/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  formatPracticeDate,
  formatPracticeDateLong,
  formatPracticeDateTime,
  isValidTimezone,
} from "./format";

describe("formatPracticeDate", () => {
  it("renders an AZ-evening UTC date as the AZ-local day", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 18:00 in MST (America/Phoenix is UTC-7, no DST)
    const d = new Date("2026-07-01T01:00:00Z");
    expect(formatPracticeDate(d, "America/Phoenix")).toBe("2026-06-30");
  });

  it("renders an HI-late-night UTC date as the HI-local day", () => {
    // 2026-12-31T08:00:00Z = 2026-12-30 22:00 in HST (UTC-10, no DST)
    const d = new Date("2026-12-31T08:00:00Z");
    expect(formatPracticeDate(d, "Pacific/Honolulu")).toBe("2026-12-30");
  });

  it("respects DST: NY 03:30 UTC on 2026-03-08 is still the prior day local", () => {
    // Spring-forward: 2026-03-08 02:00 EST → 03:00 EDT. 03:30 UTC = 22:30 prior-day EST → "2026-03-07"
    const d = new Date("2026-03-08T03:30:00Z");
    expect(formatPracticeDate(d, "America/New_York")).toBe("2026-03-07");
  });

  it("renders UTC as YYYY-MM-DD when tz is UTC", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), "UTC")).toBe("2026-04-29");
  });

  it("falls back to UTC on null tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), null)).toBe("2026-04-29");
  });

  it("falls back to UTC on invalid tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), "Not/A/Zone")).toBe(
      "2026-04-29",
    );
  });

  it("falls back to UTC on undefined tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), undefined)).toBe(
      "2026-04-29",
    );
  });
});

describe("formatPracticeDateLong", () => {
  it("renders 'Apr 29, 2026' style output", () => {
    expect(formatPracticeDateLong(new Date("2026-04-29T12:00:00Z"), "America/New_York")).toBe(
      "Apr 29, 2026",
    );
  });

  it("respects timezone for boundary dates", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 in AZ
    expect(formatPracticeDateLong(new Date("2026-07-01T01:00:00Z"), "America/Phoenix")).toBe(
      "Jun 30, 2026",
    );
  });
});

describe("formatPracticeDateTime", () => {
  it("renders date + 24h time + zone abbr", () => {
    const out = formatPracticeDateTime(new Date("2026-04-29T15:42:00Z"), "America/Phoenix");
    expect(out).toMatch(/^2026-04-29 08:42 (MST|GMT-7)$/);
  });
});

describe("isValidTimezone", () => {
  it("accepts known IANA zones", () => {
    expect(isValidTimezone("America/Phoenix")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Pacific/Honolulu")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValidTimezone("Not/A/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("foo")).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npx vitest run src/lib/audit/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the helper**

Create `src/lib/audit/format.ts`:
```ts
// src/lib/audit/format.ts
//
// Practice-aware date formatters. Replaces every `.toISOString().slice(0, 10)`
// call site so audit-defense PDFs, notification email bodies, and UI badges
// render dates in the practice's timezone (set via Practice.timezone).
//
// Implementation detail: native Intl.DateTimeFormat is used (V8-backed in
// Node 20+, identical in browsers). No `date-fns-tz` dependency.

const DATE_FALLBACK_TZ = "UTC";

const validTzCache = new Map<string, boolean>();

/**
 * Returns true when `tz` is a valid IANA zone accepted by V8/Intl.
 * Cached per process for hot-path call sites (notifications + PDF rows).
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  const cached = validTzCache.get(tz);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    validTzCache.set(tz, true);
    return true;
  } catch {
    validTzCache.set(tz, false);
    return false;
  }
}

function resolveTimezone(tz: string | null | undefined): string {
  if (!tz) return DATE_FALLBACK_TZ;
  return isValidTimezone(tz) ? tz : DATE_FALLBACK_TZ;
}

/**
 * Format `date` as YYYY-MM-DD in the practice's `tz`. Replaces every
 * `.toISOString().slice(0, 10)` call site. Null/invalid tz falls back to UTC.
 *
 * Locale "en-CA" natively renders YYYY-MM-DD (no manual part-piecing).
 */
export function formatPracticeDate(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Format `date` as "Apr 29, 2026" in the practice's `tz`.
 * For UI badges + email body where a friendlier surface is needed.
 */
export function formatPracticeDateLong(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Format `date` as "2026-04-29 15:42 MST" — date + 24h time + zone abbr.
 * Used for audit-trail PDF rows where a precise timestamp matters.
 */
export function formatPracticeDateTime(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const datePart = `${get("year")}-${get("month")}-${get("day")}`;
  const timePart = `${get("hour")}:${get("minute")}`;
  const zoneAbbr = get("timeZoneName");
  return `${datePart} ${timePart} ${zoneAbbr}`;
}
```

- [ ] **Step 2.4: Run helper tests — expect PASS**

Run: `npx vitest run src/lib/audit/format.test.ts`
Expected: PASS — all green. (If the `formatPracticeDateTime` regex fails because Node returns a different short-name like `GMT-7`, adjust the regex to `/^2026-04-29 08:42 (MST|GMT-7)$/` — it already accepts both. If a third format appears, broaden the regex.)

- [ ] **Step 2.5: Write failing context tests**

Create `src/lib/timezone/PracticeTimezoneContext.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PracticeTimezoneProvider,
  usePracticeTimezone,
} from "./PracticeTimezoneContext";

function Probe() {
  const tz = usePracticeTimezone();
  return <span data-testid="tz">{tz}</span>;
}

describe("PracticeTimezoneProvider", () => {
  it("provides the tz to descendants via the hook", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <Probe />
      </PracticeTimezoneProvider>,
    );
    expect(screen.getByTestId("tz").textContent).toBe("America/Phoenix");
  });

  it("falls back to UTC when no provider is mounted", () => {
    render(<Probe />);
    expect(screen.getByTestId("tz").textContent).toBe("UTC");
  });
});
```

- [ ] **Step 2.6: Run test — expect FAIL**

Run: `npx vitest run src/lib/timezone/PracticeTimezoneContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 2.7: Implement the context provider**

Create `src/lib/timezone/PracticeTimezoneContext.tsx`:
```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

const PracticeTimezoneContext = createContext<string>("UTC");

export function PracticeTimezoneProvider({
  value,
  children,
}: {
  value: string | null | undefined;
  children: ReactNode;
}) {
  // Normalize null/undefined to UTC so consumers always get a string.
  return (
    <PracticeTimezoneContext.Provider value={value ?? "UTC"}>
      {children}
    </PracticeTimezoneContext.Provider>
  );
}

/**
 * Returns the practice's IANA timezone ("UTC" if no provider is mounted).
 * Used by badges + dashboard pages to format dates consistently with
 * server-side PDF/notification rendering.
 */
export function usePracticeTimezone(): string {
  return useContext(PracticeTimezoneContext);
}
```

- [ ] **Step 2.8: Run context test — expect PASS**

Run: `npx vitest run src/lib/timezone/PracticeTimezoneContext.test.tsx`
Expected: PASS.

- [ ] **Step 2.9: Mount the provider in the dashboard layout**

Edit `src/app/(dashboard)/layout.tsx`. Add the import and update the practice fetch + return:

After line 8, add:
```ts
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
```

Replace lines 30–44 (the existing `db.practice.findUniqueOrThrow` for subscription) with a richer fetch that also includes timezone. Or add a separate select. Cleanest path: extend the existing fetch:
```ts
if (pu.role === "OWNER" || pu.role === "ADMIN") {
  const sub = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { subscriptionStatus: true, timezone: true },
  });
  if (sub.subscriptionStatus === "INCOMPLETE") {
    redirect("/sign-up/payment" as Route);
  }
  if (
    sub.subscriptionStatus === "PAST_DUE" ||
    sub.subscriptionStatus === "CANCELED"
  ) {
    redirect("/account/locked" as Route);
  }
}
```

But STAFF/VIEWER roles never hit that branch. Add a separate fetch above the AppShell render that always reads `timezone`:
```ts
const { timezone: practiceTimezone } = await db.practice.findUniqueOrThrow({
  where: { id: pu.practiceId },
  select: { timezone: true },
});
```

Wrap the existing return JSX:
```tsx
return (
  <PracticeTimezoneProvider value={practiceTimezone}>
    <AppShell
      practice={{ name: pu.practice.name }}
      user={{ email: pu.dbUser.email }}
      myComplianceItems={myComplianceItems}
      enabledFrameworkCodes={enabledFrameworkCodes}
      notifications={notificationSummary}
    >
      {children}
    </AppShell>
    <ConciergeTrigger />
  </PracticeTimezoneProvider>
);
```

- [ ] **Step 2.10: Type check + lint**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit && npx eslint src/lib/audit/format.ts src/lib/timezone src/app/\(dashboard\)/layout.tsx
```
Expected: clean.

- [ ] **Step 2.11: Run combined unit suite for the helper + context**

Run: `npx vitest run src/lib/audit/format.test.ts src/lib/timezone`
Expected: all green.

- [ ] **Step 2.12: Commit**

```bash
cd D:/GuardWell/guardwell-v2 && git add src/lib/audit/format.ts src/lib/audit/format.test.ts src/lib/timezone/PracticeTimezoneContext.tsx src/lib/timezone/PracticeTimezoneContext.test.tsx src/app/\(dashboard\)/layout.tsx && git commit -m "feat(audit): add formatPracticeDate helper + PracticeTimezoneProvider"
```

---

## Task 3 — Audit/PDF sweep

**Files:**
- Modify all 13 PDF components in `src/lib/audit/*.tsx` and `src/lib/audit-prep/packet-pdf.tsx`
- Modify all PDF API route handlers in `src/app/api/audit/**/route.{ts,tsx}`
- Create: `tests/integration/pdf-timezone.test.ts`

**Subagent prep (do this first):**

- [ ] **Step 3.0: Discover the exact set of PDF + route files**

Run two `Glob`s:
- `src/lib/audit/*-pdf.tsx`
- `src/lib/audit-prep/*-pdf.tsx`
- `src/app/api/audit/**/route.{ts,tsx}`

Note the exact paths returned. The plan lists 13 PDF files and ~9 routes; verify counts match before editing.

- [ ] **Step 3.1: Write the failing PDF integration test (representative case)**

Create `tests/integration/pdf-timezone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { IncidentBreachMemoDocument } from "@/lib/audit/incident-breach-memo-pdf";

describe("PDF timezone rendering", () => {
  it("renders incident-breach-memo dates in the practice's timezone (AZ)", async () => {
    const practice = await db.practice.create({
      data: {
        name: "AZ Smoke",
        primaryState: "AZ",
        timezone: "America/Phoenix",
      },
    });

    // 2026-07-01T01:00:00Z = 2026-06-30 18:00 MST → expect "2026-06-30" in PDF
    const buffer = await renderToBuffer(
      <IncidentBreachMemoDocument
        input={{
          practiceName: practice.name,
          practiceState: practice.primaryState,
          practiceTimezone: practice.timezone ?? "UTC",
          generatedAt: new Date("2026-07-01T01:00:00Z"),
          incident: {
            title: "Test incident",
            type: "PRIVACY",
            severity: "MEDIUM",
            discoveredAt: new Date("2026-07-01T01:00:00Z"),
            phiInvolved: true,
            patientState: null,
            affectedCount: 100,
            factor1Score: 1,
            factor2Score: 1,
            factor3Score: 1,
            factor4Score: 1,
            overallRiskScore: 4,
            isBreach: false,
            ocrNotifyRequired: false,
            breachDeterminationMemo: null,
            breachDeterminedAt: new Date("2026-07-01T01:00:00Z"),
          },
          notifications: {
            ocrNotifiedAt: null,
            affectedIndividualsNotifiedAt: null,
            mediaNotifiedAt: null,
            stateAgNotifiedAt: null,
          },
        }}
      />,
    );

    const text = buffer.toString("latin1");
    expect(text).toContain("2026-06-30");
    expect(text).not.toContain("2026-07-01");
  });
});
```

- [ ] **Step 3.2: Run test — expect FAIL (input shape doesn't match yet)**

Run: `npx vitest run tests/integration/pdf-timezone.test.ts`
Expected: FAIL — type error or "2026-07-01" still appears.

- [ ] **Step 3.3: Update `incident-breach-memo-pdf.tsx`**

Edit `src/lib/audit/incident-breach-memo-pdf.tsx`:

1. Add import at the top:
```ts
import { formatPracticeDate, formatPracticeDateTime } from "@/lib/audit/format";
```

2. Add `practiceTimezone: string` to the `BreachMemoInput` interface (find where `practiceState: string` is declared and add the field next to it).

3. Delete the local `formatDate` function (line 217–219). Delete `formatDateTime` if it exists (line 221–223).

4. Replace every call site:
```ts
// Before:
formatDate(incident.discoveredAt)
// After:
formatPracticeDate(incident.discoveredAt, input.practiceTimezone)

// Before:
formatDateTime(incident.breachDeterminedAt)
// After:
formatPracticeDateTime(incident.breachDeterminedAt, input.practiceTimezone)
```

5. Update the route caller `src/app/api/audit/incident-breach-memo/[id]/route.tsx:81-113` — add `practiceTimezone: pu.practice.timezone ?? "UTC"` to the input object.

   Also update the `getPracticeUser` consumer: the `pu.practice` shape needs to include `timezone`. Read `src/lib/rbac.ts` and confirm `getPracticeUser()` returns timezone in the `practice` object. If it doesn't, modify `getPracticeUser` to `include: { practice: { select: { ..., timezone: true } } }` (or whatever the existing shape uses). If the function already does `practice: true` (whole row), no change needed.

- [ ] **Step 3.4: Run test — expect PASS**

Run: `npx vitest run tests/integration/pdf-timezone.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Repeat for each remaining PDF**

For each of the following PDF components, perform the same 4 changes (add import, add `practiceTimezone` to input interface, replace `formatDate` body / inline `toISOString().slice(0, 10)`, update calling route to pass the field):

1. `src/lib/audit/osha-300-pdf.tsx` — input is `Osha300Input`. `formatDate` at line 113. Route: `src/app/api/audit/osha-300/[year]/route.tsx`.
2. `src/lib/audit/osha-301-pdf.tsx` — input is `Osha301Input`. `formatDate` at line 101. Route: `src/app/api/audit/osha-301/[id]/route.tsx`.
3. `src/lib/audit/credentials-register-pdf.tsx` — uses inline `input.generatedAt.toISOString().slice(0, 10)` at line 150 + status-related `toISOString().slice(0, 10)` calls in `statusFor` helper. Route: `src/app/api/audit/credentials-register/route.ts`.
4. `src/lib/audit/vendor-baa-register-pdf.tsx` — inline at line 154, 220.
5. `src/lib/audit/pp-attestation-pdf.tsx` — inline at line 178, 216.
6. `src/lib/audit/dea-form-41-pdf.tsx` — `formatDate` function. Route: `src/app/api/audit/dea-form-41/[id]/route.tsx`.
7. `src/lib/audit/dea-form-106-pdf.tsx` — `formatDate` function. Route: `src/app/api/audit/dea-form-106/[id]/route.tsx`.
8. `src/lib/audit/dea-inventory-pdf.tsx` — `formatDate` function. Route: `src/app/api/audit/dea-inventory/[id]/route.tsx`.
9. `src/lib/audit/incident-summary-pdf.tsx` — inline at line 136, 214, 221.
10. `src/lib/audit/training-summary-pdf.tsx` — inline at line 138, 203, 207.
11. `src/lib/audit/compliance-report-pdf.tsx` — inline at line 214, 338, 389. Route: `src/app/api/audit/compliance-report/route.ts`.
12. `src/lib/audit-prep/packet-pdf.tsx` — inline at line 102, 105. Caller: `src/app/(dashboard)/audit/prep/[id]/page.tsx` or its API route.

For each, after editing, run the type check incrementally:
```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit
```

If `getPracticeUser` doesn't already return `timezone`, add a one-line modification to `src/lib/rbac.ts` so `pu.practice.timezone` is available everywhere. (Verify before assuming — read `src/lib/rbac.ts` first.)

- [ ] **Step 3.6: Run integration suite for PDFs**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/pdf-timezone.test.ts tests/integration/audit-prep.test.ts
```
Expected: all green.

- [ ] **Step 3.7: Verify no remaining PDF call sites use `.toISOString().slice(0, 10)`**

Run:
```bash
npx eslint src/lib/audit src/lib/audit-prep src/app/api/audit
```

Run a Grep to confirm:
- Pattern: `\.toISOString\(\)\.slice\(0, 10\)`
- Path: `src/lib/audit src/lib/audit-prep src/app/api/audit`

Expected: zero matches.

- [ ] **Step 3.8: Commit**

```bash
cd D:/GuardWell/guardwell-v2 && git add src/lib/audit src/lib/audit-prep src/app/api/audit src/lib/rbac.ts tests/integration/pdf-timezone.test.ts && git commit -m "feat(audit): render PDF dates in practice timezone"
```

---

## Task 4 — Notification sweep

**Files:**
- Modify: `src/lib/notifications/run-digest.ts`
- Modify: `src/lib/notifications/generators.ts`
- Modify: `src/lib/notifications/critical-alert.ts`
- Create: `tests/integration/notifications-timezone.test.ts`

- [ ] **Step 4.0: Discover all generator call sites**

Read `src/lib/notifications/generators.ts` end-to-end. Map every exported `generate*` function and every `.toISOString().slice(0, 10)` call inside. There are ~10 generators; confirm count.

Read `src/lib/notifications/critical-alert.ts`. Note its public function signature.

- [ ] **Step 4.1: Write the failing notification test**

Create `tests/integration/notifications-timezone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { generateCredentialNotifications } from "@/lib/notifications/generators";

describe("notifications timezone", () => {
  it("renders credential expiry dates in HI practice's timezone", async () => {
    const user = await db.user.create({
      data: { email: "hi@example.com", emailVerified: new Date() },
    });
    const practice = await db.practice.create({
      data: {
        name: "HI Smoke",
        primaryState: "HI",
        timezone: "Pacific/Honolulu",
      },
    });
    const pu = await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
    });
    const credentialType = await db.credentialType.findFirstOrThrow();
    // 2026-12-31T08:00:00Z = 2026-12-30 22:00 HST → expect "2026-12-30"
    await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: pu.id,
        title: "DEA registration",
        credentialTypeId: credentialType.id,
        expiryDate: new Date("2026-12-31T08:00:00Z"),
      },
    });

    const proposals = await generateCredentialNotifications(
      db,
      practice.id,
      [user.id],
      "Pacific/Honolulu",
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.body).toContain("2026-12-30");
    expect(proposals[0]?.body).not.toContain("2026-12-31");
  });
});
```

- [ ] **Step 4.2: Run test — expect FAIL**

Run: `npx vitest run tests/integration/notifications-timezone.test.ts`
Expected: FAIL — generator signature mismatch.

- [ ] **Step 4.3: Add `practiceTimezone` parameter to all generators**

Edit `src/lib/notifications/generators.ts`. At the top, add:
```ts
import { formatPracticeDate } from "@/lib/audit/format";
```

For every exported generator, add `practiceTimezone: string` as the LAST parameter (preserves least-disruption ordering for any external callers not yet updated). Example for `generateSraNotifications`:
```ts
export async function generateSraNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
```

Repeat for: `generateCredentialNotifications`, `generateCredentialRenewalNotifications`, `generateVendorBaaNotifications`, `generateIncidentNotifications`, `generateAllergyNotifications`, `generatePolicyReviewNotifications`, `generateTrainingNotifications`, `generateBreachDeadlineNotifications`, and any others. Confirm the full list during execution by searching for `export async function generate` in the file.

For every `.toISOString().slice(0, 10)` call site inside these generators, replace it with:
```ts
formatPracticeDate(theDate, practiceTimezone)
```

Example (lines 74–75):
```ts
// Before:
const body =
  daysLeft <= 0
    ? `Your most recent Security Risk Assessment was completed ${latest.completedAt.toISOString().slice(0, 10)} and is now past the 365-day obligation window. Run a fresh SRA to restore HIPAA_SRA compliance.`
    : `Your most recent SRA was completed ${latest.completedAt.toISOString().slice(0, 10)}. Plan the next one — HIPAA_SRA flips GAP on ${dueDate.toISOString().slice(0, 10)}.`;

// After:
const body =
  daysLeft <= 0
    ? `Your most recent Security Risk Assessment was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)} and is now past the 365-day obligation window. Run a fresh SRA to restore HIPAA_SRA compliance.`
    : `Your most recent SRA was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)}. Plan the next one — HIPAA_SRA flips GAP on ${formatPracticeDate(dueDate, practiceTimezone)}.`;
```

NOTE: `entityKey` must remain stable across timezones. The current pattern is `credential:${c.id}:${c.expiryDate.toISOString().slice(0, 10)}` (line 129). Keep `toISOString().slice(0, 10)` for entityKey computation (it's a dedup hash, never user-facing). Only replace the user-facing `body` strings.

To make this explicit and prevent confusion, leave a one-line comment at each entityKey site:
```ts
// entityKey is a UTC-stable dedup hash — do NOT replace with formatPracticeDate
const entityKey = `credential:${c.id}:${c.expiryDate.toISOString().slice(0, 10)}`;
```

- [ ] **Step 4.4: Update `generateAllNotifications` to thread the timezone**

In `generators.ts`, find the `generateAllNotifications` orchestrator (or add it if missing — verify by searching `export async function generateAllNotifications`). Add `practiceTimezone: string` as a parameter and pass it through to every child generator call:

```ts
export async function generateAllNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  return [
    ...(await generateSraNotifications(tx, practiceId, userIds, practiceTimezone)),
    ...(await generateCredentialNotifications(tx, practiceId, userIds, practiceTimezone)),
    // ... continue for every generator
  ];
}
```

- [ ] **Step 4.5: Update `runNotificationDigest` to pass timezone**

Edit `src/lib/notifications/run-digest.ts:44-73`:
```ts
const practices = await db.practice.findMany({
  where: { deletedAt: null },
  select: { id: true, name: true, primaryState: true, timezone: true },
});
```

Then update the call to `generateAllNotifications` (line 69):
```ts
const proposals = await generateAllNotifications(
  db,
  practice.id,
  userIds,
  practice.timezone ?? "UTC",
);
```

- [ ] **Step 4.6: Update `composeDigestEmail` if it formats dates**

Read `src/lib/notifications/compose-digest.ts`. If it formats dates anywhere (look for `.toISOString().slice(0, 10)` or any `Date` formatting), add `practiceTimezone` as a parameter and thread it through. Pass `practice.timezone ?? "UTC"` from `run-digest.ts:119-124`.

If `compose-digest.ts` only renders the body strings already pre-formatted by generators, no change needed.

- [ ] **Step 4.7: Update `critical-alert.ts`**

Read `src/lib/notifications/critical-alert.ts`. Locate any `.toISOString().slice(0, 10)` call sites. For each, thread `practiceTimezone` through the alert function's signature and replace with `formatPracticeDate`. Update its callers (find them via Grep `from "@/lib/notifications/critical-alert"`).

- [ ] **Step 4.8: Run notification integration tests**

Run:
```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/notifications-timezone.test.ts tests/integration/notifications.test.ts
```
Expected: all green. The legacy notification tests may break if they assert exact body strings — update them to expect the new TZ-formatted dates (use practice timezone "UTC" in fixture data so legacy expectations stay valid, OR update fixture timezones explicitly).

- [ ] **Step 4.9: Verify no remaining call sites in notifications/**

Grep for `.toISOString().slice(0, 10)` in `src/lib/notifications/`. The only remaining hits should be `entityKey` computation lines (with the `// UTC-stable dedup hash` comment).

- [ ] **Step 4.10: Type check + lint**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit && npx eslint src/lib/notifications
```
Expected: clean.

- [ ] **Step 4.11: Commit**

```bash
cd D:/GuardWell/guardwell-v2 && git add src/lib/notifications tests/integration/notifications-timezone.test.ts && git commit -m "feat(notifications): render dates in practice timezone"
```

---

## Task 5 — Badge + UI sweep

**Files:**
- Modify: 5 badge components in `src/app/(dashboard)/programs/**/Badge.tsx`
- Modify: 3 Extras components in `src/components/gw/Extras/`
- Modify: ~25 dashboard pages with inline UTC date formatting
- Modify: `src/lib/ai/conciergeTools.ts`
- Modify: `src/lib/cyber/readiness.ts`

- [ ] **Step 5.0: Discover the exact set of badge files**

Run `Glob` to confirm paths:
- `src/app/(dashboard)/programs/**/CredentialStatusBadge.tsx`
- `src/app/(dashboard)/programs/**/SraAssessmentBadge.tsx`
- `src/app/(dashboard)/programs/**/AdoptedBadge.tsx`
- `src/app/(dashboard)/programs/**/TrainingStatusBadge.tsx`
- `src/app/(dashboard)/programs/**/BaaStatusBadge.tsx`

Verify each file exists. If any badge file is in a different location than expected, note it.

- [ ] **Step 5.1: Write a failing badge test**

Create `src/app/(dashboard)/programs/credentials/CredentialStatusBadge.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { CredentialStatusBadge } from "./CredentialStatusBadge";

describe("CredentialStatusBadge", () => {
  it("renders the AZ-local date when wrapped in PracticeTimezoneProvider", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 in MST
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <CredentialStatusBadge
          status="EXPIRING_SOON"
          expiryDate="2026-07-01T01:00:00Z"
        />
      </PracticeTimezoneProvider>,
    );
    expect(screen.getByText(/Expiring Jun 30, 2026/i)).toBeInTheDocument();
  });

  it("falls back to UTC when no provider is mounted", () => {
    render(
      <CredentialStatusBadge
        status="EXPIRING_SOON"
        expiryDate="2026-07-01T01:00:00Z"
      />,
    );
    expect(screen.getByText(/Expiring Jul 1, 2026/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test — expect FAIL**

Run: `npx vitest run src/app/\(dashboard\)/programs/credentials/CredentialStatusBadge.test.tsx`
Expected: FAIL — current badge always renders UTC for SSR.

- [ ] **Step 5.3: Refactor `CredentialStatusBadge` to consume the context**

Edit `src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx`. Replace the file contents with:
```tsx
// src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

export type CredentialStatus =
  | "NO_EXPIRY"
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED";

export interface CredentialStatusBadgeProps {
  status: CredentialStatus;
  expiryDate: string | null;
}

export function CredentialStatusBadge({
  status,
  expiryDate,
}: CredentialStatusBadgeProps) {
  const tz = usePracticeTimezone();
  const formatted = expiryDate
    ? formatPracticeDateLong(new Date(expiryDate), tz)
    : "";

  if (status === "NO_EXPIRY") {
    return (
      <Badge
        variant="secondary"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Active · no expiry
      </Badge>
    );
  }

  if (status === "EXPIRED") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-at-risk)",
          borderColor: "var(--gw-color-at-risk)",
        }}
      >
        Expired {formatted}
      </Badge>
    );
  }

  if (status === "EXPIRING_SOON") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-warn)",
          borderColor: "var(--gw-color-warn)",
        }}
      >
        Expiring {formatted}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="text-[10px]"
      style={{
        color: "var(--gw-color-compliant)",
        borderColor: "var(--gw-color-compliant)",
      }}
    >
      Active · expires {formatted}
    </Badge>
  );
}
```

Note: removed `useSyncExternalStore`, `SSR_FMT`, `useLocalDate`. The provider-driven pattern eliminates the SSR/CSR mismatch — both renders use the practice's TZ from context.

- [ ] **Step 5.4: Run badge test — expect PASS**

Run: `npx vitest run src/app/\(dashboard\)/programs/credentials/CredentialStatusBadge.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 5.5: Apply the same refactor to the other 4 badges**

For each:
- `src/app/(dashboard)/programs/risk/SraAssessmentBadge.tsx`
- `src/app/(dashboard)/programs/policies/AdoptedBadge.tsx`
- `src/app/(dashboard)/programs/training/TrainingStatusBadge.tsx`
- `src/app/(dashboard)/programs/vendors/BaaStatusBadge.tsx`

Replace the existing `useLocalDate` / `SSR_FMT` pattern with `usePracticeTimezone()` + `formatPracticeDateLong(new Date(iso), tz)`. The component shape remains identical — only the date-derivation changes.

- [ ] **Step 5.6: Sweep dashboard pages with inline UTC date formatting**

For each path in the badge-sweep file list (see "Per-site replacement plan" → "Badge / UI sweep" above), open the file and:
1. Add the import: `import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext"; import { formatPracticeDate, formatPracticeDateLong } from "@/lib/audit/format";`
2. If the file is a client component, add `const tz = usePracticeTimezone();` near the top of the component body.
3. If the file is a server component (e.g. `page.tsx` files without `"use client"`), the practice timezone is fetched at the layout level. To use it in a server component, fetch `practice.timezone` directly:
   ```ts
   const { timezone } = await db.practice.findUniqueOrThrow({
     where: { id: pu.practiceId },
     select: { timezone: true },
   });
   const tz = timezone ?? "UTC";
   ```
4. Replace every `someDate.toISOString().slice(0, 10)` with `formatPracticeDate(someDate, tz)`.
5. Replace any `new Intl.DateTimeFormat("en-US", { dateStyle: "medium" })` calls with `formatPracticeDateLong(someDate, tz)`.

The full file list (from "Per-site replacement plan" → "Badge / UI sweep"):
- 17 dashboard pages
- 3 admin pages
- 3 auth/invite pages (`accept-invite`, `accept-baa`, `sign-up/payment/success`)
- 3 Extras components
- `src/lib/cyber/readiness.ts` (server-only — accept `practiceTimezone: string` as a parameter, thread from caller)
- `src/lib/ai/conciergeTools.ts` (server-only — list_credentials etc.)

For `conciergeTools.ts`: the tool handlers receive `ctx: { practiceId, ... }`. Modify the handler body to fetch `timezone` from the practice (or include it in the existing practice fetch) and use `formatPracticeDate` when serializing dates back to the model. Specifically, in `list_credentials`, `expiryDate` is currently returned as a raw ISO string. Replace the field name with `expiryDate: formatPracticeDate(c.expiryDate, practiceTimezone)` so the model sees what the practice sees.

- [ ] **Step 5.7: Run jsdom + integration tests**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run src/app/\(dashboard\)/programs src/components/gw/Extras tests/integration
```
Expected: all green. Existing tests that asserted on UTC-formatted strings may need updates — set fixture practice timezone to "UTC" for legacy tests, or update assertions.

- [ ] **Step 5.8: Final grep + lint sweep**

Run:
- Grep `\.toISOString\(\)\.slice\(0, 10\)` across `src/`. The only remaining matches should be in `src/lib/notifications/generators.ts` for `entityKey` (intentional, marked with the `// UTC-stable dedup hash` comment) and `src/components/gw/BulkCsvImport/parseCsv.ts` (intentionally out-of-scope).
- ESLint: `npx eslint src`
- TSC: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 5.9: Run the full test suite**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run
```
Expected: all green. Test count up by ~29 (from 801 to ~830).

- [ ] **Step 5.10: Commit**

```bash
cd D:/GuardWell/guardwell-v2 && git add src/app/\(dashboard\) src/components/gw/Extras src/lib/ai/conciergeTools.ts src/lib/cyber/readiness.ts src/app/admin src/app/accept-invite src/app/accept-baa src/app/\(auth\) && git commit -m "feat(ui): render badge + dashboard dates in practice timezone"
```

---

## Post-merge ops checklist (NOT a code task — for the merging operator)

After all 5 commits land on main and Cloud Build deploys:

1. ☐ Verify Cloud Build `prisma-migrate` step succeeded — Practice.timezone column exists in prod.
2. ☐ Run `npx tsx scripts/backfill-practice-timezone.ts` against prod via the proxy (per `docs/deploy/auto-migrations.md` § "Manual migration fallback"). Expected: `Done. updated=N skipped=0`.
3. ☐ Spot-check: open `https://v2.app.gwcomp.com/settings/practice` as the AZ Smoke practice owner; confirm the Display timezone field shows `America/Phoenix`.
4. ☐ Spot-check: trigger a credential-register PDF download for the AZ Smoke practice; confirm "Generated" line shows AZ-local date.
5. ☐ Spot-check: wait for next notification digest run (or trigger manually); confirm digest email body shows AZ-local expiry dates for any expiring credentials.

---

## Self-review (against the audit's stated requirements + this plan's scope)

✅ Prisma migration shape: covered in Task 1, Step 1.5 (additive `String?`, no destructive flag triggered).
✅ State→TZ default mapping: covered in Task 1, Steps 1.1–1.4 (all 51 codes with unit-tested map + fallback).
✅ Helper signature + behavior: covered in Task 2, Steps 2.1–2.4 (three formatters + isValidTimezone + fallback rules).
✅ Per-site replacement plan: covered in the dedicated section above + Tasks 3, 4, 5.
✅ Backfill strategy: covered in Task 1, Steps 1.7–1.10 + post-merge ops checklist.
✅ Test plan: covered in dedicated section + per-task TDD steps.

No placeholders. Every code block is concrete. Type names (`PracticeProfileInput`, `BreachMemoInput`, `formatPracticeDate`) are consistent across tasks.

✅ Five logical chunks (matches user-prescribed subagent breakdown): Task 1 (migration), Task 2 (helper), Task 3 (PDF sweep), Task 4 (notifications sweep), Task 5 (badge sweep). Tasks 3–5 are independent and could run in parallel after Tasks 1–2 complete.
