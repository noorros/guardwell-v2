---
title: Module Page Contract — `/modules/[code]`
status: Draft for review
owners: Noorros (product), Engineering
date: 2026-04-20
related:
  - docs/adr/0002-regulations-operations-matrix.md
  - docs/adr/0004-modules-as-data.md
  - docs/adr/0005-design-system.md
  - docs/plans/weeks-5-6-llm-ops-first-module.md
---

# Module Page Contract — `/modules/[code]`

**Status:** Draft for review
**Owners:** Noorros (product), Engineering
**Related:** [ADR-0002](../adr/0002-regulations-operations-matrix.md), [ADR-0004](../adr/0004-modules-as-data.md), [ADR-0005](../adr/0005-design-system.md), [weeks-5-6 plan](../plans/weeks-5-6-llm-ops-first-module.md)

## Revision history

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Noorros + Engineering | Initial draft. Locks the shell (Sections A–G), acceptance criteria (30), and the 14-framework scope for v2 launch. Open questions O-1 through O-12 awaiting product decisions. |

---

## Purpose

This document locks what every `/modules/[code]` page must render so the single dynamic page template in `src/app/(dashboard)/modules/[code]/page.tsx` cleanly serves all 14 regulatory frameworks (HIPAA, OSHA, OIG, CMS, DEA, CLIA, MACRA, TCPA, Training, Policies, Risk, Incidents, Credentials, Vendors) without per-framework duplication. It fixes v1's core maintenance tax — ~60% of the code in each of 14 module pages was the same checklist UI with slightly different items, and adding a new framework meant cloning a folder. Under ADR-0004 a new framework is now an `INSERT` into `RegulatoryFramework` + N `RegulatoryRequirement` rows; this contract ensures the rendered page is also data-driven, not code-driven. It is the product-side acceptance surface: if every section below renders correctly and every acceptance criterion passes for a given `framework.code`, the module is shipped regardless of the jurisdiction or subject matter.

What this document **is not**: it is not a design mock (pixel layouts, spacing, hex colors live in the `gw/` Storybook), not a sprint-level implementation plan (see `docs/plans/weeks-5-6-llm-ops-first-module.md` and the forthcoming weeks 7-9 plan for tasks and file structure), and not an ADR (it cross-references ADRs but does not override them). Treat it as the contract an engineer reads before touching `modules/[code]/page.tsx` and the checklist a reviewer opens when a new framework seed ships.

---

## Scope — what's "a module" in v2

### Vocabulary

- **Regulatory framework** — a row in `RegulatoryFramework` whose `code` values a URL segment at `/modules/[code]`. Each framework has one or more `RegulatoryRequirement` rows, per-practice activation via `PracticeFramework`, and a computed `scoreCache` that drives the `ScoreRing` in Section A.
- **Regulation (strict sense)** — a framework whose source is an external mandate from a statutory or regulatory authority (HHS, OSHA, DEA, CMS, state legislatures). Example: HIPAA, OSHA, DEA.
- **Operational program** — a framework whose scored items are mostly internal evidence-production KPIs (e.g., "percent of staff with current training," "percent of active policies acknowledged"). Example: Training, Policies.
- **Module page** — the rendered page at `/modules/[framework.code.toLowerCase()]`. Every framework, regulation or operational, renders through the same template.
- **My Compliance** — the left-hand sidebar section that lists every enabled `PracticeFramework` as a navigable link to `/modules/[code]`. Per ADR-0002 this is the regulator's mental model: "show me my status against this framework."
- **My Programs** — the sidebar section that lists operations pages: `/programs/policies`, `/programs/training`, `/programs/incidents`, `/programs/credentials`, `/programs/vendors`, `/programs/risk`, etc. Owns evidence creation, editing, bulk tasks. Not governed by this document.
- **Audit & Insights** — the sidebar section for cross-framework views (overall score, audit prep, activity log, regulatory updates). Not governed by this document.

### Why both regulations and operations render through the same template

The "My Compliance" list shows **both** regulations (strict sense) and operational programs that happen to have a score. Reason: from the user's compliance-posture point of view, "am I current on training?" and "am I current on HIPAA?" are the same question — both want a ring, a list of things to fix, and a way to drill in. The shell (Sections A–F below) serves both identically. What differs is the **Extras slot** (Section G), which is where framework-specific UI lives: HIPAA gets a breach calculator, DEA gets a controlled-substance inventory, Training gets nothing (the Extras slot is empty and the summary band just links the user back to `/programs/training`). This is the only source of variation the template allows. A framework that needs extras it does not have yet renders Section G empty; it never justifies a second page template.

### "Thin" vs "full" module pages

- **Full module page** — strict-sense regulations (HIPAA, OSHA, OIG, CMS, DEA, CLIA, MACRA, TCPA). Requirements list in Section C is the primary workspace; users toggle status there; scores reflect those toggles.
- **Thin module page** — operational programs (Training, Policies, Risk, Incidents, Credentials, Vendors). Requirements list in Section C holds 3–5 program-level KPI requirements (e.g., "All active staff have completed HIPAA training in the last 365 days"). The real management surface lives in `/programs/[name]`. Section C is read-mostly, Section G empty, Sections B/E still render. The page's job is a score + a jump link, not data entry.

Both thin and full pages pass the same acceptance criteria. The only difference is content density.

### The framework is self-describing

The engineer writing `modules/[code]/page.tsx` **never switches on `framework.code`**. Every per-framework decision is data. Specifically:

- **Icon** → `framework.iconKey` (resolved via a small `lucide-react` registry map at `src/lib/icons.ts`; fallback `ShieldCheck`).
- **Category taxonomy** → `framework.metadata.categoryOrder: string[]`; each `requirement.metadata.category: string` must be a member. Requirements whose category is not in `categoryOrder` fall into a trailing "General" bucket.
- **Scoring strategy** → `framework.scoringStrategy`, handled by a registry (per ADR-0004). `STANDARD_CHECKLIST` is the default; the page does not render anything different for other strategies — it only reads `PracticeFramework.scoreCache`.
- **Extras** → looked up by `framework.code` in `MODULE_EXTRAS_REGISTRY`; absence = no extras.
- **State overlay** → `framework.jurisdiction` + per-requirement `jurisdictionFilter[]`.
- **Deadline surface** → `requirement.metadata.deadline` ISO string or linked-evidence dates (open question O-5).
- **Color token** → `framework.colorKey` (for the small icon box behind the framework icon); falls back to `--gw-color-good`.
- **Successor / superseded** → `framework.supersededAt` + `framework.metadata.supersededBy` (a `code` pointing at the new framework).
- **Regulatory update** → `framework.metadata.latestUpdatePublishedAt` (see O-3).

A code smell review before landing: if `page.tsx` imports anything keyed on `framework.code`, the import must be a registry lookup (Extras), not an inline `switch`. Any `if (code === "HIPAA") {…}` in the page file is a merge blocker.

### URL shape and routing

Route: `src/app/(dashboard)/modules/[code]/page.tsx` where `[code]` matches `RegulatoryFramework.code` case-insensitively. The page does `code.toUpperCase()` before the Prisma lookup. Unknown codes call `notFound()` → Next's default 404. The module index lives at `/modules/page.tsx` (not governed here) and lists all `PracticeFramework` rows where `enabled = true`.

### What belongs on the module page vs. elsewhere

| Belongs on module page | Belongs elsewhere |
|---|---|
| Score, status, requirement list for one framework | Overall cross-framework score → `/dashboard` |
| Toggling a requirement `Compliant` / `Gap` / `Not started` | Writing a policy body → `/programs/policies/[id]` |
| Linking an existing piece of evidence to a requirement | Creating evidence from scratch → My Programs |
| Framework-specific widgets (breach calc, 300 log summary) | Full incident-intake wizard → `/programs/incidents/new` |
| Asking the AI about this framework's requirements | Cross-framework AI queries → AI Concierge global |
| Viewing the last 10 status changes | Full audit trail → `/insights/activity` |
| Toggling `CRITICAL` requirements via a keyboard-reachable radio | Bulk-import legacy v1 data → one-off admin script, not the UI |
| Reading a requirement's citation inline | Browsing the regulation text in full → external gov link via `<RegulationCitation href>` |

### Data fetching — what the page reads in one server request

The Next.js server component's data shape is fixed across every framework. A reader of the file can predict every query. In execution order:

1. `getPracticeUser()` → `PracticeUser` + `Practice` (existing, short-circuits to 404 when null).
2. `db.regulatoryFramework.findUnique({ where: { code }, include: { requirements: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } } })` → returns framework + all requirements.
3. `db.practiceFramework.findUnique({ where: { practiceId_frameworkId: {…} } })` → single row with `scoreCache`, `scoreLabel`, `lastScoredAt`. If `null`, the page treats the framework as "Never assessed."
4. `db.complianceItem.findMany({ where: { practiceId, requirementId: { in: requirementIds } } })` → mapped by `requirementId`.
5. `db.eventLog.findMany({ where: { practiceId, type: 'REQUIREMENT_STATUS_UPDATED' }, orderBy: { createdAt: 'desc' }, take: 200 })` → reduced to `Map<requirementId, latestEvent>` for Section E + AI reason indicator. **200 is a window safe for up to 20 requirements with active churn; raise to 500 if any framework crosses 50 requirements.**
6. After framework-scoped events, a second aggregated query for Section E row rendering: same where-clause but `take: 10` — only runs when Section E is rendered (which is always; the `take: 200` already covers this and the page can reuse it).

All five queries run in parallel where data-dependencies allow (2–5 can be `Promise.all`-ed; 1 must precede; 6 reuses 5). No framework-specific query branches exist.

---

## Core principle — Evidence-driven compliance

**Compliance status is a derivation, not a data entry form.** Whenever a user completes a task in My Programs (designates an officer, adopts a policy, completes training, files an incident record, logs a BAA), the event that records that task MUST also re-evaluate every `RegulatoryRequirement` whose `acceptedEvidenceTypes` matches — and if the evidence is sufficient, project a `ComplianceItem.status = "COMPLIANT"` in the same transaction as the original event. The user should almost never need to visit `/modules/[code]` and click "Compliant" manually; the status is already there because they did the underlying work elsewhere.

This is the opposite of v1, where the module pages were where compliance got *entered* (and then frequently diverged from whatever operational state the rest of the app actually had). In v2, module pages are where compliance gets *displayed* and *overridden*. The manual radios on Section C are the escape hatch (for auditor overrides, one-off exceptions, "I did this offline"), not the primary path.

### How it works mechanically

1. **Each requirement lists the evidence types that satisfy it.** `RegulatoryRequirement.acceptedEvidenceTypes: String[]` is a field of `EvidenceType.code` values. Example: `HIPAA_PRIVACY_OFFICER` requirement has `acceptedEvidenceTypes = ["OFFICER_DESIGNATION"]`. `HIPAA_POLICIES_AND_PROCEDURES` has `["POLICY:HIPAA_PRIVACY_POLICY", "POLICY:HIPAA_SECURITY_POLICY", "POLICY:HIPAA_BREACH_RESPONSE_POLICY"]` (all three needed).

2. **Every evidence-producing action emits an event.** When the user completes onboarding and checks "I am the Privacy Officer," the server action emits `OFFICER_DESIGNATED` with payload `{ userId, role: "PRIVACY_OFFICER", practiceId }`. When they adopt a policy in `/programs/policies`, the action emits `POLICY_ADOPTED` with `{ policyId, policyCode, practiceId, acknowledgedByUserIds }`. Et cetera.

3. **The projection for each evidence event walks the requirement registry.** Inside `appendEventAndApply`'s projection callback, after the primary write (creating the PracticeUser officer row, the Policy row, etc.), a helper `rederiveRequirementStatus(tx, practiceId, evidenceTypeCode)` runs:
   - `SELECT * FROM RegulatoryRequirement WHERE acceptedEvidenceTypes CONTAINS evidenceTypeCode`
   - For each hit, check if the practice has enough evidence to satisfy (count of adopted policies of the required codes ≥ required; existence of at least one active officer of the right role; etc. — logic specific to the evidence type)
   - If yes, upsert `ComplianceItem.status = "COMPLIANT"` with `source = "DERIVED"` and a reason like `"Auto-satisfied by adopted policy: HIPAA Privacy Policy"`
   - If the current status is `COMPLIANT` with `source = "USER"`, do NOT downgrade (same guard as AI): user overrides win.

4. **The module page's Section C surfaces where the evidence came from.** A `ComplianceItem` with `source = "DERIVED"` renders an `<EvidenceBadge>` in the row (weeks 9-10 wiring) showing "Satisfied by HIPAA Privacy Policy" with a link to `/programs/policies/hipaa-privacy-policy`. Clicking the evidence takes the user to the operational page that produced it. The loop closes.

5. **Removal of evidence re-derives too.** If a policy is retired (`POLICY_RETIRED` event), the projection re-runs the derivation and may downgrade `ComplianceItem.status` from `COMPLIANT` back to `GAP` (unless the user has manually asserted `source = "USER"` COMPLIANT — same "user override wins" rule).

### What each of the 10 current HIPAA requirements will derive from (once the My Programs pages exist)

| Requirement code | Derived from | My Programs surface |
|---|---|---|
| `HIPAA_PRIVACY_OFFICER` | Existence of active `PracticeUser.isPrivacyOfficer=true` | Onboarding / `/programs/staff` |
| `HIPAA_SECURITY_OFFICER` | Existence of active `PracticeUser.isSecurityOfficer=true` | Onboarding / `/programs/staff` |
| `HIPAA_SRA` | At least one completed `SRA_ANSWER_RECORDED` chain resulting in an SRA report in the last 12 months | `/programs/risk` (SRA questionnaire) |
| `HIPAA_POLICIES_AND_PROCEDURES` | All required HIPAA policies adopted (P&P set defined by the framework) | `/programs/policies` |
| `HIPAA_WORKFORCE_TRAINING` | ≥ 95% of active `PracticeUser` have current `TRAINING_COMPLETED` for the HIPAA-Basics track | `/programs/training` |
| `HIPAA_BAA` | ≥ 1 active `BAA_EXECUTED` per vendor that processes PHI | `/programs/vendors` |
| `HIPAA_MINIMUM_NECESSARY` | Existence of an adopted minimum-necessary policy + no open related incidents | `/programs/policies` + `/programs/incidents` |
| `HIPAA_NPP` | Adopted NPP policy + attestation it's posted/distributed | `/programs/policies` |
| `HIPAA_BREACH_RESPONSE` | Adopted breach-response policy + no unresolved breach incidents | `/programs/policies` + `/programs/incidents` |
| `HIPAA_WORKSTATION_USE` | Adopted workstation policy + acknowledgment from ≥ 95% of workforce | `/programs/policies` |

Every row above is a derivation rule that will live in `src/lib/compliance/derivation/hipaa.ts` (or similar). Each rule is pure: given current Prisma state for a practice, returns `COMPLIANT | GAP | IN_PROGRESS | NOT_STARTED`. The projections call into these.

### Consequences

- **Section C on the module page becomes read-dominant** for users who are doing the work in My Programs. Fewer clicks, less manual data entry, fewer drift bugs.
- **Operational pages (My Programs) must emit well-formed events** for every state change. This is enforced by the same `appendEventAndApply` + `no-direct-projection-mutation` pair we already have. A policy that's written but not committed through the event path doesn't satisfy anything.
- **A new regulation's seed script declares its derivation rules** by listing `acceptedEvidenceTypes` per requirement. The page doesn't need to know. OSHA gets added as a row; when an OSHA policy is adopted, that policy's event fires, derivation runs, and the OSHA page lights up.
- **"Source" on `ComplianceItem` becomes the audit signal**: `DERIVED | USER | AI_ASSESSMENT | IMPORT`. UI shows a small chip so auditors see at a glance which rows came from evidence vs were manually asserted.

### What this doesn't fix

- Requirements with no clean evidence mapping (e.g., "Conduct an annual review of policies") still need either a questionnaire-driven event (from the SRA-like surface) or a user attestation. Those stay manual-by-design, with a `LAST_REVIEWED` attestation event as the satisfying evidence.
- State-specific rules layered on a federal framework (e.g., CA HIPAA variants) still need the `jurisdictionFilter` resolution at query time — derivation happens per requirement as surfaced, not per abstract rule.

---

## The shell — common across all 14 frameworks

Every `/modules/[code]` page renders, in order:

```
┌─────────────────────────────────────────────────────────┐
│ A. Header bar             (ModuleHeader)                │
├─────────────────────────────────────────────────────────┤
│ B. Summary band           (3 KPIs + filters)            │
├─────────────────────────────────────────────────────────┤
│ C. Requirements list      (ChecklistItem + grouping)    │
├─────────────────────────────────────────────────────────┤
│ D. Evidence panel         (EvidenceBadge grid + CTA)    │
├─────────────────────────────────────────────────────────┤
│ E. Activity feed          (last 10 status events)       │
├─────────────────────────────────────────────────────────┤
│ F. AI Assist              (AiAssistTrigger → Drawer)    │
├─────────────────────────────────────────────────────────┤
│ G. Extras slot            (per-framework registry)      │
└─────────────────────────────────────────────────────────┘
```

Section F is physically a button + a slide-over drawer, not a block of real estate — it is rendered inline with Section A's actions row on desktop and stays reachable on all viewport sizes.

### Section A — Header bar

- **Purpose:** identify the framework and current status at a glance.
- **Required data:**
  - `RegulatoryFramework`: `id`, `code`, `name`, `shortName`, `citation`, `iconKey`, `jurisdiction`, `effectiveAt`, `supersededAt`, `weightDefault`, `colorKey`
  - `PracticeFramework`: `scoreCache`, `scoreLabel`, `lastScoredAt`
  - `Practice`: `name`, `primaryState`, `operatingStates`
- **Content:**
  - Framework icon resolved from `framework.iconKey` via the `lucide-react` icon registry (`ShieldCheck` is the HIPAA default from `seed-hipaa.ts`).
  - `h1` = `framework.name`. Secondary subtitle row uses `framework.shortName` in small caps when `shortName !== name`.
  - `RegulationCitation` below the name, rendering `framework.citation` (e.g., "45 CFR Parts 160, 162, and 164"). Hover link to authoritative source when the framework has one (federal regs → eCFR deep-links).
  - `ScoreRing` on the right, sized 72px, fed `scoreCache` (defaulted to 0 when null → see "Never assessed" state). Below the ring, `scoreLabel` as a `Badge`.
  - Jurisdiction badges: one per `framework.jurisdiction` (e.g., "federal"). When `framework.jurisdiction === "federal"` and `Practice.primaryState` appears in a known per-state overlay for this framework, a second badge reads "+ CA overlay" (open question O-4). When `framework.jurisdiction.startsWith("state-")` and the practice's `primaryState` matches, a green `Badge` reads "applies to your state" using `--gw-color-compliant`.
  - "Assessed 3 days ago" relative timestamp. Source: `PracticeFramework.lastScoredAt`. Format uses `Intl.RelativeTimeFormat`, hover reveals absolute timestamp via `<time dateTime={iso}>` + tooltip.
- **Component:** `<ModuleHeader>` at `src/components/gw/ModuleHeader/`. The current implementation (as of week 4) accepts `{ icon, name, citation, citationHref, score, jurisdictions, className }`. **Gap:** `lastScoredAt`, `scoreLabel`, and `shortName` are not yet props. To be added:
  ```ts
  interface ModuleHeaderProps {
    icon: LucideIcon;
    name: string;
    shortName?: string;
    citation?: string;
    citationHref?: string;
    score?: number;               // 0–100, undefined = never assessed
    scoreLabel?: string;          // from PracticeFramework.scoreLabel
    jurisdictions?: string[];
    assessedAt?: Date | null;     // undefined = never, null = never
    staleAfterDays?: number;      // default 90
    stateAppliesTo?: string | null; // ISO state code when overlay matches
    className?: string;
  }
  ```
- **States:**
  - *Loading* — skeleton shimmer: rounded 96px icon box, two text-bar placeholders, a gray 72px ring. Served via `loading.tsx` at the route level.
  - *Never assessed* — `scoreCache === null` and no `lastScoredAt`: ScoreRing renders the `—` character centered, label reads "Not assessed yet," no stale badge. The page still renders Sections B–G with their own empty states.
  - *Stale* — `Date.now() - lastScoredAt > staleAfterDays * 24h` (default 90 days): an amber `Badge` with text "Stale" sits next to the relative timestamp. Tooltip: "Last assessed 104 days ago. Status may be out of date."
  - *Superseded* — `framework.supersededAt <= now`: a gray disabled badge "Superseded on {date}" appears; Sections C–G render read-only. Primary call-to-action becomes "See successor: {link}" when the replacement framework is known via `framework.metadata.supersededBy`.
  - *Error* — framework query threw: fall through to `notFound()` → 404.
- **A11y:**
  - `<h1>` = `framework.name`. Exactly one h1 per page.
  - ScoreRing's `aria-labelledby` points to an inline `<title>` element that reads "`{framework.shortName || framework.name}` compliance score: `{n}` out of 100, `{scoreLabel}`" (already the pattern in `src/components/gw/ScoreRing/index.tsx`).
  - Icon has `aria-hidden="true"` (already in `ModuleHeader`).
  - Jurisdiction badges are text-first; never communicate meaning by color alone.
  - Relative timestamp is wrapped in `<time dateTime={iso}>` so screen readers can read the absolute form.
- **Responsive:**
  - Desktop (≥1024px): icon + text left, score ring right, actions row (AI trigger, future Extras quick-links) below the text, all inside one header card.
  - Tablet (640–1023px): same layout, smaller ring (64px).
  - Mobile (<640px): icon stacks above the `<h1>`; ring sits at the top-right corner of the card; actions row wraps below. Jurisdiction badges wrap to a second line when the name is long.
  - Maximum content width: 768px (matches the page's current `max-w-4xl`). Wider viewports add side gutters, not more horizontal content.

### Section B — Summary band

- **Purpose:** a 3-KPI scan showing the user "what's the shape of this framework's compliance today" and letting them filter Section C with one click.
- **Required data:**
  - All `ComplianceItem` rows for this `(practiceId, frameworkId)` pair.
  - Derived counts:
    - `compliantCount` = items where `status === "COMPLIANT"`
    - `gapCount` = items where `status === "GAP"`
    - `notStartedCount` = items where `status === "NOT_STARTED"` (includes never-created rows, which are treated as `NOT_STARTED` per the existing `ciStatusToChecklist` coercion)
    - `inProgressCount` = items where `status === "IN_PROGRESS"`
    - `notApplicableCount` = items where `status === "NOT_APPLICABLE"`
  - A deadline scan: requirements that imply a deadline (via `metadata.deadline` ISO date on the requirement, or linked evidence with a renewal date — open question O-5) where the deadline is ≤ 30 days away.
- **Content (three pills in a horizontal row):**
  1. **"{X} of {Y} compliant"** — primary. Clicking filters Section C to `status === "COMPLIANT"` items. `Y` = total requirements visible to this practice (post-`jurisdictionFilter`).
  2. **"{N} deadlines this month"** — renders only when N > 0. Uses `<DeadlineWarning>`'s severity colors when N > 0 within 7 days.
  3. **"{M} open gaps"** — sum of `gapCount + notStartedCount`. Clicking filters Section C to those two statuses.
- **Component:** new, to be built. Proposed API:
  ```ts
  interface SummaryBandProps {
    compliant: number;
    total: number;
    upcomingDeadlines: number;
    openGaps: number;
    onFilterChange: (filter: "all" | "compliant" | "gap" | "upcoming") => void;
    activeFilter: "all" | "compliant" | "gap" | "upcoming";
  }
  ```
  Lives at `src/components/gw/ModuleSummaryBand/index.tsx`.
- **States:**
  - *Loading* — three gray skeleton pills.
  - *Empty framework* — zero requirements defined for this framework at all (should not happen in production; is a seed bug): render nothing; the page reads "No requirements published for this framework yet" in Section C.
  - *Zero gaps, zero deadlines* — render the Compliant pill in green and hide the other two.
  - *Filter active* — active pill has a solid fill using the token for its semantic color; inactive pills are outline. An "X clear filter" control appears in Section C's header when a filter is active.
  - *Error* — if the counts aggregate query throws, suppress the band (render nothing) rather than erroring the whole page; log to the server console.
- **A11y:**
  - Each pill is a `<button>` with an explicit `aria-pressed` state.
  - Keyboard: the three pills are in a single tab stop (`role="tablist"` with `role="tab"` pills — arrow-key nav). Enter or Space activates; `aria-controls` points at Section C's list id.
  - Counts are announced by screen readers as a full sentence, not just the number: `aria-label="7 of 10 requirements compliant"`.
  - Color is never the only signal: each pill has its text label plus an icon (`CircleCheck`, `Clock`, `AlertTriangle`).

### Section C — Requirements list

- **Purpose:** the primary workspace of the page. The user sees every `RegulatoryRequirement` that applies to this `(practice, framework)` pair and can set the status for each.
- **Required data:**
  - `framework.requirements`, ordered by `sortOrder ASC, code ASC` (secondary sort pins rows when `sortOrder` ties).
  - For each requirement, the matching `ComplianceItem` (if any) indexed by `requirementId`.
  - For each requirement, the latest `EventLog` row where `type === "REQUIREMENT_STATUS_UPDATED"` and `payload.requirementId === requirement.id`, used to surface `source` and `reason` on the `AiReasonIndicator`.
  - `jurisdictionFilter` gating: a requirement renders only when `requirement.jurisdictionFilter` is empty (applies everywhere) or contains `practice.primaryState` or any of `practice.operatingStates`.
- **Content:**
  - Section heading `<h2>` "Requirements" with a trailing gray count: "({N})".
  - If the framework defines a category taxonomy (HIPAA → Administrative / Physical / Technical; OSHA → General / Healthcare-specific), render a `<h3>` per category with requirements grouped under it. Categories live on `RegulatoryRequirement.metadata.category` (string). Ordering: categories defined by `framework.metadata.categoryOrder` string array, or alpha if absent.
  - When no category is present, render a flat list.
  - Each row uses `<ChecklistItemServer>` which wraps `<ChecklistItem>` with a server-action handler. Today's shape at `src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx` is correct. Each row shows:
    - **Title** — `requirement.title`.
    - **Description chip** — `requirement.citation` (tabular-nums, monospace) as a secondary line.
    - **Severity pill** when `requirement.severity === "CRITICAL"` — solid red; hidden for `STANDARD`; italic "Optional" for `OPTIONAL`.
    - **Source chip** — small badge reading `AI`, `User`, or `Import` based on `EventLog.payload.source` for this requirement's most recent status event. Empty when the item has never been touched.
    - **AI reason popover** — `<AiReasonIndicator>` at `src/components/gw/ChecklistItem/AiReasonIndicator.tsx`. Renders only when `source === "AI_ASSESSMENT" && reason.trim() !== ""`.
    - **Status control** — three radio options: `Compliant`, `Gap`, `Not started`. Exclusive (fixes v1's OIG bug). When `status === "IN_PROGRESS"` or `"NOT_APPLICABLE"`, the control shows a disabled "In progress" / "N/A" outline and opens an overflow menu for admin overrides (handled by `ComplianceItem.overrideStatus`).
    - **Expand affordance** — clicking the title row (not the radios) toggles an expanded view showing `requirement.description` in full (multi-line), the list of `acceptedEvidenceTypes` as `<EvidenceBadge>` chips, and a "Why this matters" paragraph (open question O-2: markdown or plain-text).
- **Component:** `<ChecklistItem>` (exists) + `<ChecklistItemServer>` (exists) + `<AiReasonIndicator>` (exists). A new `<RequirementRow>` wrapper is needed to host the title, citation, severity, source chip, and expanded panel; the existing `<ChecklistItemServer>` currently wraps only the radios + AiReasonIndicator. Proposed API:
  ```ts
  interface RequirementRowProps {
    requirement: {
      id: string;
      code: string;
      title: string;
      description: string;
      citation: string | null;
      severity: "STANDARD" | "CRITICAL" | "OPTIONAL";
      acceptedEvidenceTypes: string[];
      metadata?: Record<string, unknown>;
    };
    complianceItem: ComplianceItem | null;
    lastEvent: { source: "USER" | "AI_ASSESSMENT" | "IMPORT" | null; reason: string | null } | null;
    onStatusChange: ChecklistItemProps["onStatusChange"];
    disabled?: boolean;
  }
  ```
  Lives at `src/components/gw/RequirementRow/index.tsx`.
- **States:**
  - *Loading* — skeleton list of 5–10 rows, same height as real rows to avoid layout shift.
  - *Empty* — zero requirements match the jurisdiction filter: `<EmptyState icon={MapPin} title="Nothing to show for your state" description="This framework has {N} federal requirements and {M} state-specific requirements; none of them apply to {state}." action={...}}/>`. Action optional (see O-4).
  - *Filter active* (via Section B) — subset rendered; "Showing {X} of {Y} — clear filter" link above the list.
  - *Never started at all* — all items are `NOT_STARTED` (no `ComplianceItem` rows exist yet): render all items with their radios enabled; zero-state annotation at the top: "Start by marking what your practice already does today."
  - *Mid-update* — the clicked radio shows the optimistic next status; `disabled` propagates from the `useTransition` pending state; a network failure snaps back to the previous status (already implemented in `ChecklistItemServer`).
  - *Offline* — status writes queue via the server action's optimistic UI; the action throws if offline → snap back + toast "No connection. Try again when you're back online." (requires adding a client-side toast; see O-6).
  - *Error* — database query fails in the page: error boundary displays a full-page `<EmptyState>` with the server-side error message redacted.
  - *Read-only* — `PracticeUser.role === "VIEWER"`: radios render with `disabled` + tooltip "Viewers can't change status."
- **A11y:**
  - `<h2>` "Requirements" identifies the section.
  - Category `<h3>`s are contiguous in DOM order (no out-of-sequence headings).
  - Each row's status control is a `<fieldset>` with `<legend>` = `requirement.title` or `aria-label` equivalent; radios are a native `radiogroup` (already implemented).
  - Expand affordance: `aria-expanded` + `aria-controls` on the clickable title.
  - Keyboard: `Tab` stops are (title/expand) → (radio group) → (AI reason button if present) → next row.
  - Severity is conveyed by the label text `Critical` / `Optional`, not just color.
  - Every icon-only button in the row has `aria-label`.

### Section D — Evidence panel

- **Purpose:** per ADR-0002, the matrix cell: "for this framework, what evidence satisfies each requirement?" Users see what's linked today and can add more.
- **Required data:**
  - The set of `EvidenceType` rows referenced by this framework's requirements (union of all `requirement.acceptedEvidenceTypes` string codes, joined against `EvidenceType.code`).
  - For each evidence type, the count of actual linked evidence rows for this practice (e.g., how many active policies live in `/programs/policies` that satisfy one or more HIPAA requirements). In the weeks 9-10 plan, this count comes from counting evidence rows in the respective program's projection tables (`Policy`, `TrainingCourse`, etc.), filtered to those with `regulatoryRequirementIds` overlapping this framework.
- **Content (weeks 9-10 full version):**
  - A compact grid of `<EvidenceBadge>` chips, one per `EvidenceType` that this framework's requirements accept:
    - Policy (N) → `/programs/policies?framework=HIPAA`
    - Training (M) → `/programs/training?framework=HIPAA`
    - BAAs (K) → `/programs/vendors?framework=HIPAA`
    - … etc.
  - A primary "Link evidence" CTA that opens a picker modal (My Programs picker, out of scope for this document). The modal lets the user pick an existing evidence row and attach it to one or more requirements.
- **Content (weeks 5-6 stub, which is what ships first):**
  - Render `<EmptyState icon={Paperclip} title="No evidence linked yet" description="Evidence lives in My Programs. Start with Policies, Training, or Vendor BAAs — each will appear here as it's added." action={{ label: "Go to My Programs", href: "/programs/policies" }} />`.
  - No picker, no real counts.
- **Component:** `<EvidenceBadge>` at `src/components/gw/EvidenceBadge/` for the chip (exists); `<EmptyState>` for the stub state (exists); `<EvidencePanel>` wrapper at `src/components/gw/EvidencePanel/index.tsx` to be built in weeks 9-10. Proposed API:
  ```ts
  interface EvidencePanelProps {
    acceptedTypes: { code: string; label: string; count: number; href: string }[];
    onLinkEvidence: () => void;       // opens picker modal
    emptyStateAction?: EmptyStateAction;
  }
  ```
- **States:**
  - *Loading* — four gray badge skeletons.
  - *Empty (no program has evidence yet)* — the `EmptyState` stub above.
  - *Partial (some types have evidence, some don't)* — badges show `(0)` for empty types but render them so users see what's possible. Hover tooltip: "No {Training} has been linked to this framework yet."
  - *Error* — suppress the panel (render nothing) and log; the page is still usable.
  - *Read-only* — link CTA disabled with tooltip.
- **A11y:**
  - `<h2>` "Linked evidence" identifies the section.
  - Each badge is a real `<a href>` with `aria-label` that spells out the full count: `"2 policies linked to HIPAA"`.
  - Link CTA is a `<button>` with `aria-haspopup="dialog"` + `aria-controls={dialogId}`.

### Section E — Activity feed

- **Purpose:** show recent state changes against this framework so users can see what shifted their score, who changed it, when, and why.
- **Required data:**
  - The last 10 `EventLog` rows matching `practiceId = pu.practiceId` AND `type = "REQUIREMENT_STATUS_UPDATED"` AND `payload.frameworkCode = framework.code`, ordered `createdAt DESC`.
  - For each event, join `actor` user (`User.firstName`, `User.lastName`, `User.email`) and the `RegulatoryRequirement` pointed to by `payload.requirementId` (for the `requirement.title`).
  - Open question O-1 decides whether other event types (e.g., `PRACTICE_CREATED`, `USER_INVITED`) also appear here or only on the global `/insights/activity` page.
- **Content:**
  - Reverse-chronological list, one row per event.
  - Each row: relative timestamp (hover → absolute), actor name (or "System" when `actorUserId === null`), a one-line description rendered from a per-event-type template:
    - `REQUIREMENT_STATUS_UPDATED`:  "{actor} marked {requirement.title} as {nextStatus}." When `source === "AI_ASSESSMENT"`, append "(AI suggestion)" and show the `<AiReasonIndicator>` button to open the reason popover.
  - "View full history" link at the bottom → `/insights/activity?framework=HIPAA`.
- **Component:** new, to be built. `<ActivityFeed>` at `src/components/gw/ActivityFeed/index.tsx`. Proposed API:
  ```ts
  interface ActivityFeedItem {
    id: string;
    at: Date;
    actorName: string | null;   // null = System
    eventType: EventType;
    payload: Record<string, unknown>;
    requirementTitle?: string;
  }
  interface ActivityFeedProps {
    items: ActivityFeedItem[];
    fullHistoryHref: string;
    renderRow?: (item: ActivityFeedItem) => React.ReactNode;  // override per-type
  }
  ```
- **States:**
  - *Loading* — three gray rows of fixed height.
  - *Empty (no events yet for this framework)* — `<EmptyState icon={Clock} title="No activity yet" description="Requirement changes show up here as you or your team update status." />`.
  - *Partial (fewer than 10 events)* — render what exists; do not pad with placeholders.
  - *Error* — suppress the feed (render nothing) with a silent log; the page is still usable.
  - *Long reason text* — truncate the AI reason in the row to two lines; full text available via the popover.
- **A11y:**
  - `<h2>` "Recent activity" identifies the section.
  - Each row's timestamp is `<time dateTime={iso}>`.
  - Keyboard-reachable reason popover on AI rows; popover uses Radix (existing `Popover`) for focus trapping.

### Section F — AI Assist drawer

- **Purpose:** context-aware help for the current framework. Lets users ask free-form questions ("what does §164.308(a)(3) mean for a small practice?") with the page context pre-populated.
- **Required data:**
  - The drawer needs `pageContext = { route, frameworkCode, frameworkName, practiceId, summary }` where `summary` is a short templated string: `"${framework.name} requirements for ${practice.name}"`. This is already the pattern used at line 102 of `modules/[code]/page.tsx`.
- **Content:**
  - A `<AiAssistTrigger>` button in the header's actions row (next to nothing else for now — the "Run AI assessment" button is hidden per the existing code in `AiAssessmentButton.tsx` that returns `null` at the top of render; see Open Question O-7 on its fate).
  - When opened, the drawer presents a greeting anchored on `summary`, a free-form textarea, and a send button that invokes the `askAiAssistantAction` server action. The response renders in the scrollable body along with an optional `suggestNextAction` link.
  - **No "Run AI assessment" button** on any module page at this stage. It is deliberately hidden because the current prompt produces generic output; re-enabling it requires deciding what AI earns its per-call cost (see open questions).
- **Future AI actions** (not in this document's scope to decide, but reserved):
  - Policy drafting (when a gap maps to an `EvidenceType = POLICY`): "Draft a first version of this policy for me."
  - Breach triage (HIPAA only, via the Extras slot below): "Given these four factors, what's the reportability?"
  - Regulation plain-language: "Explain §164.312(a)(2)(iv) in one sentence."
- **Component:** `<AiAssistDrawer>` at `src/components/gw/AiAssistDrawer/index.tsx` (exists) + `<AiAssistTrigger>` at `src/components/gw/AiAssistDrawer/AiAssistTrigger.tsx` (exists). The `AiAssistPageContext` interface exists and already has `route`, `summary`, `practiceId`. Adding `frameworkCode` and `frameworkName` is a small surface extension:
  ```ts
  interface AiAssistPageContext {
    route: string;
    summary?: string;
    practiceId?: string;
    frameworkCode?: string;
    frameworkName?: string;
  }
  ```
  The server action (`askAiAssistantAction` in `src/components/gw/AiAssistDrawer/actions.ts`) passes these through to the prompt.
- **States:**
  - *Loading (sending a question)* — send button disabled, textarea disabled, button label "Asking…" (already wired).
  - *Empty (no question asked yet)* — greeting plus an example prompt suggestion list ("Try: 'What's the minimum-necessary rule?'").
  - *Error* — drawer renders the error with `--gw-color-risk` text (already wired at line 99 of `AiAssistDrawer/index.tsx`).
  - *Rate-limited* — the drawer surfaces a human-readable error from the server action ("You've used your 50 questions this month. Resets on the 1st.").
  - *PHI detected* — if the question appears to contain PHI and the prompt does not explicitly allow PHI, the drawer renders a warning and does not submit. (Implementation detail for weeks 5-6.)
- **A11y:**
  - Drawer uses Radix `Sheet` which ships `role="dialog"` + focus trapping + Escape to close.
  - Textarea has a visible (or `sr-only`) `<label>`.
  - Send button disables when the textarea is empty or a request is pending.
  - Screen readers announce the assistant's response via an `aria-live="polite"` region on the response container (to be added; currently a passive `<div>`).

### Section G — Extras slot

- **Purpose:** per-framework specialized UI without polluting the shared shell. This is the **only** place where a framework is allowed to differ.
- **Required data:**
  - A typed context object passed to every extras component:
    ```ts
    interface ModuleExtrasContext {
      practiceId: string;
      practice: Pick<Practice, "primaryState" | "operatingStates" | "specialty" | "staffHeadcount" | "entityType">;
      frameworkId: string;
      frameworkCode: string;  // e.g., "HIPAA"
      requirements: RegulatoryRequirement[];
      items: ComplianceItem[];           // indexed by caller
      role: PracticeRole;                // so extras can render read-only for VIEWER
    }
    ```
- **Content:**
  - Registry at `src/components/gw/ModuleExtras/registry.ts`:
    ```ts
    import dynamic from "next/dynamic";
    export const MODULE_EXTRAS_REGISTRY: Record<string, React.ComponentType<ModuleExtrasContext>> = {
      HIPAA: dynamic(() => import("./HipaaExtras")),       // BreachReportableCalculator + NppTemplatePicker
      DEA:   dynamic(() => import("./DeaExtras")),         // ControlledSubstanceInventory
      OSHA:  dynamic(() => import("./OshaExtras")),        // Osha300LogSummary
      OIG:   dynamic(() => import("./OigExtras")),         // ExcludedPersonCheck
    };
    ```
  - The `[code]/page.tsx` looks up `MODULE_EXTRAS_REGISTRY[framework.code]` and, if present, renders it below Section E. If absent, Section G renders nothing (no header, no empty state).
  - Per-framework extras:
    - **HIPAA** → `<BreachReportableCalculator>` (the 4-factor wizard; weeks 7-8) + `<NppTemplatePicker>` (short list of pre-written NPP templates that the user can copy-adapt).
    - **DEA** → `<ControlledSubstanceInventory>` (Schedule-II through V summary counts + last biennial inventory date; weeks 7-8).
    - **OSHA** → `<Osha300LogSummary>` (YTD recordable-incident count by type; summary → deep link to `/programs/incidents?framework=OSHA`).
    - **OIG** → `<ExcludedPersonCheck>` (shows the date of the last OIG LEIE sweep + a "Run sweep now" button; gate to rate-limiter).
  - All other frameworks render nothing in Section G at v2 launch.
- **Component:** the four extras components above are **to be built** in weeks 7-8. This spec locks the API they must conform to; their internal UI is owned by per-framework mini-specs (out of scope here).
- **States:**
  - *Loading* — each extras component renders its own skeleton. Because the registry uses `next/dynamic`, the outer page shows a generic one-block skeleton during hydration; on mount, the extras render their internal states.
  - *Empty / Error* — each extras component owns its own empty and error states. **Contract:** an extras component must never throw to the outer page. Unhandled errors inside extras must render a local `<EmptyState>` with `title="This tool is unavailable"` and must not blank out Sections A–F.
  - *Unregistered* — framework has no registry entry: render nothing. No header, no placeholder, no layout shift.
- **A11y:**
  - Each extras component is a `<section aria-labelledby>` with its own `<h2>` at or below Section F's heading level.
  - Each component must pass axe-core AA on its own Storybook variants before landing.

### Extras component contract (detailed)

Every component in `MODULE_EXTRAS_REGISTRY` must obey these rules. Violations are a merge blocker.

1. **Pure function of context.** The component accepts one prop of type `ModuleExtrasContext` (above). It may fetch additional data server-side but must not read `cookies()` or authentication state — the outer page has already validated the user and bound `practiceId`.
2. **Own error boundary.** The component is wrapped in an error boundary provided by `<ModuleExtrasSlot>`. An uncaught throw inside an extras component degrades that one section to an `<EmptyState>` with a reload affordance; Sections A–F keep rendering.
3. **Suspense-friendly.** The component is loaded via `next/dynamic` with SSR enabled by default. If the component needs streaming (e.g., a long-running OIG sweep), it wraps its body in `<Suspense fallback={<ExtrasSkeleton />}>`.
4. **No toast / no global state.** Extras emit events or call server actions, but never dispatch to app-level state. This keeps Sections A–F independent; re-rendering an extras action must not force Section C to re-render.
5. **No reach-through.** An extras component does not read or mutate `ComplianceItem` rows for **other** frameworks, does not import anything from `src/app/(dashboard)/modules/[code]/page.tsx`, and does not depend on the parent component's props shape beyond `ModuleExtrasContext`.
6. **Per-component acceptance.** Each extras component has its own Storybook story + axe test + unit test + integration test hitting its server actions. Same bar as `gw/` primitives.
7. **Code-split.** The component is reachable only through dynamic import from the registry. The page's base bundle does not contain any extras code.
8. **Citation discipline.** Anything an extras component asserts about a regulatory obligation must be accompanied by a `<RegulationCitation>` with the relevant citation (e.g., breach calculator → `45 CFR §164.402`). Boilerplate marketing copy is not allowed.

### Sketches of the four launch-target extras

Implementation lives in weeks 7–8; below is the minimal contract each must meet.

- **`<HipaaBreachReportableCalculator>`** — four radio groups (nature/type of PHI, unauthorized recipient, whether PHI was actually acquired or viewed, mitigation extent) → rendered score → verdict string ("Reportable breach" / "Low probability of compromise") + deadline clock. Writes a `BREACH_ASSESSMENT_RECORDED` event (new event type; registration in `src/lib/events/registry.ts` required before ship). Does not write compliance-item status; the result is referenced from `/programs/incidents/[id]`.
- **`<HipaaNppTemplatePicker>`** — short list of pre-written NPP template titles; each picks a Markdown body into a clipboard copy. Client-side only; no write.
- **`<OshaOsha300LogSummary>`** — pulls the YTD recordable-incident counts from the Incidents projection table, bucketed by category. Three small KPI cards. Link-out to `/programs/incidents?framework=OSHA`.
- **`<OigExcludedPersonCheck>`** — surfaces the date of the last OIG LEIE sweep + a "Run sweep now" button rate-limited to 1/24h/practice (reuses the existing Upstash rate-limiter at `src/lib/ai/rateLimit.ts`). The sweep itself is a server action reading from the OIG LEIE CSV; writes a `SANCTION_SWEEP_COMPLETED` event.
- **`<DeaControlledSubstanceInventory>`** — three KPI cards: active registration, days since last biennial inventory, Schedule-II record gaps in the last 90 days. All read-only.

---

## States matrix

| Section | Loading | Empty | Partial | Error | Offline / read-only |
|---|---|---|---|---|---|
| **A Header** | Skeleton (icon, two text bars, ring) | Ring shows `—` + "Not assessed yet" | n/a (header is atomic) | `notFound()` for unknown code; otherwise render with placeholder name | Read-only shows a gray "Viewer" chip next to actor state |
| **B Summary band** | 3 gray pills | Hidden when framework has zero requirements | Renders with zero-value pills greyed | Suppress (render nothing), log | Hidden when offline (no filter state persists) |
| **C Requirements** | Skeleton rows of fixed height | `<EmptyState>` when `jurisdictionFilter` excludes all | Filter-subset with "clear filter" link | Error boundary → full-page `<EmptyState>` with retry | Radios disabled + tooltip for VIEWER; optimistic updates queue with snap-back on action throw |
| **D Evidence** | 4 badge skeletons | Stub (`"No evidence linked yet"`) weeks 5–6; real empty state weeks 9–10 | Badges with `(0)` counts where no evidence yet | Suppress | Link CTA disabled for VIEWER |
| **E Activity feed** | 3 row skeletons | `<EmptyState>` "No activity yet" | Render what exists; no padding | Suppress | Reads fine offline from server render; live updates not required |
| **F AI Assist** | Send button disabled while pending | Greeting + example prompts | n/a | Inline error in drawer body | Drawer disabled if `NEXT_PUBLIC_AI_ENABLED === "false"`; tooltip on trigger |
| **G Extras** | Per-component skeleton | Per-component empty state | Per-component | Must not bubble; local `<EmptyState>` | Per-component |

Layout shift (CLS) budget: every section reserves its minimum height via the skeleton so that hydration does not move content. Header: 120px. Summary band: 48px. Requirements: 72px per row × {N} rows, {N} read server-side. Evidence: 64px. Activity feed: 56px per row × 3 minimum. Extras: component-defined.

### Category taxonomy by framework

The categories a framework publishes (if any) live in its seed script as `framework.metadata.categoryOrder: string[]`. The list below is the v2-launch default; deviations require a call-out in the framework's seed PR.

| `code` | Categories (in order) | Notes |
|---|---|---|
| `HIPAA` | Administrative Safeguards / Physical Safeguards / Technical Safeguards / Privacy / Breach Notification | Taken from 45 CFR §164 structure. 5 buckets handle all ~20 requirements. |
| `OSHA` | General Industry / Healthcare-specific / Bloodborne Pathogens / Hazard Communication / Workplace Violence | "Workplace Violence" bucket is live post-OSHA WPV adoption (2024); a few requirements live there now, count grows. |
| `OIG` | Policies & Procedures / Compliance Officer & Committee / Training & Education / Communication / Monitoring & Auditing / Response & Prevention / Enforcement & Discipline | The OIG 7-element model, one bucket per element. |
| `CMS` | Conditions of Participation / Conditions of Coverage / Quality Reporting | Only COP + COC meaningfully populated at launch. |
| `DEA` | Registration / Schedule II / Schedules III–V / Recordkeeping / Inventory / Disposal | `requirement.metadata.schedule` filters within buckets. |
| `CLIA` | Certificate Type / Personnel / Quality Control / Proficiency Testing | `Practice.specialty` hints at certificate type but the definitive selector is `metadata.certificateType` on the practice's CLIA profile (separate model, weeks 7–9). |
| `MACRA` | Quality / Promoting Interoperability / Improvement Activities / Cost | MIPS four pillars. |
| `TCPA` | Consent / Do-Not-Call / Record Retention | 4 requirements = one-or-two per bucket; grouping is low-value but keeps the shell consistent. |
| `TRAINING` | (none) | Thin; flat list. |
| `POLICIES` | (none) | Thin; flat list. |
| `RISK` | (none) | Thin; flat list. |
| `INCIDENTS` | (none) | Thin; flat list. |
| `CREDENTIALS` | (none) | Thin; flat list. |
| `VENDORS` | (none) | Thin; flat list. |

---

## Acceptance criteria

A module page meets this contract when **all** of the following pass for a given `framework.code`:

1. **Shape** — the page renders Sections A, B, C, E, F in order. Section D renders in its weeks-5-6 stub or weeks-9-10 form per the milestone. Section G renders an extras component when registered or nothing when not.
2. **No layout shift on reload** — Cumulative Layout Shift ≤ 0.02 on reload against a warm cache, measured by the Chromium Lighthouse run in CI. Skeletons of fixed height in every section.
3. **a11y baseline (WCAG 2.2 AA)** — axe-core reports **zero** violations at AA against the design-system gallery and against `/modules/HIPAA` rendered for a seeded practice. Includes contrast, focus-visible, heading hierarchy, form labels, `role`/`name`/`state` on all interactive elements.
4. **Heading hierarchy** — exactly one `<h1>` (framework name), `<h2>` per major section ("Requirements," "Linked evidence," "Recent activity," extras titles), `<h3>` per category sub-grouping within Requirements. No gaps.
5. **Keyboard navigation** — all interactive elements reachable via `Tab` in visual order. `Shift+Tab` reverses. No keyboard trap outside of the AI drawer dialog. Radio groups respond to arrow keys. Popovers (AI reason) open via Enter/Space and close via Escape.
6. **Score-ring truth** — `ScoreRing` reflects `PracticeFramework.scoreCache` and recomputes transactionally on every `REQUIREMENT_STATUS_UPDATED` event (per the existing `projectRequirementStatusUpdated` pattern). A hard refresh after a status toggle shows the updated ring.
7. **AI reason gating** — `<AiReasonIndicator>` renders **only** when the most recent status-change event has `payload.source === "AI_ASSESSMENT"` **and** `payload.reason` trims to a non-empty string. Human edits never show the indicator.
8. **Source chip gating** — the "AI / User / Import" source chip reflects the most recent event's `payload.source`. When no event exists (item is `NOT_STARTED` by default), the chip does not render.
9. **Severity rendering** — `CRITICAL` requirements show a red pill; `STANDARD` show nothing; `OPTIONAL` show an italic "Optional" label. No color-only communication; the word is always present.
10. **Jurisdiction filter correctness** — a requirement with `jurisdictionFilter = ["CA"]` never renders for a practice whose `primaryState` and `operatingStates` do not include `"CA"`. A requirement with `jurisdictionFilter = []` always renders.
11. **Category grouping** — when the framework's requirements carry `metadata.category`, rows group under `<h3>` category headers in the order defined by `framework.metadata.categoryOrder`. Ungrouped requirements fall through into a "General" trailing bucket.
12. **Extras isolation** — the page renders successfully when `MODULE_EXTRAS_REGISTRY[framework.code]` is `undefined` (nothing renders in Section G). An intentional throw inside an extras component is caught by its boundary and does not blank Sections A–F; an automated test (render a fault-injected extras) confirms this.
13. **Copy scoping** — no module page's copy references a sibling framework. Example: the HIPAA page's AI greeting does not read "HIPAA / OSHA requirements." The templated `summary` uses only the current framework's name.
14. **Metadata tag** — `generateMetadata` returns `{ title: "{framework.code.toUpperCase()} · My Compliance" }` (already implemented). When `framework.supersededAt` is past, the title prefixes "[Superseded]".
15. **Loading.tsx** — the route has a `loading.tsx` at `src/app/(dashboard)/modules/[code]/loading.tsx` that renders the full skeleton for Sections A–E. Section F & G are omitted from the skeleton (low priority). Verified by Next's dev-time overlay and by an integration test that asserts the skeleton renders during a simulated slow query.
16. **Unauthorized shape** — when `getPracticeUser()` returns null, the page responds with Next's `notFound()` or a redirect to `/sign-in` per the middleware. No half-rendered UI.
17. **Unknown framework** — `code` that does not match any row calls `notFound()` (already implemented at line 42 of `page.tsx`).
18. **Activity feed correctness** — the feed shows only `REQUIREMENT_STATUS_UPDATED` events whose `payload.frameworkCode === framework.code`. A status change to HIPAA's requirement does not appear in OSHA's feed.
19. **Revalidation** — after `updateRequirementStatusAction` succeeds, `revalidatePath(/modules/${code})` is called (already implemented). A second client (same practice, different tab) sees the update on next navigation.
20. **No hardcoded colors** — the page uses only design-system tokens (`--gw-color-compliant`, `--gw-color-good`, `--gw-color-needs`, `--gw-color-risk`) via utilities like `scoreToColorToken`. The ESLint rule `no-hardcoded-colors` is enabled on `src/app/(dashboard)/modules/**`.
21. **Framework extension** — a new framework can be added without modifying `modules/[code]/page.tsx`. Verified by inspection: after seeding a framework with a fresh `code`, `/modules/{code}` renders through the shell, passes acceptance criteria 1–20 (excluding category/extras/jurisdiction concerns that only apply when configured), and does not require an import or a file addition under `src/app/(dashboard)/modules/`.
22. **Dark mode parity** — every threshold color renders correctly in dark mode (enforced by the no-hardcoded-colors rule + the CSS variables in `src/app/globals.css`).
23. **Test coverage** — each section has at least one integration test asserting it renders the required states (loading, empty, populated). `ChecklistItemServer` already has component coverage; add tests for Section B's filter behavior, Section E's empty state, and Section G's isolation guarantee.
24. **Bundle size budget** — the module page's JS bundle for `/modules/[code]` (excluding per-framework extras) is ≤ 120 KB gzipped. Extras components are code-split via `next/dynamic` so users only pay for the extras their framework activates.
25. **No code branching on `framework.code`** — the page file contains no `switch (framework.code)` and no chained `if` comparing `framework.code` to string literals. All per-framework variance goes through data fields or registry lookups. Enforced by a small custom lint rule (to be added alongside `no-hardcoded-colors`) or by code-review discipline until the rule lands.
26. **Event payload includes `frameworkCode`** — every `REQUIREMENT_STATUS_UPDATED` event written by the page's actions includes `payload.frameworkCode` (already present via `src/lib/events/registry.ts` schema). This is what Section E's filter depends on.
27. **Idempotent page reads** — hitting the same URL twice in a row returns byte-identical HTML (modulo relative timestamps). No random ids, no client-only placeholders that hydrate differently than the server render.
28. **Optimistic update correctness** — when a user toggles a radio, the UI updates before the server ack. On server error, the UI reverts (already implemented in `ChecklistItemServer` lines 37–50). A test asserts the revert by forcing the action to throw.
29. **ComplianceItem lazy creation** — the first time a user sets a status on a requirement, a `ComplianceItem` row is created by the projection inside the same transaction. Subsequent toggles `UPDATE` that row. The projection never mutates a `ComplianceItem` for a different practice (sanity-checked by a multi-tenant test).
30. **`NOT_APPLICABLE` path** — the UI surfaces `NOT_APPLICABLE` only via the overflow menu on a row (not as a primary radio). Requirements in `NOT_APPLICABLE` status are excluded from the `Y` denominator in Section B's "X of Y compliant."

---

## What each of the 14 frameworks needs

| # | `code` | Name | Type | Requirements target | Categories | Has extras? | Notes |
|--|--|--|--|--|--|--|--|
| 1 | `HIPAA` | Health Insurance Portability and Accountability Act | Regulation | ~20 (up from v2's current 10 in `scripts/seed-hipaa.ts`) | Administrative / Physical / Technical / Breach | Yes: `BreachReportableCalculator`, `NppTemplatePicker` | Always federal; `weightDefault 0.25`. `jurisdictionFilter = []` on all requirements. |
| 2 | `OSHA` | Occupational Safety & Health Administration | Regulation | ~15 | General / Healthcare-specific | Yes: `Osha300LogSummary` | Federal + state-plan variants (28 states run their own OSHA plan; overlay via `metadata.plan`). |
| 3 | `OIG` | Office of Inspector General | Regulation | ~8 | Core 7 elements | Yes: `ExcludedPersonCheck` | Federal; tied to the OIG "Compliance Program Guidance" 7-element model. |
| 4 | `CMS` | CMS Conditions of Participation / Coverage | Regulation | ~10 | Conditions / Conditions-of-coverage | No (launch); potentially MIPS dashboard later | Federal; `scoringStrategy` may flip to a MACRA composite if MIPS overlap reaches full scope. |
| 5 | `DEA` | Drug Enforcement Administration | Regulation | ~12 | Schedule II / III-V / Records / Inventory | Yes: `ControlledSubstanceInventory` | Federal; many requirements have `metadata.schedule` values to filter by Schedule level. |
| 6 | `CLIA` | Clinical Laboratory Improvement Amendments | Regulation | ~8 | Certificate type / Personnel / QC | No | Federal + state lab overlay; `metadata.certificateType` drives requirement visibility ("Waived" practices see a subset). |
| 7 | `MACRA` | Medicare Access and CHIP Reauthorization Act (MIPS) | Regulation | ~6 | Quality / Promoting Interoperability / Improvement Activities / Cost | No (launch) | Federal; reporting tier depends on `Practice.providerCount`; may become its own Extras later (open question O-7). |
| 8 | `TCPA` | Telephone Consumer Protection Act | Regulation | ~4 | Consent / Do-Not-Call / Records | No | Federal + state auto-dialer overlays; `jurisdictionFilter` used heavily. |
| 9 | `TRAINING` | Training Program | Operational | ~5 program-level KPIs | None | No — real workspace is `/programs/training` | Thin module page: KPIs are "% staff with current HIPAA training," "% with current OSHA BBP training," etc. Section C is read-mostly. |
| 10 | `POLICIES` | Policy Program | Operational | ~5 program-level KPIs | None | No — real workspace is `/programs/policies` | Thin. KPIs: "Active policies," "Policies acknowledged by all staff," "Policies reviewed in the last 12 months." |
| 11 | `RISK` | Security Risk Assessment | Operational | ~3 | None | No (the SRA wizard itself lives at `/programs/risk`, not in Extras) | Thin. Scored on "Date of last completed SRA," "Open risks," "Mitigations in progress." |
| 12 | `INCIDENTS` | Incident Program | Operational | ~3 | None | Maybe (TBD): an "Open major breaches" mini-panel that reuses `<MajorBreachBanner>` | Thin. Links to `/programs/incidents` for triage. Section G may host a banner row if any open incident crosses the 500-individual threshold. |
| 13 | `CREDENTIALS` | Credentialing Program | Operational | ~3 | None | No (launch) | Thin. KPIs: "Expired credentials," "Expiring in 30 days," "Verification up to date." Section D heavily used (each credential is evidence). |
| 14 | `VENDORS` | Vendor / BAA Program | Operational | ~3 | None | No (launch) | Thin. KPIs: "Active BAAs," "Vendors without BAA," "BAAs renewing in 90 days." |

Seeding discipline: each framework above has its own `scripts/seed-{code}.ts` following the pattern of `scripts/seed-hipaa.ts`. All 14 are registered in `npm run db:seed` (the master seed). Adding a framework is **one new seed script** + **one registry entry** + **optionally one extras component**; no `src/app/` changes.

Launch total: 14 frameworks, ~106 regulation-side requirements (8 strict-sense regulations × ~12 avg) + ~23 operational KPIs (6 operational × ~4 avg) = **~129 seeded `RegulatoryRequirement` rows at v2 launch**. A solo PCP in AZ on the HIPAA/OSHA/OIG/CMS default set sees ~53 requirements across their My Compliance list. An obstetrics practice in CA seeing OSHA, HIPAA, DEA, CLIA, and CA-overlay rules could see 85–100. These numbers are the budget for the scoring algorithm's aggregate recompute cost; if average-case framework activation climbs above 100 requirements, revisit the `ComplianceItem.findMany` pattern in step 4 of the data-fetch order.

Go / no-go checklist: a framework ships when it passes the acceptance criteria above **and** its seed script has been run against the target environment **and** (if extras are required) the extras component passes its own axe-core + unit-test suite.

---

## Explicitly NOT in scope for module pages

- **Full policy editor** — lives at `/programs/policies/[id]`. The module page links out, never hosts a rich-text editor.
- **Training player** — lives at `/programs/training/[courseId]`. The module page shows completion counts, never embeds a course.
- **Incident intake form** — lives at `/programs/incidents/new`. The module page's Extras may show a summary banner but the form is elsewhere.
- **Credential renewal forms** — lives at `/programs/credentials/[id]`. Module page shows the date and the expired-count KPI.
- **Stripe billing** — `/settings/billing`. Module page never mentions plan tier (there is only one tier — see `billing-single-tier.md`).
- **Audit prep bundle creation** — `/insights/audit-prep`. Module page links out; does not generate audit PDFs.
- **Cross-framework comparison** — `/insights/compliance-score`. Module page is framework-scoped only.
- **User & role management** — `/settings/team`.
- **Notification preferences** — `/settings/notifications`.
- **Setup wizard** — `/onboarding`. Once a practice is past onboarding, nothing in the module page drops back into setup flows.
- **Regulatory updates feed** — `/insights/regulatory-updates`. A module page may surface a single "New: OSHA WPV guidance published {date}" banner at the top of Section A if `framework.metadata.latestUpdatePublishedAt` is recent (open question O-3), but browsing the full feed is elsewhere.

---

## Extension process — adding a new framework

Per ADR-0004, adding a framework is data, not code. The concrete steps:

1. **Write a seed script** at `scripts/seed-{code-kebab}.ts` following `scripts/seed-hipaa.ts`:
   - `upsert` the `RegulatoryFramework` row with `code` (SCREAMING_SNAKE), `name`, `shortName`, `description`, `citation`, `jurisdiction` (`"federal"` or `"state-{XX}"`), `weightDefault`, `scoringStrategy` (default `"STANDARD_CHECKLIST"`), `iconKey` (a `lucide-react` name), `colorKey` (a `gw/` token), `sortOrder`, `metadata` (optional JSON with `{ categoryOrder, category, supersededBy, latestUpdatePublishedAt }` fields when applicable).
   - `upsert` each `RegulatoryRequirement` with `code`, `title`, `description`, `citation`, `severity`, `weight`, `sortOrder`, `acceptedEvidenceTypes` (array of `EvidenceType.code` values), `jurisdictionFilter` (empty for federal, `["CA"]` for a CA-only requirement), `metadata.category` for categorical grouping.
   - The script is idempotent; re-running it on a production DB updates the mutable fields without producing duplicates.
2. **Register in the master seed** at `scripts/seed-all.ts` (or update the `db:seed` npm script's chain) so local and CI runs include the new framework.
3. **Optionally add an extras component** at `src/components/gw/ModuleExtras/{PascalName}Extras.tsx` and register it in `src/components/gw/ModuleExtras/registry.ts` keyed by `framework.code`.
4. **Write or adapt Storybook stories** for the extras component. Run `npm run test:component` and confirm axe-core passes.
5. **Verify the acceptance checklist** above against the new framework:
   - Unit: visit `/modules/{code-lower}` on a local seeded environment.
   - Automated: run `npm run test` and `npm run test:e2e` (when the e2e suite lands).
   - Manual: toggle a requirement `Compliant` → refresh → confirm the ring moves.
6. **Update `v2-current-state.md`** with the new framework's seed count and any extras added.

What does **not** happen: no new file under `src/app/(dashboard)/modules/`, no edit to `page.tsx`, no edit to `layout.tsx`. If any of these become necessary, something in the shell is missing and belongs in this document first.

---

## Open questions to resolve before implementation

These are decisions Product (Noorros) needs to make before engineering can lock the template. Listed with the specific choices in play so a decision can be a one-line reply.

**O-1. Activity feed scope.** Does Section E show only `REQUIREMENT_STATUS_UPDATED` events (the current plan), or all framework-scoped events including future types like `EVIDENCE_LINKED`, `POLICY_ACKNOWLEDGED`, `TRAINING_COMPLETED`?
 - Option A (locked): status events only. Pros: bounded; matches the current `projectRequirementStatusUpdated` surface. Cons: misses the "a staff member completed HIPAA training → score went up" story.
 - Option B: all events whose payload includes a `frameworkCode` match. Pros: richer feed. Cons: needs every future event to include `frameworkCode` in payload; more indexing.
 - Option C: status events + a curated short list (evidence linked, training completed) with per-type row templates. Compromise.

**O-2. Requirement description format — markdown or plain text?** The current schema stores `description` as `String @db.Text`. Long HIPAA descriptions would benefit from bullet lists; DEA schedule notes might need tables.
 - Option A: plain text only. Pros: simplest; no XSS surface. Cons: long descriptions become dense walls.
 - Option B: markdown (subset — bold, italic, lists, links). Pros: readable. Cons: needs a sanitizer + preview; risk of drift if someone pastes HTML.
 - Option C: a constrained "rich text" enum — `paragraph`, `bullet`, `numbered`, `link` — stored as a small JSON array rather than free-form.

**O-3. Regulatory-update banner.** Does the module header surface a "New guidance published {date}" banner when `framework.metadata.latestUpdatePublishedAt` is within the last 30 days, or is that entirely the responsibility of `/insights/regulatory-updates`?
 - Option A: no banner on module pages. Clean.
 - Option B: banner only when the update is marked `metadata.priority === "HIGH"`. Keeps noise down.
 - Option C: banner whenever the framework has a recent update.

**O-4. Per-state overlays on federal frameworks.** HIPAA is federal but California's CMIA, Texas HB300, etc. add HIPAA-adjacent requirements. How do they render?
 - Option A: a single federal framework; state-specific requirements live as rows on that framework with `jurisdictionFilter = ["CA"]` (preserves one module page per topic).
 - Option B: a sibling framework `HIPAA_CA` that the user sees when their `primaryState === "CA"` (one module page per framework × state combination).
 - Option C: separate "State Law" framework that aggregates all state-specific requirements regardless of federal parent (matches v1's consolidated state section).
 - This decision interacts with the "overlay badge" in Section A and the requirement-list rendering in Section C.

**O-5. Deadline sourcing.** Section B's "N deadlines this month" — does that pull from:
 - Option A: a `requirement.metadata.deadline` ISO string seeded by the framework script (hand-curated per requirement).
 - Option B: linked evidence with renewal dates (e.g., a BAA expires, a training is due).
 - Option C: both unioned.
 - Without an answer, the summary band can't ship in its full form; it would default to counting upcoming credential renewals only (which is Option B for a subset).

**O-6. Toast infrastructure.** Several states in the matrix ("Offline status write failed," "Rate-limited AI request") call for a toast but no toast primitive exists in `gw/` yet.
 - Option A: add `<ToastProvider>` + `<useToast>` to the design system before shipping the first module page.
 - Option B: defer to weeks 12 (notification redesign) and have the module page render errors inline in the affected section's body.

**O-7. Fate of the "Run AI assessment" button.** The `AiAssessmentButton.tsx` file early-returns `null`. The component, server action (`runAiAssessmentAction`), and prompt registry entry (`hipaa.assess.v1`) are still wired. Before v2 launch, decide:
 - Option A: delete the button + its assess action + the prompt entry. If/when we want an AI-assessment flow again, rebuild it with a different purpose.
 - Option B: keep the plumbing, repurpose the button for policy-gap drafting (Extras slot on HIPAA).
 - Option C: keep the button hidden but retain the assess prompt as a reference for the eval harness.
 - This decision changes the files enumerated under "Section F" and "Section G" above.

**O-8. Thin vs. full module pages — which template?** The spec currently asserts a single template serves both. If the thin versions (Training, Policies, etc.) end up needing a visually distinct layout (e.g., one big KPI card + a "Go to program" CTA replacing the requirements list), we would need to split into two templates keyed on `framework.metadata.template = "FULL" | "THIN"`.
 - Option A: one template, operational frameworks use ~5 program-level requirements that happen to render through the same rows. Minimal variance.
 - Option B: two templates, selected by `framework.metadata.template`. Clearer visual identity for operational pages, but violates the "one shell" goal of this document and adds a second acceptance matrix.
 - Recommend locking Option A unless customer feedback during week 10–11 shows the thin pages feel out of place.

**O-9. `IN_PROGRESS` as a first-class radio?** The `ComplianceItem.status` enum has `NOT_STARTED`, `IN_PROGRESS`, `COMPLIANT`, `GAP`, `NOT_APPLICABLE`. The `<ChecklistItem>` currently exposes only three values (`compliant` / `gap` / `not_started`). The mapping loses `IN_PROGRESS` and `NOT_APPLICABLE` on round-trip.
 - Option A: expose four radios (add `In progress` between `Not started` and `Compliant`). More expressive, slightly busier row.
 - Option B: keep three radios; push `IN_PROGRESS` and `NOT_APPLICABLE` into an overflow "•••" menu. Cleaner primary surface, discoverability cost.
 - Option C: drop `IN_PROGRESS` from the enum entirely and let "Not started" cover partial work until it flips to `Compliant` or `Gap`. Simplest; loses nuance.

**O-10. Requirement weight surfacing.** `RegulatoryRequirement.weight` (0.5 / 1 / 1.5 / 2, from the HIPAA seed) multiplies the requirement's contribution to the framework score. Does the user see this weight, and where?
 - Option A: never show it; weight is an internal scoring concept.
 - Option B: show a "Worth {2×}" chip on `CRITICAL` + `weight >= 1.5` requirements, explaining their outsized impact.
 - Option C: expose weight in the expanded description panel of a requirement row.

**O-11. Read-only viewer UX.** When `PracticeUser.role === "VIEWER"`, every write control is disabled. What does the page *still* let them do?
 - Option A: disable all interactions except navigation (radios, AI drawer, evidence picker, extras writes). Read-only everything.
 - Option B: viewers can ask the AI questions but not change status (write vs. read split).
 - Option C: viewers see all data but a single "Request access to edit" CTA replaces interactive controls.

**O-12. When an uncreated `ComplianceItem` is `NOT_STARTED` vs. absent.** The current page treats "no `ComplianceItem` row" as equivalent to `status = NOT_STARTED` via `ciStatusToChecklist`. This works but mixes "we haven't decided" with "we decided it's not started." Does the product want to distinguish these?
 - Option A (status quo): no distinction; absent = `NOT_STARTED`.
 - Option B: show a fourth row state "Unknown" (gray dashed outline) until a user affirmatively clicks.
 - Option C: auto-create a `ComplianceItem` for every requirement when a practice activates a framework, so the DB always mirrors the UI. Adds write volume on practice creation (14 frameworks × ~8 requirements = ~112 inserts per practice).

---

## Worked example — what `/modules/hipaa` renders today

A concrete tour of what the current `scripts/seed-hipaa.ts` + this contract produce for a solo Arizona PCP named "Saguaro Family Care" that has just signed up and enabled HIPAA. The user is the practice owner (`role === "OWNER"`).

**URL:** `/modules/hipaa`

**Server render:**

- Section A (Header):
  - Icon: `ShieldCheck` (resolved from `framework.iconKey = "ShieldCheck"`).
  - `<h1>`: "Health Insurance Portability and Accountability Act".
  - Subtitle small caps: "HIPAA" (from `shortName`).
  - Citation: `45 CFR Parts 160, 162, and 164`.
  - ScoreRing: renders `—` (centered em-dash), label "Not assessed yet." No stale chip.
  - Badges: `[federal]`.
  - Assessed-timestamp: hidden (no `lastScoredAt`).

- Section B (Summary band):
  - "0 of 10 compliant" pill.
  - "0 deadlines this month" pill hidden (zero).
  - "10 open gaps" pill (all 10 requirements are `NOT_STARTED`, which counts as open).

- Section C (Requirements):
  - `<h2>Requirements (10)`.
  - If `framework.metadata.categoryOrder` is populated with the HIPAA taxonomy, requirements bucket as:
    - Administrative Safeguards: Privacy Officer, Security Officer, SRA, Policies & Procedures, Workforce Training, BAAs, Minimum Necessary — 7.
    - Privacy: NPP — 1.
    - Breach Notification: Breach response procedure — 1.
    - Physical Safeguards: Workstation use — 1.
  - Per-row rendering: CRITICAL pill on Privacy Officer / Security Officer / SRA / Policies / BAAs / Breach Response; nothing special on the rest.
  - Every radio sits in `Not started` state; no source chip; no AI reason indicator.

- Section D (Evidence): weeks-5-6 stub — `<EmptyState>` with action "Go to My Programs".

- Section E (Activity feed): `<EmptyState>` "No activity yet."

- Section F (AI): AiAssistTrigger button in the header actions row.

- Section G (Extras): when `HipaaExtras` is registered, renders `<BreachReportableCalculator>` + `<NppTemplatePicker>` in a 2-column layout (mobile stacks). Pre-launch, renders nothing.

**User interaction flow — marking "Designate a Privacy Officer" as Compliant:**

1. User clicks the `Compliant` radio on the Privacy Officer row.
2. `ChecklistItemServer` fires `updateRequirementStatusAction({ frameworkCode: "HIPAA", requirementId, requirementCode: "HIPAA_PRIVACY_OFFICER", nextStatus: "COMPLIANT", previousStatus: "NOT_STARTED" })`.
3. `appendEventAndApply` writes a `REQUIREMENT_STATUS_UPDATED` event with `source: "USER"` in a single transaction along with the projection update.
4. `projectRequirementStatusUpdated` upserts a `ComplianceItem` row with `status: "COMPLIANT"`, then recomputes `PracticeFramework.scoreCache`.
5. The HIPAA module page is revalidated via `revalidatePath("/modules/hipaa")`.
6. Next render: Section A's ring moves from `—` to some positive number driven by the scoring strategy (with `weight = 1.5` on Privacy Officer, the contribution is non-trivial); Section B's "1 of 10 compliant" + "9 open gaps"; Section C's row now has a `User` source chip; Section E shows a single row: "You marked Designate a Privacy Officer as Compliant · just now."

**If an AI assessment runs later and flips the Workforce Training row to `GAP` with a reason:**

7. Section C's Workforce Training row shows an `AI` source chip + an info-button that opens a popover: "Your onboarding data indicates 3 staff members without any recorded training completion."
8. Section E gets a second row: "AI Concierge marked Train all workforce members on HIPAA as Gap · 10 minutes ago. (AI suggestion)" with the same reason popover.

**If the user then overrides that status back to `Compliant`:**

9. Section C's row loses its `AI` chip and gains a `User` chip; the info-button disappears (gating per acceptance criterion 7).
10. Section E shows a third row: "You marked Train all workforce members on HIPAA as Compliant · just now." The AI row stays visible as the second-most-recent event; the feed is reverse chronological.

This is exactly what a new framework ships when its seed script lands. No custom page file, no module-specific component, no framework-specific branches.

---

## Appendix — files this document governs

**Templates and handlers:**
- `src/app/(dashboard)/modules/[code]/page.tsx` — the dynamic route (exists).
- `src/app/(dashboard)/modules/[code]/loading.tsx` — skeleton (to be added).
- `src/app/(dashboard)/modules/[code]/error.tsx` — error boundary (to be added).
- `src/app/(dashboard)/modules/[code]/actions.ts` — requirement status server action (exists).
- `src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx` — client wrapper (exists).
- `src/app/(dashboard)/modules/[code]/AiAssessmentButton.tsx` — hidden; fate to decide (see O-7).

**Design-system components used:**
- `src/components/gw/ModuleHeader/` — Section A (exists; needs prop extensions).
- `src/components/gw/ScoreRing/` — inside Header + ComplianceCard (exists).
- `src/components/gw/RegulationCitation/` — inside Header (exists).
- `src/components/gw/ChecklistItem/` + `ChecklistItem/AiReasonIndicator.tsx` — Section C (exist).
- `src/components/gw/EvidenceBadge/` — Section D (exists).
- `src/components/gw/EmptyState/` — multiple empty states (exists).
- `src/components/gw/DeadlineWarning/` — Section B when deadlines are critical (exists).
- `src/components/gw/MajorBreachBanner/` — Incidents thin page Extras (exists).
- `src/components/gw/AiAssistDrawer/` + `AiAssistTrigger.tsx` — Section F (exist).

**Design-system components to build:**
- `src/components/gw/ModuleSummaryBand/` — Section B wrapper (new).
- `src/components/gw/RequirementRow/` — the row composition for Section C (new; wraps `ChecklistItem`, citation, severity, source chip, expand panel).
- `src/components/gw/ActivityFeed/` — Section E (new).
- `src/components/gw/EvidencePanel/` — Section D full form (new, weeks 9-10).
- `src/components/gw/ModuleExtras/registry.ts` — the Section G registry (new).
- `src/components/gw/ModuleExtras/HipaaExtras.tsx`, `DeaExtras.tsx`, `OshaExtras.tsx`, `OigExtras.tsx` — (new, weeks 7-8).

**Seed scripts (per-framework):**
- `scripts/seed-hipaa.ts` (exists; 10 requirements → target 20).
- `scripts/seed-osha.ts`, `seed-oig.ts`, `seed-cms.ts`, `seed-dea.ts`, `seed-clia.ts`, `seed-macra.ts`, `seed-tcpa.ts`, `seed-training.ts`, `seed-policies.ts`, `seed-risk.ts`, `seed-incidents.ts`, `seed-credentials.ts`, `seed-vendors.ts` (to write).
- `scripts/seed-all.ts` — orchestrator (to write).

**Schema (exists, referenced for data sourcing):**
- `prisma/schema.prisma` — `RegulatoryFramework`, `RegulatoryRequirement`, `PracticeFramework`, `ComplianceItem`, `EvidenceType`, `EventLog`, `Practice`, `PracticeUser`.

**Event registry (exists):**
- `src/lib/events/registry.ts` — `REQUIREMENT_STATUS_UPDATED` schema drives Section C writes and Section E reads.
- `src/lib/events/projections/requirementStatus.ts` — projector; any framework-scope expansion of the activity feed requires its own projector entries.

---

*End of contract. Changes to this document require a dated revision block at the top of the file and a note in `v2-current-state.md` under the session that made the change.*

---

## Appendix — genuine gaps a naive implementer will miss

These are things that are not wrong in the current code, but would be easy to forget when extending to 13 more frameworks:

1. **Sort is under-specified.** The existing page uses `orderBy: { sortOrder: 'asc' }`. Two requirements with the same `sortOrder` will render in insertion order; that's non-deterministic across deploys. Tie-break by `code ASC` (this contract requires it at C).
2. **`PracticeFramework` is created lazily.** The current page treats a missing row as `scoreCache = 0`. A framework the user has never touched will render a "score 0" ring, which reads as "At Risk" (<50). That's wrong — it should read "Not assessed yet" with a `—`. Acceptance criterion 6 calls this out, but today's code returns `score = 0` unconditionally (line 86 of `page.tsx`).
3. **The activity-feed window (`take: 200`) is framework-agnostic.** It pulls the last 200 events for the practice across all frameworks, then filters by `requirementId` membership. If a practice ever has high-velocity churn on one framework drowning out another's latest events, a requirement's latest event may fall outside the window. Safer pattern: filter server-side by `payload->>'frameworkCode' = $1` (Postgres JSON operator); the registry's `REQUIREMENT_STATUS_UPDATED` payload already carries `frameworkCode` so this works today, but Prisma needs a `$queryRaw` or `.findMany({ where: { payload: { path: ['frameworkCode'], equals: code } } })` which varies by Prisma version.
4. **`ComplianceItem.overrideStatus` is not read anywhere yet.** The schema has it; the page ignores it. When Admin overrides land in a later chunk, Section C must respect `overrideStatus` over `status` for display, and must show a small "overridden by {name}" chip.
5. **The AI reason indicator keys on `EventLog.payload.source`.** If anyone imports existing v1 data directly into `ComplianceItem` without writing events, the source chip + AI reason popover will be absent. Import paths must write a `REQUIREMENT_STATUS_UPDATED` event with `source = "IMPORT"`.
6. **Jurisdiction overlay badge is silent when the match fails.** A federal framework with no state overlay for the current practice's state renders just `[federal]` — users may not realize their state adds nothing. Consider a muted "No additional state rules" chip in later polish (not required for launch).
7. **`scoringStrategy !== "STANDARD_CHECKLIST"` is untested.** The registry is pluggable per ADR-0004, but only the default strategy is in use. When MACRA, SRA, or breach-wizard strategies land, the score in Section A may move on signals unrelated to requirement toggles — make sure Section E's "Recent activity" surface includes whatever events those strategies emit, or users will be confused why the ring moved without a visible row change.
8. **The `code` URL parameter is case-insensitive on read but case-sensitive in writes.** `/modules/hipaa` and `/modules/HIPAA` both work via `code.toUpperCase()` in the query. `revalidatePath` in `actions.ts` uses `.toLowerCase()`, so the cached path matches the canonical URL. If anyone links to `/modules/Hipaa`, the revalidation won't invalidate that variant's cache. Always link with `.toLowerCase()`.
9. **Extras loaded via `next/dynamic` lose `generateMetadata`.** The outer page's `generateMetadata` already handles title, but if any extras component wants to contribute to `<head>` (e.g., HIPAA breach calc adding a `og:image` for sharing), it cannot from inside a dynamic import. Route-level metadata is the only game in town.
10. **The skeletons must match production section heights pixel-exactly.** A 120px header skeleton vs. a 144px real header triggers CLS on hydration. Write skeletons as the **same component tree** with `<Skeleton>` fillers replacing live content, not as a simplified stand-in. This is why criterion 15 requires `loading.tsx` to match Sections A–E, not just fake them.
11. **The `REQUIREMENT_STATUS_UPDATED` event has no `comment` field.** Users can't annotate why they marked something as `GAP`. The payload schema has `reason` (used by AI), but free-form user annotation is not in the schema yet. If product wants that, extend the schema registry at `src/lib/events/registry.ts` with an `actorNote` field before shipping the second module.
12. **Concurrency on rapid toggles.** Two clicks in quick succession fire two server actions, two events, two projections. The last-write-wins is correct, but the optimistic `setStatus` in `ChecklistItemServer` may flicker if the second server response arrives before the first. Acceptable for launch; note as a polish item.
13. **`jurisdictionFilter` applies to requirements, not to frameworks themselves.** A framework like `TRAINING` has `jurisdiction = "federal"` but its KPIs may be meaningful in every state. A state-specific framework (future: `STATE_CA_CMIA`) should have `jurisdiction = "state-CA"` and be filtered out of My Compliance entirely for non-CA practices — that filter happens at the sidebar, not on the module page. Document that boundary clearly in the module-index page's spec (separate doc).
14. **No authz on `framework.code` access.** Today any authenticated user whose `practiceId` matches can read any framework by code. When we add per-practice framework activation (`PracticeFramework.enabled`), the page should `notFound()` on disabled frameworks so URLs don't leak the list of possible frameworks. Middleware alternative: redirect to `/modules` (the index).
15. **The page does not yet emit a `PRACTICE_FRAMEWORK_VIEWED` event.** If product wants telemetry on which frameworks users actually open (for prioritizing content), that event must be registered. Keep it optional and privacy-respecting (no page-dwell tracking).
