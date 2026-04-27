# V2 Launch Readiness Plan

**Created:** 2026-04-27
**Owner:** Noorros + Claude
**Status:** Active

## Where we are

V2 is feature-complete through the spec'd 16-week plan as of today (8 calendar days in). Onboarding spec phases A–F are live in prod. All 8 regulatory frameworks, 11 program surfaces, and 4 audit-prep modes are shipped. 434 tests passing. Stripe billing live. Drip emails wired (cron deployed, secret pinned).

## What's left before launch

Four buckets, in shipping order:

### Bucket 1 — Customer-visible polish (~1 week)
The marketing-narrative gap. Each item is something a prospect sees and says "yes, this is what I need."

- **Reports surface** — 5 PDF reports. Compliance overview already ships; add training summary, incident summary, vendor+BAA register, credentials register, annual P&P attestation. Per `v1-ideas-survey.md` §1.10.
- **Asset inventory → SRA wiring** — `TechAsset` rows already exist; SRA derivation should require ≥1 PHI-processing asset. Makes the SRA substantive instead of attestation-only. Per `v1-ideas-survey.md` §1.8.

### Bucket 2 — First-customer support readiness (~3 days)
What we need the moment a real customer hits a problem.

- **Admin dashboard MVP** — practice list (search by name/email, view subscription status), customer health snapshot (computed from event log: last login, score trend, open critical gaps), manual subscription override (grant 30-day extension). Per `v1-ideas-survey.md` §1.9.

### Bucket 3 — Hardening (~1 week)
Cross-cutting quality that we don't want to discover live.

- **A11y pass** — keyboard navigation, focus order, color contrast (WCAG AA), screen reader smoke test (NVDA/VoiceOver) on the 5 highest-traffic surfaces (dashboard, modules, programs/policies, programs/staff, /audit/overview).
- **Security review prep** — auth flow review, RBAC matrix, multi-tenant RLS audit, OWASP top-10 sweep, env-var audit, secrets rotation plan.
- **Performance pass** — Lighthouse scores on 5 key pages, bundle size analysis, slow-query log review, Cloud SQL query EXPLAIN on the dashboard's Promise.all queries.

### Bucket 4 — Operational launch checklist (mostly Noorros)
Things only Noorros can do, listed here for the handoff.

- **Resend domain verification** — `gwcomp.com` SPF/DKIM/DMARC. Without this, drip + invite emails go to spam.
- **Marketing site CTA flip** — replace waitlist gate with trial CTAs at `gwcomp.com`. Single-line config change in the marketing repo.
- **DNS flip plan** — `v2.app.gwcomp.com` → `app.gwcomp.com`. Coordinate with v1 freeze announcement.
- **Stripe webhook** — already registered (PR #131 era). Verify still pointing at the correct endpoint after any URL change.
- **First-customer test** — manual end-to-end with a real Firebase account, real Stripe card (refund after), real domain.

## Sequencing (revised 2026-04-27 with Allergy + Evidence/CEU added)

| # | Chunk | Effort | PR / Plan |
|---|-------|--------|-----------|
| 1 | Reports framework + initial 2 reports (training summary, incident summary) | 1 day | **Pre-existing on main** (discovered, not built) |
| 2 | Remaining 3 reports (vendor+BAA, credentials, annual P&P attestation) | 1 day | **PR #135** (open, awaiting merge) |
| 2.5 | Bulk CSV import + export — generic `<BulkCsvImport>` + tech-assets/vendors/credentials surfaces | 2 days | **PR #135** (same PR as above) |
| **3** | **Allergy module** — customer-blocking; full v2-faithful port of v1's USP 797 §21 subsystem | **7 days** | [`docs/plans/2026-04-27-allergy-module.md`](2026-04-27-allergy-module.md) |
| **4** | **Evidence uploads + CEU tracking + renewal reminders** + MA cert seed | **5 days** | [`docs/plans/2026-04-27-evidence-ceu-reminders.md`](2026-04-27-evidence-ceu-reminders.md) |
| 5 | Asset inventory → SRA wiring | 0.5 day | 1 PR |
| 6 | Admin dashboard MVP | 2 days | 1-2 PRs |
| 7 | A11y pass | 2 days | 1-2 PRs |
| 8 | Security review prep | 2 days | 1 doc + targeted fix PRs |
| 9 | Performance pass | 1 day | 1-2 PRs |
| 10 | Operational handoff doc for Noorros | 0.5 day | 1 doc |

**Estimated total:** ~22 days of code remaining. At current velocity (multiple PRs per session, full feature in 1-2 sessions) that's 4-6 working sessions.

**Strict ordering rationale:**
- Chunks 1-2 are landed/in-flight code that ships customer-visible value with zero risk.
- Chunk 3 (Allergy) is **customer-blocking** — first customer specifically asked for it. Prioritize over polish.
- Chunk 4 (Evidence/CEU/Reminders) addresses gaps Noorros surfaced in the credentials surface review. Touches GCS so requires bucket setup before merge.
- Chunks 5-9 are launch hardening — order is flexible but Asset/SRA wiring is small enough to fit anywhere; admin MVP gates first-customer support; A11y/Security/Perf can run in parallel late.
- Chunk 10 is the operational handoff Noorros needs to flip the marketing CTAs + DNS.

## Out of scope for v2 launch (consciously deferred)

Per `v2-deferred-roadmap.md` plus this session's confirmations:

- **AI extraction from uploaded evidence** — Phase 5 of the Evidence subsystem. Anthropic call on PDF/image → structured fields → confirm-before-overwrite UX. Skip until customer files exist to evaluate against.
- Vendor signing workflow / DocuSign-style BAA collection
- AI-tailored training
- BYOV (bring your own video)
- Knowledge base
- Handbook generator (1 customer ask away from queueing)
- Assignments (1 multi-staff customer away from queueing)

## Per-chunk acceptance criteria

### Chunk 1 — Reports framework + 2 reports
- [ ] `/audit/reports` lists all available reports with "Generate" CTAs
- [ ] Each report renders via `@react-pdf/renderer` server-side
- [ ] Practice header repeated on every PDF page
- [ ] **Training summary** report — per-staff completion grid + course expirations
- [ ] **Incident summary** report — table by status + breach determinations + notification dates
- [ ] Both reports tested via integration test (PDF byte length sanity + key strings present)

### Chunk 2 — 3 more reports
- [ ] **Vendor + BAA register** — name, type, processesPhi, baaExecutedAt, baaExpiresAt, status
- [ ] **Credentials register** — license + DEA + insurance, grouped by holder, expiration warnings
- [ ] **Annual P&P review attestation** — list of every adopted policy with version, lastReviewedAt, attesting officer

### Chunk 3 — Asset inventory → SRA wiring
- [ ] HIPAA_SRA derivation rule updated: requires ≥1 TechAsset row with `processesPhi=true`
- [ ] SRA wizard surfaces a warning if no PHI-processing assets exist
- [ ] Auto-generated data-flow narrative: "PHI flows from {assets where processesPhi=true} via {network paths if known}"
- [ ] Test: SRA without assets stays GAP; adding 1 PHI asset + completing SRA → COMPLIANT

### Chunk 4 — Admin dashboard MVP
- [ ] `/admin` route gated by `User.isPlatformAdmin` (already present in schema)
- [ ] **Practice list** — search by name/email, columns: name, primary state, owner email, subscriptionStatus, trialEndsAt, createdAt, score, last activity
- [ ] **Practice detail** — clicking opens slide-over or page with full event log + subscription history + member list
- [ ] **Customer health snapshot** — score trend (sparkline), days since last login, count of CRITICAL gaps
- [ ] **Manual subscription override** — "extend trial by 30 days" button (writes EventLog entry + updates Practice.trialEndsAt)
- [ ] Audit trail: every admin action records `actorUserId` in EventLog with `source=ADMIN`

### Chunk 5 — A11y pass
- [ ] Keyboard navigation: tab order makes sense on dashboard, modules, programs/policies, programs/staff, /audit/overview
- [ ] All interactive elements have visible focus rings
- [ ] Color contrast meets WCAG AA on text + UI elements (Tailwind tokens in `globals.css`)
- [ ] All form inputs have associated labels (not just placeholder)
- [ ] All images/icons have alt or aria-hidden
- [ ] Screen reader smoke test: walk through dashboard → /modules/hipaa → adopt a policy with VoiceOver/NVDA running
- [ ] Add `react-axe` (dev only) for ongoing detection

### Chunk 6 — Security review prep
- [ ] Doc: `docs/security/auth-flow.md` — Firebase token verification, fb-token cookie scoping, session lifetime
- [ ] Doc: `docs/security/rbac-matrix.md` — for every server action + page, what role is required + how it's enforced
- [ ] Audit: every Prisma query in app code is scoped by `practiceId` (no cross-tenant leaks)
- [ ] OWASP: confirm CSP headers, HSTS, X-Frame-Options, no SSRF, no SQL injection vectors (Prisma covers this), no XSS in user-supplied strings (already escape in email templates — check pages)
- [ ] Secret rotation runbook: how to rotate STRIPE_*, RESEND_API_KEY, FIREBASE_PRIVATE_KEY without downtime

### Chunk 7 — Performance pass
- [ ] Lighthouse on /dashboard, /modules/hipaa, /audit/overview, /programs/policies, /programs/staff (target: 90+ on Performance, Accessibility, Best Practices, SEO)
- [ ] Bundle analyzer: identify any unexpectedly large client chunks
- [ ] Cloud SQL slow query log: EXPLAIN any query > 100ms
- [ ] Server response time p95 on the 5 above pages < 500ms

### Chunk 8 — Operational handoff doc
- [ ] `docs/handoffs/2026-XX-XX-launch-checklist.md` listing every Noorros-action item with exact commands
- [ ] Resend domain steps (DNS records, verification flow)
- [ ] Marketing CTA flip steps (which file, which env var, which deploy command)
- [ ] DNS flip plan with rollback
- [ ] Pre-launch smoke test script
- [ ] Post-launch monitoring (what to watch for the first 48 hours)

## Risk register

- **Resend domain verification could take 24-48 hours** if DNS records aren't already correct. Block: do this NOW so it's done by the time we're operationally ready.
- **A11y issues might cascade** — fixing one design-system primitive could cascade to many pages. Triage: ship the audit doc first, then fix in priority order.
- **Security review might find a real vuln** — leave time to fix what we find. Don't ship until clean.
- **First-customer support volume unknown** — admin MVP needs to be operational before opening trials wide. Soft-launch to a friendly small group first.

## Out of scope for launch (explicitly deferred)

Per `v2-deferred-roadmap.md`:
- Vendor signing workflow / DocuSign-style BAA collection
- AI-tailored training
- BYOV (bring your own video)
- Knowledge base
- Allergy module
- Handbook generator
- Assignments

These ship post-launch as customer demand validates each one.

## Done state

Launch is ready when all 8 chunks are checked off, plus Noorros has confirmed:
- Resend domain verified, drip emails landing in inbox not spam
- Marketing CTAs flipped on `gwcomp.com`
- DNS flip executed (`v2.app` → `app`)
- 1 friendly customer signed up + completed first-run wizard end-to-end on the live domain
