# ADR-0001: Event sourcing as the source of truth for compliance state

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Noorros (founder/owner), Engineering
**Supersedes:** N/A (greenfield)
**Related:** [ADR-0002 — Regulations × Operations matrix](0002-regulations-operations-matrix.md), [ADR-0004 — Modules as data](0004-modules-as-data.md)

## Context

GuardWell is a HIPAA / OSHA / OIG / CMS / DEA / CLIA / MACRA / TCPA compliance
platform for medical practices. The product's core promise is **proving
compliance over time** — not just at a moment, but provably, with a defensible
audit trail an OCR investigator can read.

v1 used a CRUD model: a `PracticePolicy` row was updated in place when a staff
member acknowledged it, a `TrainingAssignment` row's `completedAt` was
overwritten, etc. A separate `AuditLog` table was written by some (not all)
server actions to record what happened. Two real problems emerged in
production:

1. **Audit-log drift.** Many actions never wrote to AuditLog. Regulatory
   investigations would request "every change to policy X" and the answer was
   "we have the current state, plus a partial log of *some* edits." Defensible
   in theory, awkward in practice.
2. **Score recompute is opaque.** The compliance score is a weighted reduction
   over current state. It's recomputed daily by cron. There's no way to ask
   "why did my score drop 8 points last Tuesday?" because the *cause* (events)
   isn't preserved separately from the *result* (the snapshot).

We're greenfield with **zero paying customers**. The retrofit cost of moving
to event-sourced compliance state is approximately ∞ once 50 customers exist
and many states are partially-derived. Now is the only cheap moment.

### Constraints
- Single-team build, ~16 weeks to launch.
- Must run on Cloud SQL Postgres + Cloud Run (no Kafka, no Kinesis).
- HIPAA / SOC 2 readiness eventually required (not at launch).
- Per-practice tenant isolation via row-level `practiceId` scoping is
  non-negotiable.
- Some events have side effects that must run synchronously (e.g., breach
  determination must immediately update the OCR-deadline projection so the
  user sees the right banner on the same request).

## Decision

**All compliance-relevant state changes are written as immutable events to
a single `EventLog` table.** Current state is a derived projection,
maintained by event handlers running synchronously inside the same database
transaction as the event write. Score recompute is a deterministic reduction
over the event log for a given practice + window.

Concretely:

- New table `EventLog` with `id, practiceId, actorUserId?, type, payload (JSON),
  schemaVersion, createdAt`. Append-only — no UPDATE, no DELETE in
  application code; enforced by a Postgres rule + by code review.
- Event types are typed enums in TypeScript: e.g., `POLICY_ACKNOWLEDGED`,
  `TRAINING_COMPLETED`, `INCIDENT_CREATED`, `BREACH_DETERMINED`,
  `SRA_ANSWER_RECORDED`, `CREDENTIAL_RENEWED`. Each event type has a Zod
  schema for its payload, versioned via `schemaVersion`.
- Server actions are the only writers. Each action does, in one transaction:
  1. Validate input (Zod).
  2. Append the event to `EventLog` (with `schemaVersion`).
  3. Apply the projection update(s) — e.g., insert/update `PolicyAcknowledgment`,
     bump `Practice.scoreDirty=true`, etc.
  4. Optionally enqueue async side effects (notifications, emails) via Redis.
- The compliance score is recomputed by replaying events for a practice
  through pure reducer functions. For request-time freshness we keep a
  `ComplianceScore` projection table updated synchronously; for
  trend/history we always have the underlying events.

This is **event sourcing without CQRS read models** — the projections live
in normal Prisma tables alongside everything else. We get the audit-trail
and replayability properties without the operational complexity of separate
read databases.

## Options Considered

### Option A: CRUD-only (v1 status quo)

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Lowest (no extra writes) |
| Audit defensibility | Weak — relies on `AuditLog` discipline that has drifted |
| Score explainability | Poor — recompute hides the why |
| Retrofit cost later | Very high (would require reconstructing history from logs) |
| Team familiarity | Highest (same as v1) |

**Pros:**
- Least new infrastructure to learn.
- Smallest write amplification.

**Cons:**
- Already known to fail in v1 — this is exactly what we're rebuilding away from.
- Inability to answer "why did my score drop?" beyond "stuff changed."
- Audit trail completeness depends on every developer remembering to log.

### Option B: CRUD + AuditLog (v1's actual state)

| Dimension | Assessment |
|---|---|
| Complexity | Low–Medium |
| Cost | 2× writes for compliance-relevant ops |
| Audit defensibility | Medium — depends on developer discipline |
| Score explainability | Same as Option A — log isn't structured for replay |
| Retrofit cost later | High |
| Team familiarity | Medium |

**Pros:**
- Familiar to v1 developers.
- AuditLog already exists to copy from.

**Cons:**
- Two-write divergence is real and observed in v1.
- Doesn't unlock score replay/explainability.
- Forces the same per-developer discipline that already failed.

### Option C: Event sourcing without CQRS (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | 1 extra write per state change (single transaction) |
| Audit defensibility | Strong — every state change is an immutable event |
| Score explainability | Strong — score is a pure reduction over events |
| Retrofit cost later | N/A (we're doing it now) |
| Team familiarity | Medium — single-team learning curve, but pattern is well-documented |

**Pros:**
- Audit trail is structurally complete (you can't update state without
  emitting an event because the server-action helper makes you).
- Score becomes a pure function of the event log — full explainability,
  trivially testable, deterministically reproducible across environments.
- Notifications, AI Concierge context, customer-health metrics, and
  regulatory-update applications all become event subscribers, eliminating
  scattered cron logic.
- "Replay events to rebuild projections" is a free disaster-recovery and
  schema-migration tool.

**Cons:**
- Engineers need to learn the pattern. Mitigated by a strict
  `appendEventAndApply()` helper that wraps the transaction so the right
  pattern is the easy pattern.
- `EventLog` table will be larger than any other table. Mitigated by
  partitioning by `createdAt` after the first 100M rows (years away at our
  scale).
- Schema evolution requires `schemaVersion` discipline. Mitigated by event
  type registry with explicit version handlers.

### Option D: Full ES + CQRS with separate read models

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | High (separate read DB, eventual consistency) |
| Audit defensibility | Strong |
| Score explainability | Strong |
| Retrofit cost later | N/A |
| Team familiarity | Low |

**Pros:**
- Cleanest separation of write/read.
- Best read scaling.

**Cons:**
- We don't need the read scaling at our projected scale.
- Eventual consistency would force UI rework throughout (loading spinners
  after every action waiting for read model to catch up).
- Operational overhead of running two database systems.
- 16-week launch budget can't absorb the learning curve.

## Trade-off Analysis

The fundamental trade-off is **write amplification (one extra row per
state change) versus audit-trail and explainability**. For a compliance
product, the audit-trail and explainability sides are *the product* —
not nice-to-haves. The write cost at our scale (≤10k practices, each
generating perhaps 1–10 events/day during active use) is negligible
(≈100k–1M event rows/day, well within Postgres on Cloud SQL).

The choice between Option C (ES without CQRS) and Option D (full ES + CQRS)
is operational complexity. CQRS pays off when reads vastly outscale writes
or when read models need wildly different shapes. Neither applies to us —
the dashboard's read pattern is "give me the projection rows for *this*
practice," which Postgres handles trivially with `practiceId` indexes.
We can adopt CQRS later if a specific read pattern needs it; in the
meantime the projection-tables-alongside-events approach gives us 80%
of the benefit with 20% of the operational cost.

## Consequences

### What becomes easier
- "Show me everything that happened with policy X over the last 90 days"
  is one query against `EventLog`.
- Compliance score regressions are explainable: diff the events between
  two snapshots and you have the cause.
- New analytics dashboards (e.g., admin Customer Health) become event
  subscribers, no schema change needed.
- AI Concierge context: "the user just acknowledged policy X" is an event
  the assistant can naturally subscribe to.
- Replaying events lets us rebuild any projection table from scratch — a
  free disaster-recovery mechanism and a clean schema-migration path.
- OCR / SOC 2 audit story is dramatically stronger.

### What becomes harder
- Every server action must use the `appendEventAndApply()` helper.
  Skipping it (e.g., directly calling `db.policyAcknowledgment.create()`)
  is a footgun. Mitigated by:
  - Lint rule forbidding direct `db.<projection>.create/update` outside
    the events module.
  - Code review checklist.
  - Onboarding pairing for the first PR each new contributor writes.
- Event schema migrations require thought. We use `schemaVersion` per
  event type and `eventReducers[type][version]` lookup so old events
  remain replayable forever.
- Storage growth — `EventLog` grows monotonically. Plan to partition by
  `createdAt` quarterly once the table exceeds ~50M rows.
- Synchronous projection updates inside the event write transaction add
  latency to write paths. Acceptable for compliance ops which are
  user-initiated and not high-frequency. Async projections (e.g., AI
  summaries, benchmarks) handled separately via Upstash queues.

### What we'll need to revisit
- **At ~50M event rows:** introduce table partitioning and consider
  archival of events older than 7 years (HIPAA retention).
- **If a specific read pattern outgrows Postgres:** introduce a CQRS
  read model for that surface only (don't over-generalize).
- **At 5+ engineers:** consider a stricter typed event bus library
  (e.g., Inngest, Trigger.dev) to enforce subscription patterns.

## Action items

- [ ] Implement `EventLog` Prisma model in `prisma/schema.prisma`
- [ ] Implement `appendEventAndApply<T>()` helper in
  `src/lib/events/append.ts` with full typed event registry
- [ ] Implement `replayPracticeEvents(practiceId, since?)` for projection
  rebuilds
- [ ] First event types: `PRACTICE_CREATED`, `USER_INVITED`,
  `POLICY_ACKNOWLEDGED`, `TRAINING_COMPLETED` (drives weeks-1–2 schema)
- [ ] Add ESLint rule `no-direct-projection-mutation` blocking direct
  Prisma writes to projection tables outside `src/lib/events/`
- [ ] Document the pattern in `docs/patterns/event-sourcing.md` with
  code examples (after second event type ships, so the doc reflects
  real usage)
