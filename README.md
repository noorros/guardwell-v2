# GuardWell v2

The greenfield rebuild of GuardWell Compliance. v1 is frozen at
`D:/GuardWell/guardwell` (`app.gwcomp.com`); this is its replacement.

## Why v2 exists

The product audit on 2026-04-19 surfaced two truths:

1. The codebase is *competent* but the **conceptual model conflates regulatory
   frameworks (HIPAA, OSHA, OIG, …) with operations programs (Policies,
   Training, Incidents, …)**. Treating them as flat-equal modules forces the
   user to navigate 8+ surfaces to understand "am I audit-ready?" and forces
   the codebase to repeat the same checklist UI 14 times.
2. With **zero paying customers**, the migration cost of a clean rebuild is
   zero. Locking in v1's assumptions for 50 customers and *then* trying to
   restructure would be a year of pain.

So v1 freezes, v2 is greenfield, marketing site stays live with a waitlist
gate, and we ship v2 in roughly 16 weeks. See
`memory/v2-rebuild-strategy.md` for the full decision context.

## Architecture in one paragraph

Compliance is, fundamentally, **provable history of evidence against
external mandates**. v2 models this directly: an immutable **EventLog** is
the source of truth, current state is a derived projection, **regulations
are data** (rows in `RegulatoryFramework`), and the user-facing surface
is a **single dashboard** where a predictive compliance score points at
the next 3 highest-impact actions. The AI Concierge lives ambient on every
page, context-aware. Notifications are weekly digests + critical-only
inline alerts. State law is a first-class jurisdictional overlay, not a
footer section bolted into HIPAA/OSHA pages.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Actions, Turbopack) | Same as v1, no reason to switch |
| Language | TypeScript strict + `noUncheckedIndexedAccess` | Catches more at build time |
| ORM | Prisma 5.22 | Productive, familiar |
| Database | PostgreSQL on Cloud SQL | Multi-tenant via `practiceId` row-scoping |
| Auth | Firebase Auth | Already integrated in marketing waitlist; migrating off is high-cost low-benefit |
| Styling | Tailwind v4 + Shadcn (`new-york` style) | Same as v1 |
| Icons | Lucide | Standard |
| Toasts | Sonner | Standard |
| AI | Anthropic SDK + LLM ops layer | See [ADR 0003](docs/adr/0003-llm-ops.md) |
| Billing | Stripe (single tier) | Same as v1, no `PlanTier` legacy |
| Rate limiting | Upstash Redis | Same as v1 |
| Email | Resend | Replaces v1's AWS SES |
| Hosting | Cloud Run (app) + Cloud Build (CI) | Same as v1 |
| PDF | `@react-pdf/renderer` | Same as v1 |

## Foundational decisions

These are upfront commitments that cannot be retrofitted later. See ADRs:

- **[ADR 0001 — Event sourcing for compliance state](docs/adr/0001-event-sourcing.md)**
  All compliance-relevant state changes are immutable events. Current state
  is a derived projection. Score recompute = replay events.
- **[ADR 0002 — Regulations × Operations matrix](docs/adr/0002-regulations-operations-matrix.md)**
  Regulations and operations programs are different kinds of things;
  separate sidebar sections; matrix view aggregates them.
- **[ADR 0003 — LLM ops layer](docs/adr/0003-llm-ops.md)**
  Prompt versioning, eval harness, observability, structured outputs.
- **[ADR 0004 — Modules as data](docs/adr/0004-modules-as-data.md)**
  Adding a new regulatory framework = INSERT into `RegulatoryFramework`,
  not a code deploy. Built for the regulatory landscape's continuous flux.
- **[ADR 0005 — Internal design system](docs/adr/0005-design-system.md)**
  Documented `<ComplianceCard>`, `<ScoreRing>`, `<ChecklistItem>`,
  `<ModuleHeader>`, `<EvidenceBadge>`, etc. Used everywhere. A11y baked in.

## Project structure

```
guardwell-v2/
├── docs/
│   └── adr/                       # Architecture decision records
├── prisma/
│   └── schema.prisma              # Foundational schema (see ADR 0001/0004)
├── public/                        # Static assets
├── scripts/                       # One-off seed/migration helpers
├── src/
│   ├── app/                       # Next.js routes (App Router)
│   ├── components/
│   │   ├── ui/                    # Shadcn primitives
│   │   ├── shared/                # App-wide components
│   │   └── dashboard/             # Dashboard-specific
│   └── lib/                       # Utilities (no React, no Next.js-specific)
├── components.json                # Shadcn config
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
└── tsconfig.json
```

## Getting started

```bash
# Install
npm install

# Initialize DB (against the dedicated v2 Cloud SQL DB — see .env.example)
npx prisma db push

# Dev server
npm run dev   # http://localhost:3000
```

## Deployment

- **Build:** Cloud Build (separate trigger from v1 `guardwell` repo)
- **Service:** Cloud Run service `guardwell-v2`
- **DB:** Cloud SQL instance `guardwell-v2-db` (separate from v1)
- **Domain:** `v2.app.gwcomp.com` until launch, then DNS flips to `app.gwcomp.com`

## Status

| Phase | Weeks | Status |
|---|---|---|
| Schema + event sourcing foundation | 1–2 | 🚧 in progress |
| Design system + auth + multi-tenant scaffolding | 3–4 | ⏳ pending |
| LLM ops + first 3 modules (HIPAA, OSHA, OIG) | 5–6 | ⏳ pending |
| Remaining modules + operations programs | 7–9 | ⏳ pending |
| Unified dashboard + predictive score + ambient AI | 10–11 | ⏳ pending |
| Notification redesign + onboarding | 12 | ⏳ pending |
| Integration testing + a11y audit + polish | 13–14 | ⏳ pending |
| Security review prep | 15 | ⏳ pending |
| Launch (DNS flip) | 16 | ⏳ pending |

## What's NOT in v2 launch scope

- Native iOS/Android apps (post-launch decision based on demand)
- International support (US-only at launch)
- SOC 2 / HITRUST certifications (table stakes long-term, not for first 50 customers)
- More than the 14 modules from v1 (modules-as-data lets us add later as INSERTs)
