# ADR-0005: Internal design system on top of Shadcn

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Noorros, Engineering
**Related:** [ADR-0002 — Regulations × Operations matrix](0002-regulations-operations-matrix.md), [ADR-0004 — Modules as data](0004-modules-as-data.md)

## Context

Shadcn/ui gives us primitives (`Button`, `Card`, `Dialog`, `Tabs`, etc.).
v1 reinvented domain-specific compositions on top of those primitives ~14
times (one per module page). The audit found:

- 70 hardcoded colors without `dark:` prefix
- Z-index hierarchy undocumented (only 2 explicit values, no system)
- 10+ pages missing `metadata` titles
- 13+ nested routes missing `loading.tsx`
- Skip-nav link missing
- Breadcrumb component built but never used
- "Compliant + Gap" toggle UX with no clear active-state visual treatment
  (caused live confusion when Compliant and Gap badges appeared
  simultaneously on every OIG item)

These aren't accessibility nits — they're product-quality drag from
re-deciding the same design questions every page.

## Decision

Build a thin **GuardWell design system** in `src/components/gw/` that
sits on top of Shadcn primitives and ships:

### Domain components (the real value)

| Component | Purpose |
|---|---|
| `<ComplianceCard>` | The unit container for any compliance item — module page, dashboard widget, audit prep card. One width/spacing/border decision, used everywhere. |
| `<ScoreRing>` | The circular score gauge. Accepts score 0–100, renders color band per [thresholds](../../prisma/schema.prisma) (≥90 Compliant, ≥70 Good, ≥50 Needs Work, <50 At Risk). Has aria-labelledby. |
| `<ChecklistItem>` | The `Compliant / Gap / Not Started` row used on every regulatory checklist. Exclusive selection visual (only one toggle is active at a time, with clear filled vs outline distinction — fixes v1's OIG bug where both buttons looked active). |
| `<ModuleHeader>` | The header for a regulation page: icon, name, citation, current score, jurisdictional badges. |
| `<EvidenceBadge>` | "Adopted from Policy X" / "Satisfied by Training Y" / "Pending acknowledgment from N staff" link chip. |
| `<RegulationCitation>` | "45 CFR §164.308(a)(1)(ii)(A)" formatted with hover-link to the regulation source. |
| `<DeadlineWarning>` | The countdown widget for deadlines. Color severity follows same threshold system as score. Used on credentials, breach notifications, training overdue. |
| `<EmptyState>` | `icon, title, description, action`. v1 had no global empty-state component → every page reinvented. |
| `<MajorBreachBanner>` | The red 500+-affected banner. Single component → list view and detail view stay in sync (v1's bug was these diverged). |
| `<PracticeIdentityCard>` | Practice name + state + specialty + setup-progress chip. Top of dashboard. |
| `<AiAssistDrawer>` | The ambient AI Concierge sidebar. Knows current page context. |

### System primitives

- **Color tokens** in CSS variables (`--gw-color-compliant`, `--gw-color-good`,
  `--gw-color-needs-work`, `--gw-color-at-risk`). Never hardcode.
- **Z-index scale** as CSS vars: `--gw-z-sticky: 10`, `--gw-z-dropdown: 20`,
  `--gw-z-modal: 30`, `--gw-z-tooltip: 40`, `--gw-z-toast: 50`.
- **Status colors** mapped from severity enum, never hardcoded.

### A11y baseline (enforced by lint + Storybook)

- Every interactive element has a label (text or aria-label).
- Every icon-only button has aria-label.
- All color-coded status carries a redundant text or icon signal.
- Focus-visible outlines on all interactive elements.
- Skip-nav link in root layout.
- Heading hierarchy enforced (h1 → h2 → h3 contiguous).

### Storybook (or `*.stories.tsx` files via the App Router preview pattern)

Every `gw/` component has a stories file showing all variants + states.
Eval includes axe-core a11y check on each variant.

## Consequences

### Easier
- New module page = compose `gw/` components, ~50% less code than v1.
- a11y audit becomes "did the gw/ components pass?" not "did each
  module re-implement focus management?"
- Major-breach banner inconsistency, OIG toggle ambiguity, etc. are
  one-source-of-truth — fix once, fixed everywhere.

### Harder
- Components need designs first. Mitigated by a one-week design-system
  sprint in weeks 3–4 before module pages (per
  [v2-rebuild-strategy.md](../../../../C:/Users/tcarl/.claude/projects/D--GuardWell/memory/v2-rebuild-strategy.md)).
- Adding a new domain component requires writing the stories file and
  the a11y test. Friction is intentional.

### Revisit
- After ~30 components: consider Storybook as standalone tool rather
  than ad-hoc preview.
- After v2 launches and we have customer screenshots, consider
  publishing the design system docs as a public marketing asset.

## Action items

- [ ] CSS variable scale + theme tokens in `src/app/globals.css`
- [ ] Build the 11 `gw/` components above with stories + a11y tests
- [ ] ESLint rule `no-hardcoded-colors` in `src/app/(dashboard)/`
- [ ] Lint rule requiring `aria-label` on icon-only buttons
- [ ] Skip-nav link in root layout from day one
