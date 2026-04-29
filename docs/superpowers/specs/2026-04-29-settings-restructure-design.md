# Settings & Onboarding Restructure — Design

**Author:** Noorros + Claude
**Date:** 2026-04-29
**Status:** Approved for planning

## Why

Six product gaps surfaced this session, all in the same neighborhood (settings UI, onboarding completeness, practice metadata):

1. Settings live in the left sidebar today; users expect them in the upper-right.
2. Onboarding under-collects practice metadata vs. what the schema supports (multi-state, NPI, entity type, address, EHR).
3. Whatever is collected in onboarding must be editable in settings.
4. The specialty list is six broad buckets ("PRIMARY_CARE", "SPECIALTY", "ALLIED") — internal jargon, not user-friendly.
5. The DB schema supports multi-state (`Practice.operatingStates: String[]`) but no UI lets users select multiple states.
6. There is no settings affordance for managing a Stripe subscription. The Stripe Customer Portal exists at `/account/locked` but is only reachable when the account is past-due or canceled.

## Scope

In scope:

- AppShell change: avatar/initials dropdown in TopBar replaces email + sign-out; sidebar Settings section removed.
- New `/settings` index + new `/settings/subscription` route. Existing `/settings/practice` and `/settings/notifications` retained.
- Onboarding `compliance-profile` step extended with five new fields (`operatingStates`, `npiNumber`, `addressStreet/Suite/City/Zip`, `entityType`, `ehrSystem`).
- Specialty enum replaced with a curated ~30-item list; bucket category derived from specific.
- Three new shared components: `<UserMenu>`, `<StateMultiSelect>`, `<SpecialtyCombobox>`.
- One new server component: `<SubscriptionPanel>`.
- One refactored form component: `<PracticeProfileForm>` used by both onboarding and `/settings/practice`.

Out of scope (explicit non-goals for this PR set):

- Multi-practice user switching (mentioned only as a future possibility the avatar pattern supports).
- Native Stripe invoice/cancel UI — Customer Portal handles all of that.
- International addresses, non-US states, or postal-code formats other than US 5-digit.
- Phone number formatting beyond a free-text input.
- Google Places autocomplete or any address-validation API integration.
- Changes to `PracticeComplianceProfile`'s seven compliance toggles (CLIA / DEA / CMS / MACRA / ALLERGY / TCPA — these stay as-is).

## Architecture

### AppShell change

Today's TopBar layout (left → right):

```
[mobile trigger] [practice name] ····· [bell] [email plain text] [Sign out button]
```

Target layout:

```
[mobile trigger] [practice name] ····· [bell] [<UserMenu>]
```

`<UserMenu>` is a Shadcn `DropdownMenu` triggered by an `<Avatar>` showing user initials. Menu structure:

```
┌─────────────────────────┐
│ user@example.com        │  ← header, plaintext, no action
│ Acme Family Medicine    │  ← practice name in muted text
├─────────────────────────┤
│ Practice profile        │  → /settings/practice
│ Notifications           │  → /settings/notifications
│ Subscription            │  → /settings/subscription
├─────────────────────────┤
│ Sign out                │  → form action signOutAction
└─────────────────────────┘
```

The existing `Sidebar.tsx` "Settings" section (lines 305-322 in the current file) is removed. Mobile sidebar trigger continues to surface the rest of the sidebar (My Compliance, My Programs, Audit & Insights). Settings is no longer in the mobile sheet — users reach it via the avatar in TopBar, which is visible on mobile.

### Settings information architecture

`/settings` becomes an index page with three cards (or simple link list) directing to:

- `/settings/practice` — identity, location, practice metadata (existing route, expanded form)
- `/settings/notifications` — preferences (existing, unchanged)
- `/settings/subscription` — plan, status, Stripe Customer Portal redirect (NEW)

The avatar menu always deep-links to the most relevant sub-page (Practice profile / Notifications / Subscription). The index page exists for users who arrive at `/settings` directly.

### Onboarding change

The `compliance-profile` step (`src/app/onboarding/compliance-profile/`) is extended:

- Existing seven compliance toggles unchanged.
- Existing primary-state input (currently in `create-practice` page) **moves into** compliance-profile, alongside additional-states (`<StateMultiSelect>`).
- Existing 6-bucket specialty `<select>` replaced with `<SpecialtyCombobox>` (~30 specifics, search-as-you-type).
- New section: Identity — `npiNumber` (with Luhn validation), `entityType` (radio: Covered Entity / Business Associate).
- New section: Address — street, suite (optional), city, zip (5-digit US).
- New section: Practice — providers (existing), `ehrSystem` (combobox of ~12 common EHRs + free-text fallback).

The existing `create-practice` step is shortened: it collects only `name` and creates the practice row. The full metadata is collected in `compliance-profile`. This avoids asking for the same fields twice and keeps `create-practice` minimal (so users get to the dashboard faster on a no-info skip).

The `<PracticeProfileForm>` component is used in both:

- onboarding `compliance-profile` (full form + escape-hatch button)
- `/settings/practice` (full form + standard save)

This guarantees the two surfaces stay in sync.

### Specialty model

**Today:** `PracticeComplianceProfile.specialtyCategory: String?` stores one of `PRIMARY_CARE | SPECIALTY | DENTAL | BEHAVIORAL | ALLIED | OTHER`. Drives compliance defaults like the DENTAL/ALLIED → MACRA exemption at line 131 of `ComplianceProfileForm.tsx`.

**Target:**

- `Practice.specialty: String?` (already exists, free-form) is repurposed to store a **specific specialty** from a curated ~30-item list.
- `PracticeComplianceProfile.specialtyCategory` (the 6-bucket column) stays in the schema and continues to drive compliance logic, but is **derived** from `Practice.specialty` via a pure function `deriveSpecialtyCategory(specialty: string): SpecialtyCategory`.
- The setter for the form writes both: it stores the user's pick in `Practice.specialty` and writes the derived bucket into `PracticeComplianceProfile.specialtyCategory`.

The curated specialty list (alphabetical, 30 entries):

| Specialty | Bucket (derived) |
|---|---|
| Allergy & Immunology | SPECIALTY |
| Anesthesiology | SPECIALTY |
| Behavioral Health | BEHAVIORAL |
| Cardiology | SPECIALTY |
| Chiropractic | ALLIED |
| Dental — General | DENTAL |
| Dental — Specialty | DENTAL |
| Dermatology | SPECIALTY |
| Emergency Medicine | SPECIALTY |
| Endocrinology | SPECIALTY |
| Family Medicine | PRIMARY_CARE |
| Gastroenterology | SPECIALTY |
| General Surgery | SPECIALTY |
| Internal Medicine | PRIMARY_CARE |
| Nephrology | SPECIALTY |
| Neurology | SPECIALTY |
| Obstetrics & Gynecology | SPECIALTY |
| Occupational Therapy | ALLIED |
| Oncology | SPECIALTY |
| Ophthalmology | SPECIALTY |
| Orthopedics | SPECIALTY |
| Otolaryngology (ENT) | SPECIALTY |
| Pediatrics | PRIMARY_CARE |
| Physical Therapy | ALLIED |
| Plastic Surgery | SPECIALTY |
| Podiatry | ALLIED |
| Psychiatry | BEHAVIORAL |
| Pulmonology | SPECIALTY |
| Radiology | SPECIALTY |
| Speech-Language Pathology | ALLIED |
| Urology | SPECIALTY |
| Other | OTHER |

The user always sees the specific name. The bucket exists only for compliance derivation logic and is invisible to the UI.

#### Migration

A one-shot script `scripts/backfill-practice-specialty.ts` runs once after deploy:

- For each `Practice` where `specialty` is null/empty AND a `PracticeComplianceProfile` row exists, derive a default specific from the existing bucket:
  - PRIMARY_CARE → "Family Medicine"
  - SPECIALTY → "Other" (too broad to guess)
  - DENTAL → "Dental — General"
  - BEHAVIORAL → "Behavioral Health"
  - ALLIED → "Physical Therapy"
  - OTHER → "Other"
- Write back to `Practice.specialty`.
- Idempotent (skips practices that already have `specialty` set).

Users can correct the auto-derived value from `/settings/practice` after migration. A small one-time banner on the dashboard could prompt practices with auto-derived specialties to verify, but that's a polish item, not a blocker.

### Multi-state UI pattern

`<StateMultiSelect>` is a search-combobox + chip list. Used twice:

- **Onboarding** (`compliance-profile`): two stacked inputs — "Primary state" (single `<select>`, AZ-style 2-letter) and "Additional states" (`<StateMultiSelect>`).
- **Settings** (`/settings/practice`): same two stacked inputs.

Component shape:

```ts
interface StateMultiSelectProps {
  selectedStates: string[];           // 2-letter codes
  excludeStates?: string[];           // primary state goes here so it can't be picked again
  onChange: (states: string[]) => void;
  className?: string;
}
```

Implementation: cmdk + Popover + Badge (the Shadcn idiomatic combobox-with-chips recipe). Each chip has a small ✕ button. Search filters the dropdown of all 50 states + DC. Keyboard accessible: `↓/↑` navigate, `Enter` adds, `Backspace` on empty input removes the last chip. Excludes the primary state from the dropdown options.

### Subscription page

`/settings/subscription` is a server component that:

1. Fetches the current `Practice` (via `getPracticeUser`) — selects `subscriptionStatus`, `trialEndsAt`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`.
2. Fetches the Stripe subscription details (last-4 of card, plan name) only if `stripeCustomerId` is set. Defensive: if the Stripe API call fails, still render the page with a warning.
3. Renders `<SubscriptionPanel>` (a server component) which displays:
   - Status badge (TRIALING / ACTIVE / PAST_DUE / CANCELED / INCOMPLETE)
   - For TRIALING: countdown to `trialEndsAt` ("Trial ends in 5 days") + "Subscribe now" button
   - For ACTIVE: next billing date + last 4 of card
   - For PAST_DUE/CANCELED: warning + "Update payment / Reactivate" button
   - For INCOMPLETE: link to checkout (existing flow)
   - One primary button: **"Manage subscription"** → calls a new server action `openBillingPortalAction` that wraps `getStripe().billingPortal.sessions.create({ customer: stripeCustomerId, return_url: ... })` and returns the portal URL.
4. The button is a form-action POST that opens the portal in a new tab. Reuses the action pattern from `src/app/(auth)/account/locked/actions.ts` — likely just imports it directly to avoid duplication, or moves it to `src/lib/billing/portal.ts` as a shared helper.

The "Subscribe now" button (TRIALING / INCOMPLETE) reuses the existing checkout flow that's used in onboarding.

## Components

### `<UserMenu>` (client)

Path: `src/components/gw/AppShell/UserMenu.tsx`. Shadcn `DropdownMenu` + `Avatar`. Props: `userEmail: string`, `practiceName: string`, `userInitials: string`. Initials computed in the parent (server side) and passed in. Menu items are typed `Route` to satisfy Next.js typed-routes. Sign-out item submits `signOutAction` via a form (same pattern as the current TopBar). Replaces lines 39-60 of [TopBar.tsx](src/components/gw/AppShell/TopBar.tsx).

### `<StateMultiSelect>` (client)

Path: `src/components/gw/StateMultiSelect/index.tsx`. Combobox built on `cmdk` (already a project dep through Shadcn). Renders a `<Popover>` containing a `<Command>` with all 50 states + DC; selected states show as `<Badge>` chips above the input. State list is a constant in `src/lib/states.ts` (US states + DC, name + code).

### `<SpecialtyCombobox>` (client)

Path: `src/components/gw/SpecialtyCombobox/index.tsx`. Single-select combobox (cmdk + Popover). Search-as-you-type across the 30-item list defined in `src/lib/specialties.ts`. The list also exports `deriveSpecialtyCategory(specialty: string)` which is the pure derivation function.

### `<SubscriptionPanel>` (server component)

Path: `src/components/gw/SubscriptionPanel/index.tsx`. Async server component. Takes a `practiceId` prop, fetches the necessary data inline (Practice row + Stripe API). Returns a single card with status display + portal button. Hides the "Subscribe now" CTA when `subscriptionStatus = ACTIVE`.

### `<PracticeProfileForm>` (client)

Path: `src/components/gw/PracticeProfileForm/index.tsx`. The unified form used by both onboarding and settings. Takes a prop `mode: "onboarding" | "settings"` that controls which optional fields appear.

**Always visible (both modes):**

1. **Identity** — name (required), NPI (10 digits, Luhn-checked, optional), entity type (radio).
2. **Location** — primary state (single `<select>`), additional states (`<StateMultiSelect>`), address (street, suite, city, zip).
3. **Practice (core)** — specialty (`<SpecialtyCombobox>`), providers (existing `providerCount` enum), EHR system (`<EhrCombobox>`).

**Settings mode only** (hidden in onboarding per question 2 answer = compliance-relevant only):

4. **Practice (optional)** — staff headcount (number input), phone (free text).

The two onboarding-deferred fields (`staffHeadcount`, `phone`) don't drive any compliance rule today, so collecting them up-front would only add onboarding friction. They're surfaced in settings for users who want to fill them in.

**Compliance toggles** — the seven CLIA/DEA/CMS/MACRA/ALLERGY/TCPA toggles in the existing `ComplianceProfileForm` are NOT part of `<PracticeProfileForm>`. They stay in their existing onboarding component (which now renders `<PracticeProfileForm mode="onboarding" />` plus its own toggle section).

Server action: `savePracticeProfileAction(input)`. Validates with Zod, writes `Practice` columns + the derived `specialtyCategory` into `PracticeComplianceProfile`, then `revalidatePath` for `/settings/practice` and `/dashboard`.

#### `<EhrCombobox>` (client) — internal helper

Combobox of 12 common EHRs:

```
Epic
Cerner (Oracle Health)
Athenahealth
eClinicalWorks
NextGen
AdvancedMD
DrChrono
Practice Fusion
Greenway
Allscripts
Kareo
ChartLogic
Other (free text)
```

Selecting "Other" reveals a free-text input. Stored as the literal string in `Practice.ehrSystem`.

## Data flow

### On settings save

```
User submits PracticeProfileForm
  → savePracticeProfileAction(input)        [server action]
    → Zod validate input
    → derive specialtyCategory = deriveSpecialtyCategory(input.specialty)
    → db.$transaction([
        practice.update({ where, data: { name, primaryState, operatingStates,
                                          specialty, npiNumber, entityType,
                                          addressStreet, addressSuite, addressCity,
                                          addressZip, ehrSystem, providerCount,
                                          staffHeadcount, phone } }),
        practiceComplianceProfile.update({
          where: { practiceId },
          data: { specialtyCategory: derived }
        }),
      ])
    → appendEvent(PRACTICE_PROFILE_UPDATED, payload: { changedFields })   [if event-sourcing applies]
    → revalidatePath("/settings/practice")
    → revalidatePath("/dashboard")
  → return { ok: true } | { ok: false, error: "..." }
```

The event payload tracks which fields changed (for audit/Activity Log). Type: `PRACTICE_PROFILE_UPDATED` (new event type to register).

### On subscription portal open

```
User clicks "Manage subscription"
  → openBillingPortalAction()                [server action — reuses /account/locked logic]
    → fetch Practice.stripeCustomerId
    → if missing → return { ok: false, error: "no-stripe-customer" }
    → stripe.billingPortal.sessions.create({ customer, return_url })
    → return { ok: true, url }
  → window.location = url  (or window.open in new tab — same as existing pattern)
```

The action is shared between `/account/locked` and `/settings/subscription`. Move to `src/lib/billing/portal.ts` for cleanliness, or import directly from `/account/locked/actions.ts`. Decision deferred to writing-plans.

## Error handling

- Form validation errors render inline next to the offending field.
- NPI Luhn validation: if user enters a 10-digit number that fails Luhn checksum, show "Invalid NPI checksum — please verify the number." NPI is optional; empty is allowed.
- Stripe API failures on the subscription page render a generic warning ("Couldn't load subscription details — try again in a moment") plus the Customer Portal button is still shown (user can still escape to the portal even if our display query failed).
- Multi-state with no states selected is allowed (a practice with only a primary state and zero additional states is valid).
- Specialty is optional in onboarding (user can skip via the existing escape-hatch); required only for the per-specialty rules to apply.
- All form save errors return `{ ok: false, error }` not exceptions; the form maps them to inline messages.

## Testing

Per-component unit tests:

- `<UserMenu>` — opens, items navigate, sign-out POSTs the form.
- `<StateMultiSelect>` — add/remove chips, search filters, exclude-list works, keyboard nav, jest-axe.
- `<SpecialtyCombobox>` — search filters across 30 items, derives bucket correctly via the helper.
- `<SubscriptionPanel>` — renders correct status badge for each of 5 statuses, "Subscribe now" hidden when ACTIVE, portal button always visible when stripeCustomerId set.
- `<PracticeProfileForm>` — validation (NPI Luhn, zip 5-digit, specialty required), save flow, error states.

Integration tests:

- Server action `savePracticeProfileAction` writes both Practice and PracticeComplianceProfile in a single transaction.
- Migration script `backfill-practice-specialty.ts` is idempotent and maps each bucket correctly.
- Multi-practice user safety: server actions use `getPracticeUser(thread.practiceId)` to ensure cross-practice writes are blocked.

End-to-end (Chrome verify after deploy):

- Avatar dropdown opens on click, all 4 menu items navigate correctly.
- Sign-out works.
- Settings → Practice → multi-state add/remove → save → reload → state persists.
- Settings → Subscription → "Manage subscription" → opens Stripe portal in new tab.
- Onboarding → compliance-profile → full form fill → completes.

## Phasing

Five sub-PRs, all on a single feature branch `feat/settings-restructure`. Squash-merge each as it lands. Each PR is independently tested + deployable; nothing waits on a future PR's data.

### PR 1 — AppShell avatar dropdown

Files:
- NEW `src/components/gw/AppShell/UserMenu.tsx` + `UserMenu.test.tsx`
- MODIFY `src/components/gw/AppShell/TopBar.tsx` — replace email + sign-out with `<UserMenu>`. Take a `userInitials` prop.
- MODIFY `src/components/gw/AppShell/Sidebar.tsx` — remove `SETTINGS_ITEMS` constant + the rendered Settings section.
- MODIFY `src/components/gw/AppShell/AppShell.tsx` — pass `userInitials` to TopBar (compute from `user.email` server-side).
- UPDATE existing tests for TopBar / Sidebar / AppShell.

Tests: dropdown opens, all 4 items navigate, sign-out POSTs, Settings is gone from sidebar.

### PR 2 — Specialty list expansion

Files:
- NEW `src/lib/specialties.ts` — exports `SPECIALTIES` (the 30-item list) and `deriveSpecialtyCategory(specialty)`.
- NEW `src/components/gw/SpecialtyCombobox/index.tsx` + tests.
- NEW `scripts/backfill-practice-specialty.ts` — one-shot migration.
- MODIFY `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx` — replace the 6-bucket `<select>` with `<SpecialtyCombobox>`. The save action writes both `Practice.specialty` (specific) and `PracticeComplianceProfile.specialtyCategory` (derived bucket).
- MODIFY `src/app/onboarding/compliance-profile/actions.ts` — call `deriveSpecialtyCategory` in the save path.

Tests: derivation table is exhaustive (every entry produces a valid bucket), combobox keyboard nav, migration script idempotent + maps correctly.

### PR 3 — Multi-state component

Files:
- NEW `src/lib/states.ts` — exports `US_STATES` (50 + DC, name + code).
- NEW `src/components/gw/StateMultiSelect/index.tsx` + tests + jest-axe.
- MODIFY `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx` — add the primary-state `<select>` (move from create-practice) + `<StateMultiSelect>` for additional states.
- MODIFY `src/app/onboarding/compliance-profile/actions.ts` — write `Practice.primaryState` + `Practice.operatingStates` in the save path.
- MODIFY `src/app/onboarding/create-practice/page.tsx` + `actions.ts` — drop the `primaryState` input (it now lives in compliance-profile). Practice is created with primaryState=null until compliance-profile saves it. Need to confirm no downstream code crashes on null primaryState during this gap; if it does, keep a default like "AZ" in create-practice and let user override later.

Tests: chip add/remove, primary excluded from additional dropdown, keyboard navigation, jest-axe pass.

### PR 4 — Practice profile expansion (the big one)

Files:
- NEW `src/components/gw/PracticeProfileForm/index.tsx` + tests — the unified form (Identity / Location / Practice sections).
- NEW `src/components/gw/PracticeProfileForm/EhrCombobox.tsx` + tests — internal helper combobox.
- MODIFY `src/app/(dashboard)/settings/practice/page.tsx` — render `<PracticeProfileForm>`. Existing form code is replaced.
- NEW `src/app/(dashboard)/settings/practice/actions.ts` (or extend existing) — `savePracticeProfileAction`. Writes Practice + derived bucket in one transaction.
- MODIFY `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx` — extends to use `<PracticeProfileForm>` for the Identity + Address sections. (Practice section overlaps — refactor decision deferred to writing-plans.)
- NEW event type: `PRACTICE_PROFILE_UPDATED` in `src/lib/events/registry.ts` + projection (writes nothing — pure audit event).

Tests: form validation (NPI Luhn, zip 5-digit, specialty required), save end-to-end, error states, both-surfaces-stay-in-sync regression test (save in onboarding → load in settings shows same data).

### PR 5 — Subscription page

Files:
- NEW `src/app/(dashboard)/settings/page.tsx` — index page (3 cards linking to sub-pages).
- NEW `src/app/(dashboard)/settings/subscription/page.tsx` — fetches Practice + Stripe data, renders panel.
- NEW `src/components/gw/SubscriptionPanel/index.tsx` + tests.
- NEW or MOVE `src/lib/billing/portal.ts` — `openBillingPortalAction`. Either move from `/account/locked/actions.ts` or import directly. Decision in writing-plans.
- (No avatar menu update needed — PR 1 already added the Subscription link.)

Tests: panel renders correct UI per status, portal action returns URL, trial countdown formatting, missing stripeCustomerId graceful fallback.

## Open questions deferred to writing-plans

- Should `PRACTICE_PROFILE_UPDATED` event payload include before/after of changed fields, or just the field names? (Audit usefulness vs. payload size.)
- Should the settings index page include a "Help" or "Support" link in the same card list, or is that a separate concern?
- Should we add a "Last updated" timestamp on the practice profile form (next to Save) so users can see when info was last refreshed?
- Specialty migration: should we run it as part of the deploy step (Cloud Build prisma-migrate phase) or manually post-deploy? Cloud Build phase is cleaner; manual gives a rollback point.
- Move the Stripe portal action to `src/lib/billing/portal.ts` vs. import directly from `/account/locked/actions.ts`. Refactor decision in writing-plans.

## Risks

- The `create-practice` → `compliance-profile` flow change (PR 3) leaves `Practice.primaryState` temporarily null between the two steps. Need to confirm downstream code is null-safe or supply a placeholder default.
- Multi-state introduction may surface bugs in compliance-rule code that assumed `operatingStates` is always empty. Need a sweep grep for `.operatingStates` references and verify each correctly handles non-empty arrays.
- Specialty migration: users with existing `specialtyCategory = SPECIALTY` get mapped to "Other" because we can't guess. They'll need to correct manually. A one-time dashboard banner could prompt them, but that's polish.
- The avatar dropdown might collide with the floating Concierge trigger button (bottom-right) on mobile. Both are user-action affordances — keep them visually distinct (avatar in TopBar at top-right; Concierge bot at bottom-right).
- New event type means a new schema migration — additive, but Cloud Build needs to run prisma-migrate first.

## Success criteria

- Avatar dropdown visible on every dashboard page; sidebar Settings section gone.
- `/settings`, `/settings/practice`, `/settings/notifications`, `/settings/subscription` all reachable from the avatar menu.
- Onboarding `compliance-profile` collects: name, primary state, additional states (multi-select), NPI, entity type, address (4 fields), specialty (specific), providers, EHR.
- All onboarding fields editable in `/settings/practice` with the same form component.
- Specialty list is 30 specifics; bucket is derived and invisible to UI.
- Subscription page surfaces status + Stripe Customer Portal button; works for all 5 status states.
- Tests baseline 721 → ~+50 across the 5 PRs (rough estimate; per-PR test counts in the implementation plan).
- Cloud Build deploys each PR successfully; no env-var regressions (the cloudbuild.yaml fix from this morning prevents that class of bug).
