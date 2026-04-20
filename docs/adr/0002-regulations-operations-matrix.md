# ADR-0002: Regulations × Operations matrix as the conceptual model

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Noorros (founder/owner), Engineering
**Related:** [ADR-0001 — Event sourcing](0001-event-sourcing.md), [ADR-0004 — Modules as data](0004-modules-as-data.md)

## Context

v1 has a sidebar with a single flat list called "modules" that mixes two
fundamentally different concepts:

- **Regulatory frameworks** (external mandates from HHS / OSHA / DEA / CMS /
  states): HIPAA, OSHA, OIG, CMS, DEA, CLIA, MACRA, TCPA, USP 797, plus 50
  state overlays.
- **Operations programs** (internal programs that produce evidence of
  compliance): Policies, Training, Incidents, Credentials, Vendors, Risk
  Assessment, Sanctions, Document Retention.

Lumping these as siblings causes real product damage observed live:

1. **The user has to navigate ≥4 surfaces to answer "is my training
   compliant?"** because each regulatory module has its own training stat
   (HIPAA training, OSHA training, OIG training…). The Training module
   itself shows a different, fourth view.
2. **Each module reinvents the same checklist UI.** v1 has 14 module pages
   and roughly 60% of the code in each one is the same checklist with
   slightly different items. Maintenance and a11y multiply per copy.
3. **State law is bolted on.** v1 surfaces state items as a footer
   section *below* federal HIPAA/OSHA/DEA — invisible until you scroll,
   confusing because the federal-vs-state distinction is regulatory, not
   structural.
4. **Adding a new regulatory framework (e.g., OSHA WPV for Healthcare,
   FTC Health Breach Notification Rule) requires duplicating an existing
   module page** — the architecture pushes against the regulatory
   landscape's known continuous flux.

## Decision

Reorganize around a **two-axis model**:

```
                        REGULATIONS (external mandates)
                  ┌─────────────────────────────────────────┐
                  │ HIPAA  OSHA  OIG  CMS  DEA  CLIA  …    │
   OPERATIONS    ├─────────────────────────────────────────┤
   (evidence    │P│   ✓    ✓    ✓                  ✓     │
   programs)    │T│   ✓    ✓    ✓    ✓    ✓               │
                │I│   ✓    ✓                              │
                │C│             ✓    ✓    ✓               │
                │V│   ✓                                   │
                │R│   ✓                                   │
                │S│   ✓                                   │
                │D│   ✓                                   │
                  └─────────────────────────────────────────┘
                  (Cells = evidence type X satisfies regulation Y)
```

The sidebar reorganizes into three sections:

1. **My Compliance** (regulations) — HIPAA, OSHA, OIG, CMS, DEA, CLIA,
   MACRA, TCPA, Allergy/USP 797, State Law (consolidated). Each is a
   "show me my status against this regulator" view. The page pulls from
   the matrix to show "for HIPAA, here's what each operations program
   contributes."
2. **My Programs** (operations) — Policies, Training, Incidents,
   Credentials, Vendors, Risk Assessments, Sanctions, Documents. Each
   is "manage this evidence category, see what regulations it satisfies."
3. **Audit & Insights** — Compliance Score (predictive), Audit Prep,
   Activity Log, Reports, Regulatory Updates, AI Concierge.

The data model reflects this: a `RegulatoryRequirement` row links a
`RegulatoryFramework` to one or more `EvidenceType`s. A `ComplianceItem`
(the unified replacement for v1's per-module checklist tables) belongs to
both a framework and an evidence type.

## Options Considered

### Option A: Keep v1's flat module list (status quo)

**Pros:** Familiar, no migration. **Cons:** All four problems above
persist. v2 is supposed to fix this.

### Option B: Operations-only navigation (programs are the only sidebar)

**Pros:** Reduces to ~8 sidebar items. **Cons:** Auditors and customers
both think in terms of regulations ("show me my HIPAA program"). Hiding
that view would be a usability regression.

### Option C: Regulations-only navigation

**Pros:** Maps to the auditor mental model. **Cons:** The day-to-day
work (managing policies, completing training, logging incidents) is
operational, not regulatory. Forcing every operational task through a
regulatory lens makes the daily flow worse.

### Option D: Two-axis matrix, both navigations available (chosen)

**Pros:**
- Daily operational work has a clean home (My Programs).
- Audit-readiness has a clean home (My Compliance).
- The "for HIPAA, what's my evidence look like?" view aggregates
  automatically because the data is matrixed.
- Adding a new regulation = INSERT into `RegulatoryFramework` and
  `RegulatoryRequirement` rows. No code changes.
- Adding a new evidence type (e.g., "Continuing Education tracking")
  = create the `EvidenceType` and the program page; existing
  regulations pick it up via requirement links.

**Cons:**
- Two-axis navigation means more sidebar items overall (~18 vs ~14 in
  v1). Mitigated by section grouping and progressive disclosure for
  practices with disabled modules.
- Matrix view requires careful design — could become a wall of
  checkboxes if not curated. Mitigated by the
  `<ComplianceMatrix>` component design phase ([ADR-0005 — Design
  System](0005-design-system.md)).

## Trade-off Analysis

The fundamental trade-off is **conceptual fidelity vs. surface-area
simplicity**. Option D adds sidebar entries but each entry has a clear
job, whereas v1's flat module list has cognitively cheap navigation
hiding cognitively expensive comprehension. The matrix model adds rows
to the schema (`RegulatoryRequirement`, `EvidenceType`) but eliminates
14 hardcoded module pages of nearly-identical UI.

## Consequences

### What becomes easier
- Adding a new regulation (e.g., OSHA WPV for Healthcare): INSERT into
  `RegulatoryFramework` + N `RegulatoryRequirement` rows. The "My
  Compliance > OSHA WPV" page renders automatically from the data.
- "If I do X, my HIPAA score goes from 72 → 84" predictions work because
  evidence-type contributions are explicit in the matrix.
- The "This Week" worklist (the Day-1 dashboard centerpiece) ranks items
  across all 14 regulations because it aggregates over `ComplianceItem`
  rows, not over per-module page reads.
- AI Concierge context: "you're on the OSHA module. Your biggest gap is
  BBP Exposure Control Plan, which also satisfies HIPAA Security §164.312
  if approached this way" becomes natural because the matrix relationship
  is queryable.

### What becomes harder
- `<ComplianceItem>` design needs to accommodate items that span multiple
  regulations. Mitigated by treating "primary regulation" as a required
  field and "also satisfies" as a multi-select.
- Mental shift for engineers used to "the HIPAA module owns these items."
  No — items belong to the `ComplianceItem` table; HIPAA is just one
  view of them.

### What we'll need to revisit
- **Sidebar UX after first 50 customers:** if "My Compliance" + "My
  Programs" creates double-navigation friction, consider collapsing
  into a single "Compliance" sidebar with mode-toggle pills.
- **State law structure:** at launch, state law is consolidated under
  one regulatory framework with state-specific requirements. If
  state-specific items grow to dwarf federal counts in any module, may
  need to split.

## Action items

- [ ] Schema: `RegulatoryFramework`, `RegulatoryRequirement`,
  `EvidenceType`, `ComplianceItem` with seed data for 14 frameworks +
  initial requirement set
- [ ] Build `<ComplianceMatrix>` component (depends on [ADR-0005](0005-design-system.md))
- [ ] Build "My Compliance > [Regulation]" page that renders from the
  matrix
- [ ] Build "My Programs > [Operation]" page that lists items grouped
  by regulation
- [ ] Migration script (post-launch) to move v1 customers (none expected
  during v2 build) into the matrix shape
