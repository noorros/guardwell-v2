# Onboarding Phases A + B + C — Handoff

**Date:** 2026-04-24 (afternoon/evening session)  
**Context:** Built the entire onboarding spec from design doc through three phases of code, all merged + deployed + Chrome-verified live in prod.

## What shipped (10 PRs today, sessions 38–40)

| PR | Phase | What |
|----|-------|------|
| #118 | session 38 | Audit Prep CMS + DEA modes |
| #119 | session 38 | Batch 4 state overlays (full 50-state + DC) |
| #120 | session 38 | Inline policy editor + POLICY_CONTENT_UPDATED |
| #121 | session 38 | Policy version history + LCS diff |
| #122 | session 38 | Backfill PolicyVersion baselines |
| #123 | session 38 | Per-user policy acknowledgment workflow + course gates |
| #124 | A | Foundation: Stripe wrapper, schema, 4 events, projections |
| #125 | A | Onboarding flow design spec (~700 lines) |
| #126 | B | Sign-up form + email verify + GuardWell branding |
| #127 | C | Stripe Checkout + webhook + lockout + success |
| #128 | C | Env-check diagnostic + try/catch on action |
| #129 | C | Stripe env-var trim fix (CRLF in Secret Manager) |

## End-to-end onboarding flow live in prod

User journey today:
1. Land on `/sign-up?promo=BETATESTER2026` (or any URL)
2. Fill name + email + password + practice + state + accept TOS+BAA → submit
3. Firebase user created · Practice created (status `INCOMPLETE`) · OWNER PracticeUser created · TOS_v1 + BAA_v1 LegalAcceptance rows · PRACTICE_CREATED EventLog
4. Redirected to `/sign-up/verify?promo=BETATESTER2026`
5. Email verify (Firebase sends mail → user clicks link OR Firebase Admin flips manually for testing)
6. Verify page polls every 5s · once `emailVerified=true` → 1.5s celebration → redirect to `/sign-up/payment?promo=BETATESTER2026`
7. Payment page renders with **"Activate your free account"** banner (because BETATESTER2026 is 100% off forever)
8. Click "Activate free account" → Stripe Customer created or reused · Checkout Session with `discounts: [{ promotion_code: promo_… }]` + `payment_method_collection: 'if_required'` → window.location.href = checkout.stripe.com URL
9. ✅ **Verified live in prod with BETATESTER2026 — Stripe Checkout page loads**
10. *(after Stripe webhook lands)* Practice flips to `TRIALING` · `/sign-up/payment/success` polls until status changes · 3s celebration → `/onboarding/compliance-profile`
11. Compliance profile (existing) → `/dashboard`

Plus the dashboard layout enforces:
- INCOMPLETE → bounce to `/sign-up/payment`
- PAST_DUE / CANCELED → bounce to `/account/locked`

## What's in prod end-to-end

- ✅ Sign-up form, email verify, payment page, Stripe Checkout redirect — **fully functional**
- ✅ BETATESTER2026 flow — **verified live**
- ✅ /api/stripe/webhook handler — code shipped, **NOT YET wired** (needs Stripe Dashboard endpoint registration; see "Pending user actions" below)
- ✅ Subscription gate in dashboard layout
- ✅ /account/locked page with Stripe Billing Portal link
- ✅ /api/debug/env-check (admin-only)

## Pending user actions for next session

### Critical (blocks first real customer)
1. **Register the Stripe webhook endpoint** in [Stripe Dashboard → Developers → Webhooks → Add endpoint](https://dashboard.stripe.com/webhooks/create)
   - URL: `https://v2.app.gwcomp.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - Until this is registered, payments succeed at Stripe but Practice never flips from INCOMPLETE → TRIALING
2. **Push the new webhook signing secret** (`whsec_FHsY6knwVml1VoZELz3iePs8wRw1tfPq`) to Secret Manager as a new version of `STRIPE_WEBHOOK_SECRET`. Use these PowerShell commands to avoid CRLF:
   ```powershell
   [System.IO.File]::WriteAllText("$pwd\tmp.txt", "whsec_FHsY6knwVml1VoZELz3iePs8wRw1tfPq")
   gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=tmp.txt
   Remove-Item tmp.txt
   ```
   Then trigger a Cloud Run redeploy so the new revision picks up the new secret value.

### Recommended (cleanup)
3. **Re-add the price IDs in Secret Manager without CRLF** (current values have trailing newlines from the original PowerShell `Out-File`; the code-level `.trim()` in PR #129 is a safety net but cleanup prevents the same gotcha biting future secrets):
   ```powershell
   [System.IO.File]::WriteAllText("$pwd\tmp.txt", "price_1TI1yhBCzvc7E8ZzHRLdotSD")
   gcloud secrets versions add STRIPE_PRICE_MONTHLY --data-file=tmp.txt

   [System.IO.File]::WriteAllText("$pwd\tmp.txt", "price_1TI1zYBCzvc7E8ZzgwmPonZ9")
   gcloud secrets versions add STRIPE_PRICE_ANNUAL --data-file=tmp.txt

   Remove-Item tmp.txt
   ```

### Optional (housekeeping)
- Delete the test Practice + Firebase user from prod when done with manual verification (`chromeverify+phaseb-1777069200@noorros.com`, practice id `cmodh6jl200048g307hp3z5ce`)

## What's next per the spec

| Phase | Status | Effort | Blocked by |
|-------|--------|--------|------------|
| A — foundation | ✅ done | n/a | — |
| B — sign-up + verify | ✅ done | n/a | — |
| C — payment | ✅ done | n/a | webhook endpoint registration (above) |
| **D — first-run wizard + bulk-invite** | ⏳ next | 7-8 hrs | nothing |
| E — drip emails | pending | 3-4 hrs | Resend domain verification |
| F — polish | pending | 2-3 hrs | nothing |

### Phase D in detail (next session's main task)

Per `docs/specs/onboarding-flow.md` Screens 7 + 10:

1. New `/onboarding/first-run` route with 4 steps
   - Step 1 (90s): Designate yourself as Privacy + Security Officer (two click-to-confirm cards, fires OFFICER_DESIGNATED, +10pts)
   - Step 2 (3 min): Adopt your first policy (HIPAA Privacy Policy template, scrollable preview, fires POLICY_ADOPTED, +5pts)
   - Step 3 (10 min): Take HIPAA Basics yourself (embedded TrainingCourse, 10 quiz qs, fires TRAINING_COMPLETED, +10pts)
   - Step 4 (2 min): Invite your team via the new `<BulkInviteForm>` OR skip
   - Confetti + "Compliance score 30, here's what's next" → `/dashboard`
2. New reusable `<BulkInviteForm>` (paste-emails or CSV upload) — used in step 4 AND at standalone `/programs/staff/bulk-invite`
3. New `bulkInviteAction` server action (transactional, batched USER_INVITED events, per-row results)
4. Top-of-dashboard re-prompt banner if `Practice.firstRunCompletedAt` is null
5. Optional new `PracticeUser.title` column for richer staff data from CSV

Schema is already there (`Practice.firstRunCompletedAt`, `ONBOARDING_FIRST_RUN_COMPLETED` event + projection from PR #124).

## Cumulative platform state

| Asset | Today's start | End of today |
|-------|---------------|--------------|
| PRs merged | 0 | **12 today (#118-129)** |
| Audit Prep modes | HIPAA only | **HIPAA + OSHA + CMS + DEA** |
| State overlays | 30 jurisdictions | **51 (full 50-state + DC)** |
| Policy templates | 9 + 130 library | **9 + 130 library, fully editable + versioned + diff'able + acknowledgeable** |
| Federal HIPAA requirements | 16 | **17** (added POLICY_ACKNOWLEDGMENT_COVERAGE) |
| Onboarding | none | **sign-up → verify → payment → success → compliance-profile, all live** |
| Tests | 383 | **383** |

## Open issues / known bugs

- **Cloud Build cache on `_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** — substitution variable was added to cloudbuild.yaml (#124) but you may need to manually `gcloud beta builds triggers update guardwell-v2-main --update-substitutions _NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` if the trigger doesn't have it set yet. Symptom would be the client-side Stripe SDK failing to init; not a problem yet because we use Checkout (server-redirect) not Elements (client-side).
- **gcloud auth in this dev environment** keeps expiring — re-run `gcloud auth login --account=it@noorros.com` before any `gcloud secrets ...` or `gcloud run logs ...` work next session.

## Memory updates

- Memory `v2-current-state.md` has a session-39 block being added (will land in commit after this handoff)
- `content-inventory.md` no asset count changes today (training catalog still 36, policies still 9+130, state overlays still 51)

## Files of note for next session

- `docs/specs/onboarding-flow.md` — full spec (read Phase D + Screen 10 for the wizard + bulk-invite)
- `docs/handoffs/2026-04-24-overnight-build.md` — earlier overnight handoff
- `docs/handoffs/2026-04-24-onboarding-phases-a-b-c.md` — this doc

## How to start next session

1. `git status` — should be clean, on main
2. `git pull origin main` — sanity
3. `npm test -- --run` — should be 383/383
4. `cd /d/GuardWell && ./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5434 &` if you need prod DB access
5. `gcloud auth login --account=it@noorros.com` if any gcloud commands needed
6. Read this handoff + the onboarding spec § Phase D
7. Build the first-run wizard
