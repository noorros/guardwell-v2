# Onboarding Flow Design

**Status:** DRAFT — needs product-owner sign-off before build  
**Author:** Claude (session 39, 2026-04-24)  
**Audience:** Builder (next session) + product owner (decision-maker)

---

## 1. Goal

Take a stranger from "saw the marketing site" to "actively using GuardWell to manage their practice's HIPAA + OSHA compliance" in the **shortest possible path** that:

- **Qualifies** the lead (credit card collected → real intent)
- **Captures** the minimum data needed to tailor the product to their practice
- **Produces a measurable win** in the first 30 minutes (≥1 policy adopted, ≥1 staff member trained, score above 0)
- **Builds the habit** of returning (at least 1 follow-up email/notification driving them back to a specific high-leverage task)

**Success metric (post-launch):** ≥60% of accounts that complete payment have ≥1 policy acknowledged AND ≥1 training completion within 7 days.

---

## 2. End-to-end user journey

### High-level flow

```
[1] Marketing site (gwcomp.com)
     ↓ "Start free trial" CTA
[2] Sign up         → email + password + name + practice name + state
     ↓ Firebase user created + sent verification email
[3] Email verify    → click link → returns to app authenticated
     ↓
[4] Payment         → Stripe Checkout (card-on-file, 7-day trial, no charge yet)
     ↓ Webhook → Practice.subscriptionStatus = TRIALING
[5] Compliance profile → 8 toggles (already built)
     ↓ Auto-enables CMS/DEA/CLIA/MACRA frameworks
[6] First-run wizard → 4-step "let's get you to score 30 in 20 minutes"
     ↓ Designate Privacy Officer + adopt Privacy Policy + take HIPAA Basics + assign 1 staff
[7] Dashboard       → /dashboard with Compliance Track front + center
     ↓
[8] Drip emails     → day 1, 3, 5, 7, 10 (each links to next-best task)
     ↓
[9] Active practice → ongoing use of /modules, /programs, /audit
```

### What the user feels at each stage

| Stage | Goal of stage | Time | Friction |
|-------|---------------|------|----------|
| Sign up | "I'm in" | 60s | Just enough to identify them |
| Verify email | "Confirmed" | 30s | One click |
| Payment | "I'm committed" | 90s | Card collection — biggest dropoff risk |
| Compliance profile | "They're tailoring this to me" | 90s | 8 toggles, defaults are smart |
| First-run wizard | "Look how fast I'm making progress" | 15-20 min | High-touch, celebratory |
| Dashboard | "I know what to do next" | ongoing | Compliance Track is THE focus |

---

## 3. Screen-by-screen spec

### Screen 1 — Marketing site (existing, no changes)

**Where:** `gwcomp.com/`  
**CTA:** "Start free trial" (currently routes to waitlist modal — see Section 8 dependency)  
**What it does:** Routes to `app.gwcomp.com/sign-up?utm_*` with attribution params.

---

### Screen 2 — Sign up (NEW)

**Route:** `/sign-up`  
**Lives outside `(dashboard)` layout** — anonymous + auth-required users have nothing to do here.

**Fields (single page, no multi-step):**
- Your full name (required)
- Work email (required, validated, not-already-registered)
- Password (required, ≥10 chars, strength meter)
- Practice name (required, max 200)
- Primary state (required, US dropdown — same list as v1 wizard)
- Phone (optional, future SMS verification, masked input)
- Checkbox: "I agree to the Terms of Service and BAA" (required, opens `/baa` + `/terms` in new tabs)
- Checkbox: "Email me product updates" (optional, defaults checked)

**Validation:**
- Email duplicate check via Firebase
- Password strength (zxcvbn, score ≥3 of 4)
- Practice name not blank
- Both legal checkboxes toggled

**Submit handler:**
1. Create Firebase user via `createUserWithEmailAndPassword`
2. POST `/api/auth/sync` with token (existing) → creates `User` row
3. Server action `createPracticeAndOwnerAction({ practiceName, primaryState })` → creates `Practice` (subscriptionStatus = `INCOMPLETE`) + `PracticeUser` with role OWNER + records `LegalAcceptance` rows for `BAA_v1` + `TOS_v1`
4. Send Firebase email verification
5. Redirect to `/sign-up/verify?email=…`

**Visual:** Single column, max-w-md, big bold "Start your free trial" header, GuardWell logo top-left. Trust signals at bottom: "HIPAA-aligned. SOC 2 in progress. No card charged for 7 days."

---

### Screen 3 — Email verify (NEW)

**Route:** `/sign-up/verify`  
**Purpose:** Holding page until user clicks the email-verify link.

**Content:**
- "Check your email"
- "We sent a verification link to **jane@practice.com**. Click it to continue."
- Resend button (rate-limited to 1 per 60s, max 3 in 1 hour)
- Help link: "Wrong address? Sign out and start over."

**Polling:** Server action checks `User.emailVerified` every 5s via `useQuery` or `useEffect` interval. When verified, auto-redirects to `/sign-up/payment`.

**Webhook alternative:** Firebase Auth user-update trigger → updates `User.emailVerified`. The polling above just reads from `User.emailVerified` so it picks up either way.

---

### Screen 4 — Payment (NEW — the big one)

**Route:** `/sign-up/payment`  
**Purpose:** Collect credit card, start 7-day trial.

**The decision point** (see Section 6.1 — needs your input):

#### Option A — Stripe Checkout (redirect)
- Big "Start free trial" button → Stripe-hosted Checkout page
- Stripe handles card UI, validation, 3DS, error states
- On success, webhook fires + redirect back to `/sign-up/payment/success`
- Pro: Lowest implementation cost, best UX out of the box, PCI scope minimal
- Con: User leaves our domain mid-flow (some perceive this as friction)

#### Option B — Stripe Elements (in-page)
- Card form rendered in our page using `@stripe/react-stripe-js`
- We submit to our backend, which creates Stripe customer + subscription + payment method
- Pro: Stays in our flow, more polished
- Con: ~3x the implementation work, more PCI surface

**Recommendation:** Start with **Option A** for launch. Migrate to Elements post-launch if conversion data warrants.

**Page content (above the Checkout button):**
- "GuardWell — $249/month, 7-day free trial"
- Pricing toggle: Monthly ($249) / Annual ($199 effective) — surfaces savings as "$600/year saved"
- 8-bullet feature recap (ported from v1 wizard.tsx FEATURES list)
- Trust footer: "Cancel anytime in the first 7 days — no charge. SOC 2 Type II in progress. Stripe-secured payment."

**Server action `createCheckoutSessionAction`:**
1. Verify caller has Practice w/ subscriptionStatus = `INCOMPLETE`
2. Create Stripe Customer (email, name, metadata.practiceId)
3. Resolve promo code (see "Promo code support" below) if any
4. Create Checkout Session:
   - 1 line item (selected price ID)
   - `mode: subscription`
   - `subscription_data.trial_period_days: 7` (skip if 100%-off promo applied — trial is moot)
   - `success_url: /sign-up/payment/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url: /sign-up/payment`
   - `allow_promotion_codes: true` (always — lets user type any active code in Stripe Checkout)
   - `discounts: [{ promotion_code: <id> }]` (only when a known promo was carried in)
   - `payment_method_collection: 'if_required'` (skips card field when 100%-off promo applied)
5. Return checkoutUrl
6. Client redirects via `window.location.href`

**Promo code support — `BETATESTER2026` and successors**

The "I have a code" path needs to work for both **organic discovery** (user types it in Stripe Checkout) and **invite-link distribution** (marketing sends a URL with the code pre-filled).

#### Setup (one-time, in Stripe Dashboard or via API)
1. Create a **Coupon** — 100% off, duration `forever`, applies to all products
2. Create a **Promotion Code** off that coupon:
   - `code: BETATESTER2026`
   - `max_redemptions: null` (unlimited — but tracked per-customer so each beta tester applies it once)
   - `expires_at: null` (never expires)
   - `restrictions.first_time_transaction: false` (existing customers can apply too)

Future codes (e.g., `LAUNCH2026`, `PARTNER_X`) follow the same pattern with different `expires_at` / `max_redemptions` / discount settings.

#### URL-param flow (recommended for distributed beta links)
- Marketing sends URL: `https://app.gwcomp.com/sign-up?promo=BETATESTER2026`
- `/sign-up` reads the param, stores in a session cookie (`gw_promo`, signed via NextAuth-style HMAC, 24h expiry)
- `/sign-up/payment` reads the cookie → server action looks up the promo via `stripe.promotionCodes.list({ code, active: true })` → if valid, passes `discounts: [{ promotion_code: promo.id }]` to the Checkout Session
- If valid + 100% off: also flip `payment_method_collection: 'if_required'` so Stripe skips card collection entirely
- Show a banner on `/sign-up/payment`: **"BETATESTER2026 applied — $0/month, no card required."**

#### Manual-entry flow (anyone, anytime)
- `allow_promotion_codes: true` on every Checkout Session shows the standard "Add promotion code" link in Stripe Checkout
- User clicks it → types the code → Stripe validates + applies
- Works for any active promo code in our Stripe account, including BETATESTER2026
- No special code needed in our app

#### Validation + edge cases
- Invalid/expired code: server action falls through (no `discounts` passed), Checkout still works at full price
- Promo applied → subscription created with discount → webhook flow unchanged → Practice flips to `TRIALING` then `ACTIVE` as normal
- Promo holder eventually removed in Stripe (manual ops) → subscription stays at the discounted rate they signed up at unless we also delete the underlying Coupon
- New audit-log event: `PROMO_APPLIED` with `{ promoCode, customerId, subscriptionId }` on webhook receipt — gives us a clean count of beta enrollments

**Stripe webhook handler (NEW route — `/api/stripe/webhook`):**
- `checkout.session.completed` → mark Practice.subscriptionStatus = `TRIALING`, store stripeCustomerId + stripeSubscriptionId, set trialEndsAt
- `customer.subscription.updated` → sync subscriptionStatus + currentPeriodEnd
- `invoice.payment_succeeded` → mark `ACTIVE`
- `invoice.payment_failed` → mark `PAST_DUE`
- `customer.subscription.deleted` → mark `CANCELED`

---

### Screen 5 — Payment success (NEW)

**Route:** `/sign-up/payment/success`  
**Purpose:** Confirmation + smooth handoff to compliance profile.

**Content:**
- Big checkmark + "You're in. 7 days to explore everything."
- "Trial ends April 30, 2026. We won't charge $249 until then. Cancel anytime in /settings/billing."
- Auto-redirects to `/onboarding/compliance-profile` after 3s, OR user clicks "Continue →"

---

### Screen 6 — Compliance profile (EXISTS, polish needed)

**Route:** `/onboarding/compliance-profile`  
**Status:** ✅ Already built. ✅ 8 toggles. ✅ Auto-enables frameworks.

**Polish for onboarding fit:**
- Add a header strip: "Step 2 of 3 — tell us about your practice"
- Add a "back to dashboard" escape hatch (currently no way out)
- Default the toggles based on practice **state** (e.g., MA practices auto-enable WPV; NY auto-enables SHIELD policy template)
- Show what each toggle "unlocks" in real-time (already does, mostly)

---

### Screen 7 — First-run wizard (NEW — the highest-leverage screen)

**Route:** `/onboarding/first-run`  
**Purpose:** Walk the practice owner through 4 micro-tasks that get the practice from compliance score 0 to 30 in 15-20 minutes. Builds momentum + product trust.

**4 steps (sequential, each completable):**

#### Step 1 — Designate yourself as Privacy + Security Officer (90 seconds)
- Pre-fills the OWNER's name
- Two big toggle cards: "I'll be the Privacy Officer ✓" / "I'll be the Security Officer ✓"
- One click each → fires `OFFICER_DESIGNATED` events for PRIVACY + SECURITY
- Score moves: HIPAA_PRIVACY_OFFICER + HIPAA_SECURITY_OFFICER both flip COMPLIANT
- "+10 points" celebration animation

#### Step 2 — Adopt your first policy (Privacy Policy) (3 minutes)
- "Every practice needs a Privacy Policy. We'll start you with our HIPAA-compliant template."
- Big "Adopt template" button → fires POLICY_ADOPTED for HIPAA_PRIVACY_POLICY (with content from PolicyTemplate)
- Show the policy body in a scrollable preview (read-only here)
- "You'll be able to edit it anytime in /programs/policies"
- "+5 points" celebration

#### Step 3 — Take HIPAA Basics yourself (10 minutes)
- "OCR expects every workforce member to complete HIPAA training. Let's get you done first."
- Embedded `<TrainingCourse>` component (existing) for HIPAA_BASICS
- 10 quiz questions, pass at 80%
- On pass: TRAINING_COMPLETED → HIPAA_WORKFORCE_TRAINING flips COMPLIANT (since OWNER is the only practice user)
- "+10 points" celebration

#### Step 4 — Invite your team (or skip) (2 minutes)
- "Now invite the rest of your staff so they can complete training too."
- Uses the new **`<BulkInviteForm>`** (see Screen 10 below). Two input modes inside it:
  - **Quick mode** — paste-many-emails textarea, one role applies to all
  - **CSV mode** — drag-drop or browse a CSV with per-row `firstName, lastName, email, role`
- "Invite [N] people" button → batches into `USER_INVITED` events (existing) + sends invite emails
- OR "Skip for now — I'll do this later" link
- Either way, advance to dashboard

**End of wizard:**
- Confetti animation
- "You're at compliance score 30. Here's what's next." → routes to `/dashboard` with the Compliance Track front + center

**Skip handling:**
- "Skip onboarding" link in the top-right of EVERY first-run screen
- Confirms: "You can come back to this anytime in /programs/track. Skip?"
- If skipped, sets `Practice.firstRunCompletedAt = null` so we can re-prompt later
- If completed, sets `Practice.firstRunCompletedAt = now`

---

### Screen 8 — Dashboard with Compliance Track focus (EXISTS, polish needed)

**Route:** `/dashboard`  
**Status:** ✅ Built. Compliance Track lives at `/programs/track`.

**Polish:**
- For new accounts (firstRunCompletedAt within last 7 days), make the Compliance Track widget the FIRST thing on the dashboard, large + prominent
- Show "X of Y onboarding tasks complete" with progress bar
- Each task has a clear next-action button
- For accounts past 7 days, demote the track widget but keep it accessible

---

### Screen 10 — Bulk invite team members (NEW)

**Routes:**
- Lives as a reusable `<BulkInviteForm>` component used in:
  - First-run wizard Step 4 (`/onboarding/first-run`)
  - Standalone page `/programs/staff/bulk-invite` for ongoing use after onboarding
- Both routes carry the same component; the wizard variant has next/skip buttons.

**Purpose:** Get every staff member added in one batch instead of 20 one-at-a-time clicks. The single biggest onboarding pain point for SMB practices with 5–25 employees.

#### Two input modes

##### Mode A — Paste / type emails (default, fastest for ≤10 people)
- Big textarea, one email per line OR comma/space separated
- Role dropdown applied to ALL emails entered: `STAFF` (default), `ADMIN`, `VIEWER`
- Live validation as user types: each line gets a green check (valid + new) / yellow info (already invited) / red X (invalid format / already a member)
- Counter: **"7 will be invited as STAFF · 1 already a member · 1 invalid"**

##### Mode B — CSV upload (for 10+ people, or pre-existing rosters)
- Drag-drop zone OR "browse" button — accepts `.csv` only, ≤500KB
- Expected columns (header row required, case-insensitive): `firstName`, `lastName`, `email`, `role`
- Optional: `title` (e.g., "Front Desk Lead") — stored in `PracticeUser.title` if we add the column (see Schema additions below)
- Pre-import preview table shows the first 50 rows with per-row status badges (Valid / Duplicate / Invalid)
- "Download template CSV" link generates a 1-row example with realistic placeholder values
- After validation, **"Invite 14 people"** button is enabled only if ≥1 row is valid

#### Validation rules (apply to both modes)
1. Email format (RFC 5322 superset)
2. Email not already a member of THIS practice (User → PracticeUser join)
3. Email not already invited to THIS practice and pending (Invitation table — already exists)
4. Role is one of `OWNER`, `ADMIN`, `STAFF`, `VIEWER`. Owners can't bulk-invite OWNERs (single-OWNER product convention; transfer-ownership is a separate flow per `v2-deferred-roadmap.md`).
5. Per-row max signal: **only INVALID rows block submit if mixed**; the valid-row subset still gets sent. UI shows a final summary: "12 invitations sent · 2 skipped (1 invalid, 1 already member)."

#### Server action `bulkInviteAction(rows)`
1. Auth: requires OWNER or ADMIN role
2. Validate every row server-side (client validation is convenience only)
3. For each valid row, emit `USER_INVITED` event (existing) → existing projection writes the `Invitation` row + sends the invite email
4. Wrap the whole batch in a single Prisma transaction so partial-failure is impossible
5. Return: `{ invitedCount, skippedDuplicates, skippedInvalid, perRowResults: [{email, status}] }`
6. Surface results in a toast + success card on the page

#### UI affordances
- **Progress bar** during submit (one tick per `USER_INVITED` event written) — sub-second for typical batches but reassuring for big CSVs
- **"Resume failed"** button if any of the email-sends fail (Resend rate limit, etc.) — re-runs only the failed rows
- **Activity-log integration** (free, comes from existing event projection) — every invite shows up in /audit/activity with the actor + timestamp
- **AI Explain** affordance (existing pattern) on each USER_INVITED row in the activity log

#### Schema additions (additive, optional)
- `PracticeUser.title String?` — captures the "Front Desk Lead" / "RN" / "Office Manager" label so reports can group by role function. Optional; nothing breaks if absent.
- No new event type needed — reuses `USER_INVITED`. Bulk-vs-single is a UI concern only; the event log doesn't care.

#### Edge cases handled
- **>100 rows in one batch**: hard-cap at 200 to keep the transaction tight. Above that, ask user to split into multiple uploads. Most SMB practices ≤25 staff.
- **Duplicate email in the same batch** (rare but possible from CSV typos): dedupe server-side, keep first occurrence, flag duplicates in the result summary
- **Owner uploads a CSV with their own email**: skip silently (already a member)
- **CSV with extra columns**: ignore unknown columns, only read the required four
- **CSV with missing role column**: default to `STAFF` for every row, surface a banner "All rows defaulted to STAFF — add a role column to override"

#### Dependencies
- Resend domain (existing dependency for any email)
- `csv-parse` npm package (~5KB, single dep) for CSV parsing
- No schema migration needed for MVP (the `title` column is optional)

#### Existing standalone page `/programs/staff` extension
- Add a prominent **"+ Bulk invite"** button at the top, opens the same `<BulkInviteForm>` in a sheet/drawer
- Solo-add button stays for the common case of "add 1 person to existing team"

---

### Screen 9 — Drip emails (BROKEN, needs Resend wired)

**Trigger:** `Practice.subscriptionStatus = TRIALING` start

**5 emails over 10 days:**
- **Day 1** — "Welcome — your 30-minute first-run guide" (links to `/onboarding/first-run` if incomplete, otherwise `/programs/track`)
- **Day 3** — "How's your compliance score?" (links to `/dashboard`, calls out highest-leverage gap)
- **Day 5** — "Did you know? Average OCR fine for missing P&P is $47k" (links to `/programs/policies` template library)
- **Day 7** — "Your trial ends in 24 hours" (links to `/settings/billing` to confirm payment method or cancel)
- **Day 10** — "How's it going? Reply with feedback, or schedule a 15-min call" (links to Cal.com booking)

Each email is **personalized** with: practice name, current score, top 3 gaps. Pulled from compliance state at send time.

**Tech:** `src/lib/onboarding-drip.ts` exists but broken (per `pending-work.md`). Needs:
1. `sendOnboardingDay1/3/5/7/10` functions added to `src/lib/email.ts`
2. Resend domain configured (still pending — see Section 8)
3. Cron handler at `/api/cron/onboarding-drip` (existing crons pattern)

---

## 4. State machine — what gets stored where

```
sign-up form submit
    ↓ Firebase createUser(email, password)
    ↓ /api/auth/sync POST (existing) → User row written
    ↓ createPracticeAndOwnerAction({ practiceName, primaryState })
    ↓
User { id, firebaseUid, email, firstName, lastName,
       emailVerified: false }
Practice { id, name, primaryState, subscriptionStatus: 'INCOMPLETE',
           stripeCustomerId: null, firstRunCompletedAt: null }
PracticeUser { userId, practiceId, role: 'OWNER' }
LegalAcceptance × 2 rows (BAA_v1 + TOS_v1)
EventLog: PRACTICE_CREATED + USER_INVITED for OWNER

email verify click
    ↓ Firebase trigger
    ↓
User.emailVerified = true

Stripe Checkout success webhook
    ↓ /api/stripe/webhook checkout.session.completed
    ↓
Practice.subscriptionStatus = 'TRIALING'
Practice.stripeCustomerId = ...
Practice.stripeSubscriptionId = ...
Practice.trialEndsAt = now + 7d
EventLog: SUBSCRIPTION_STARTED (NEW event type)

Compliance profile saved
    ↓ existing saveComplianceProfileAction
    ↓
PracticeComplianceProfile row + auto-enabled PracticeFramework rows

First-run wizard step completes
    ↓
EventLog: OFFICER_DESIGNATED / POLICY_ADOPTED / TRAINING_COMPLETED / USER_INVITED
Score recomputes via existing rederive pipeline

Wizard finished
    ↓
Practice.firstRunCompletedAt = now
EventLog: ONBOARDING_FIRST_RUN_COMPLETED (NEW event type)
```

### New schema needs (additive)

- `Practice.firstRunCompletedAt DateTime?`
- `Practice.stripeCustomerId String?`
- `Practice.stripeSubscriptionId String?`
- `Practice.trialEndsAt DateTime?` (already exists per memory)
- `Practice.subscriptionStatus` enum (already exists per memory: `INCOMPLETE | TRIALING | ACTIVE | PAST_DUE | CANCELED`)

### New event types

- `SUBSCRIPTION_STARTED` (Stripe webhook)
- `SUBSCRIPTION_STATUS_CHANGED` (Stripe webhook)
- `ONBOARDING_FIRST_RUN_COMPLETED` (wizard finish)

---

## 5. Routing + redirect rules

The dashboard layout (`src/app/(dashboard)/layout.tsx`) currently redirects users without a PracticeUser to `/onboarding/create-practice`. Extend this to a more granular state machine:

```typescript
// Pseudocode for layout-level redirect
const u = await getCurrentUser();
if (!u) redirect("/sign-in");
if (!u.emailVerified) redirect("/sign-up/verify");

const pu = await getPracticeUser();
if (!pu) redirect("/onboarding/create-practice");

const p = pu.practice;
if (p.subscriptionStatus === "INCOMPLETE") redirect("/sign-up/payment");
if (p.subscriptionStatus === "PAST_DUE" || p.subscriptionStatus === "CANCELED") {
  // Show locked-out screen with "fix billing" CTA
  redirect("/account/locked");
}

// Compliance profile not done?
const cp = await db.practiceComplianceProfile.findUnique(...);
if (!cp) redirect("/onboarding/compliance-profile");

// First-run wizard not done? Don't redirect — surface as a top-of-dashboard prompt
// (avoids the dead-end feel of forcing the wizard on every visit)

// All good — render the dashboard
return <DashboardLayout>{children}</DashboardLayout>;
```

**Important:** redirects only happen on `/dashboard/*` and `/programs/*` and `/modules/*` and `/audit/*`. The `/sign-up/*` and `/onboarding/*` and `/account/*` routes are NOT subject to these redirects (otherwise we'd loop).

---

## 6. Decisions you need to make

These are explicit choices the spec doesn't lock — your call.

### 6.1 Stripe Checkout vs Elements
**Recommendation:** Checkout for launch. Migrate to Elements post-launch if conversion data warrants.

### 6.2 Trial requires credit card?
**Recommendation:** Yes, card-on-file required to start trial. Filters tire-kickers, predicts higher activation. Industry standard for B2B SaaS in this price range.  
**Alternative:** No-card trial → much higher signups but much lower conversion. Adds support burden (people forget about us, no email follow-through).

### 6.3 First-run wizard — mandatory or skippable?
**Recommendation:** Skippable but persistent. Skip → top-of-dashboard banner re-prompts every visit until completed or explicitly dismissed.  
**Alternative:** Mandatory until done → highest activation but feels paternalistic, blocks "I just want to see the product first" people.

### 6.4 Email verification — gate payment?
**Recommendation:** Yes. Verify email → then payment. Filters typo'd emails, fake addresses.  
**Alternative:** Verify async (don't block payment) → faster funnel but more support tickets when emails bounce.

### 6.5 First-run wizard length
**Recommendation:** 4 steps (designate officer, adopt 1 policy, take 1 course, invite team). 15-20 min total. Aims for "first 30 minutes" win.  
**Alternative shorter (3 steps):** Skip the training step, push to "do later." Faster wow moment but loses the highest-leverage demo of the product.  
**Alternative longer (6 steps):** Add SRA + first BAA + first incident drill. Too much for first session.

### 6.6 Self-serve sign-up vs invite-only
**Recommendation:** Self-serve at launch. Invite-only mode kept as feature flag (`Practice.selfServeEnabled = false` for white-glove customers).  
**Alternative:** Invite-only for first 50 → manual review of every signup. Higher quality, way slower growth.

### 6.7 Pricing display on the marketing site
**Recommendation:** Show pricing publicly on `gwcomp.com/pricing`. No "Contact us for pricing" anti-pattern.  
Already aligned with current marketing per `billing-single-tier.md`.

### 6.8 Owner gets unconditional admin access during trial?
**Recommendation:** Yes. Owner during trial can do everything an Active owner can. Lockout only when subscription becomes `PAST_DUE` (after the trial → first invoice fails).

### 6.9 What happens at the end of the 7-day trial?
**Default:** Stripe automatically attempts to charge the card on file. Successful → `ACTIVE`. Failed → `PAST_DUE` → email + grace-period banner + lockout after 7 more days.  
**Decision:** Should we send a "trial ending tomorrow" email at day 6? **Recommended yes** (already in the day-7 drip).

---

## 7. Build phases (in dependency order)

### Phase A — Foundation (blockers everything else)
**Estimated effort:** 2 hours of infrastructure
- Stripe SDK installed + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` env vars
- Schema additions: `firstRunCompletedAt`, `stripeCustomerId`, `stripeSubscriptionId`
- New event types in `src/lib/events/registry.ts`: `SUBSCRIPTION_STARTED`, `SUBSCRIPTION_STATUS_CHANGED`, `ONBOARDING_FIRST_RUN_COMPLETED`
- New projection: `subscriptionStatus.ts`

**Blocked by:** You providing Stripe creds.

### Phase B — Auth + sign-up (independent of payment)
**Estimated effort:** 3-4 hours
- `/sign-up` page with form
- `createPracticeAndOwnerAction` server action
- `/sign-up/verify` page with polling
- Resend `LegalAcceptance` enforcement
- TOS + BAA static pages (or reuse marketing-site `/baa` and link out)

### Phase C — Payment flow
**Estimated effort:** 4-5 hours
- `/sign-up/payment` page
- `createCheckoutSessionAction`
- `/api/stripe/webhook` handler (5 event types)
- `/sign-up/payment/success` page
- Subscription-status redirect rules in dashboard layout
- Locked-out screen at `/account/locked`

**Blocked by:** Phase A. Strongly benefits from Phase B (authenticated state).

### Phase D — First-run wizard + bulk invite
**Estimated effort:** 7-8 hours
- `/onboarding/first-run` route + 4 step components
- Each step composes existing actions (officerDesignated, policyAdopted, trainingCompleted, userInvited)
- **`<BulkInviteForm>` component** (Screen 10) — paste mode + CSV mode + per-row validation + batch action
- **Standalone `/programs/staff/bulk-invite`** route + entry point button on `/programs/staff`
- `bulkInviteAction` server action — transactional, batched, returns per-row results
- Confetti / celebration UI (use `react-confetti` or canvas)
- Top-of-dashboard re-prompt banner for incomplete first-run
- `firstRunCompletedAt` write on completion

### Phase E — Drip emails
**Estimated effort:** 3-4 hours
- Resend domain configured
- 5 email templates in `src/lib/email/templates/onboarding-day-*.tsx` (using react-email)
- Restore `src/lib/onboarding-drip.ts` to working state
- New cron route `/api/cron/onboarding-drip` (daily 8am ET)
- Cron Scheduler entry

**Blocked by:** Resend domain + EMAIL_FROM env.

### Phase F — Polish (defer until A-D ship)
**Estimated effort:** 2-3 hours
- Compliance profile screen polish (state-aware defaults, escape hatch)
- Dashboard polish (Compliance Track prominence for new accounts)
- Pricing page on app subdomain (or redirect to marketing pricing)

---

## 8. Dependencies on you

**Hard blockers (can't ship without):**

| What | Why blocked | Cost |
|------|-------------|------|
| Stripe API keys | Needed for any payment work | Free, ~5 min in Stripe dashboard |
| Stripe webhook signing secret | Needed for webhook security | Free, ~2 min |
| Stripe Price IDs (monthly + annual) | Define in Stripe dashboard | Free, ~5 min |
| Resend domain verification | Needed for drip emails + transactional | Free if domain SPF/DKIM ready |
| EMAIL_FROM env var | Needed for any email | Free |
| `gwcomp.com/baa` + `/terms` URLs | Linked from sign-up checkbox | Already exist on marketing site (per `(auth)` routing notes) |

**Soft blockers (can ship without but degraded):**

| What | Why | Workaround |
|------|-----|------------|
| Marketing-site sign-up CTA flip | Currently goes to waitlist modal | Manual: tell marketing waitlist members the URL of the new sign-up page |
| Cloud SQL trial-period prod data | Trial logic needs prod DB | Manually flip subscriptionStatus on test practice for QA |

---

## 9. What we explicitly are NOT building

- **Multi-step "create practice" wizard** — keep it 1 step, the compliance profile + first-run wizard are where the depth lives
- **OAuth (Google sign-in)** — Firebase supports it but adds complexity. Defer to v2.1.
- **SSO (SAML)** — enterprise feature, defer to v2.5+
- **Per-staff invitation accept flow** — already built, no changes needed
- **In-app credit card management UI** — Stripe Customer Portal handles this; just link to it from `/settings/billing`
- **Tiered pricing** — locked decision per `v2-decisions-locked.md`
- **AI-tailored first-run** — defer per `v2-deferred-roadmap.md`
- **In-product BAA/DPA acceptance flow** — sign once during sign-up, kept as `LegalAcceptance` row, never re-prompted (per `v1-ideas-survey.md` §4.8)

---

## 10. Open questions for product owner

1. **Pricing display:** Show monthly vs annual toggle on `/sign-up/payment`, or pre-select monthly and offer "switch to annual to save $600/yr" upsell post-trial?
2. **Email verification grace:** If a user verifies email later (e.g., 3 days after sign-up), do we want a "welcome back" email when they verify?
3. **Compliance profile defaults:** Should we hit an external API (Healthgrades, NPI Registry) to pre-fill specialty + provider count from practice name + state? Adds magic but also surveillance creepiness.
4. **First-run wizard skip-cost:** If a user skips the wizard, should we still send the day-1 drip email? Recommended yes.
5. **Demo data option:** Should new accounts have an option to start with "load demo data" (sample policies adopted, sample staff, sample incidents)? Useful for sales demos but possibly misleading for real practices.
6. **Practice deletion / account close:** Where does that live? Currently nowhere. `/settings/practice → Delete account` button → email confirmation → 30-day soft delete?

---

## 11. Sequencing options

Given the user can keep merging at the current pace (16 PRs in 3 days), here are three credible orderings:

**Order 1 — Foundations first (slowest to user-facing change but cleanest):**  
A → B → C → D → E → F  
Total: ~20 hours

**Order 2 — Get to first wow ASAP (recommended):**  
B (sign-up form, can sign up but no payment) → D (first-run wizard, works for anyone with a Practice) → A + C (payment) → E (drip) → F  
Total: ~20 hours, but UI value visible after step 2

**Order 3 — Critical path for revenue (fastest path to first dollar):**  
A + C (Stripe wired, can charge) → B (sign-up form) → D (first-run wizard) → E + F  
Total: ~20 hours, but requires you to have Stripe creds before any UI work starts

**Recommendation:** Order 2 if Stripe creds are still being sorted; Order 3 if you have them ready today.

---

## 12. Success criteria (post-launch)

- ≥80% of email-verified accounts complete payment
- ≥60% of paid accounts complete the first-run wizard
- ≥40% of paid accounts have ≥1 policy acknowledged + ≥1 training complete in 7 days
- ≥75% of paid accounts return to the app within 7 days (drip working)
- <10% trial-to-active conversion failure (i.e., card on file actually charges)
- <5% accounts in `PAST_DUE` for >24 hours (proactive payment retry working)

---

## Appendix A — Comparison to v1

v1 had:
- Single-page wizard at `/onboarding/page.tsx` → `wizard.tsx` (one component)
- Practice name + state + monthly/annual toggle + Stripe Checkout call (immediate)
- Email verification via Firebase but not blocking
- No first-run wizard — dropped users into `/dashboard`
- BAA + DPA acceptance was a separate flow
- Drip emails partially working (Day 1/3/5/7/10 functions referenced but broken per `pending-work.md`)

v2 improvements (per this spec):
- Multi-step but optimized for fast path (sign-up → verify → pay → profile → first-run)
- Email verification gate before payment (cleaner data, fewer support tickets)
- 4-step first-run wizard (the missing thing in v1 — dropped users with zero direction)
- First-run leverages all the work we've done: Compliance Track + policy editor + acknowledgment workflow + training catalog
- Drip emails personalized with current compliance state

---

## Appendix B — Estimated launch readiness

After all 6 phases ship + you provide Stripe + Resend creds:

- Self-serve sign-up: ✅ working
- 7-day trial: ✅ working
- Card collection: ✅ working
- Activation flow: ✅ working (first-run wizard)
- Re-engagement: ✅ working (drip emails)
- Payment failure handling: ✅ working (PAST_DUE state + lockout)
- Cancellation: ✅ working (Stripe Customer Portal link)
- Trial → Active conversion: ✅ working (Stripe automated)

**Estimated time from "you give me Stripe + Resend creds" to "self-serve onboarding live in prod":** ~3 working sessions (12-15 hours total), assuming 1 PR per phase.

---

*End of spec. Ready for your review + comments.*
