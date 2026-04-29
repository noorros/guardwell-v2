# HIPAA / OSHA / Credentials / Allergy — "Done" Audit Plan

> **For agentic workers:** This plan is meant to be executed in a **fresh session** dispatched after the settings restructure arc lands. Spans multiple turns; use `superpowers:subagent-driven-development` per area.

**Date:** 2026-04-29
**Spec:** none (this is an audit, not a feature build — this doc IS the spec)
**Goal:** Take HIPAA, OSHA, Credentials, and Allergy from "shipped" to "done" — every flow exercised, every regression caught, every UX gap noted.
**Production target:** `https://v2.app.gwcomp.com` (live Cloud Run revision; not local dev)

---

## What "done" means (per area)

A v2 area is "done" when ALL of the following are true:

1. **Code health** — every file in the area's surface inventory passes `npx tsc --noEmit`, `npx eslint`, and the relevant subset of `npm test -- --run`. No pre-existing lint errors in modified files.
2. **Test coverage** — happy path + at least one error path per server action; integration test per major flow (creation, update, deletion, status change); component test with jest-axe for every user-facing UI component.
3. **Code review** — no Critical or Important findings from `superpowers:code-reviewer` on the area's surface.
4. **Functional verification (production)** — every user-facing button, link, form, and modal in the area exercised via `mcp__Claude_in_Chrome__*` tools against `v2.app.gwcomp.com`. Scroll the full page; expand collapsed sections; click into detail pages; submit forms with valid AND invalid input. Don't stop at "the page renders."
5. **Compliance derivation** — every requirement in the framework has either a working derivation rule (auto-derives status from evidence) OR a documented manual-override rationale. No silent "always GAP" or "always COMPLIANT" rules.
6. **Notification + audit trail** — events emit correctly; projections write to expected tables; audit/activity log shows the action with the right copy; PDF reports (where they exist) render without errors.
7. **State overlays (where applicable)** — at least 3 state-specific overlays tested in addition to federal baseline.
8. **Findings report** — a markdown doc at `docs/audit/2026-04-29-<area>-findings.md` with:
   - ✅ Working flows
   - ❌ Bugs / regressions
   - ⚠️ UX gaps (works but rough)
   - 📋 Missing tests
   - 💡 Suggestions deferred to future PR

---

## Order

Run the 4 areas **sequentially** in this order. Reasoning:

1. **HIPAA first** — biggest surface (~92 files, 7,700 LOC per the inventory). Touches every other area (training, policies, incidents, vendors, risk). Patterns established here apply to OSHA + Allergy.
2. **OSHA second** — second-biggest surface; cross-framework rules with HIPAA (incident reporting, training).
3. **Credentials third** — narrower surface; depends on training data already verified in HIPAA pass.
4. **Allergy last** — smallest surface; isolated framework; quick after the patterns are clear.

Each area is its own multi-turn session. Don't try to do all 4 in one session — context budget will collapse.

---

## Per-area task structure

For each area, follow this 6-step playbook:

### Step 1 — Surface inventory

Dispatch the `Explore` agent with this prompt template (substitute `<AREA>`):

> Map the `<AREA>` surface in GuardWell v2. Working dir: `D:/GuardWell/guardwell-v2/`. List every file (with one-line description) grouped by category: module page, schema models, derivation rules, seed data, training, policies, server actions, API routes, tests, help/AI copy, state overlays, projections. Output under 800 lines markdown. Don't propose fixes — just inventory.

Reference: HIPAA inventory was already completed 2026-04-29 — see chat transcript or re-run for fresh state. The 13 categories from that inventory are the canonical list:
1. Module page & UI components
2. Prisma schema models
3. Derivation rules + framework registration
4. Policy templates + seed data
5. Training + onboarding
6. Incidents / breach determination
7. Risk / SRA (HIPAA-only — skip for non-HIPAA)
8. Vendors / BAAs (HIPAA-only — skip for non-HIPAA)
9. Policies
10. Server actions + API routes
11. Tests
12. Help articles + AI copy
13. State overlays + projections

Drop categories 7 + 8 for OSHA / Credentials / Allergy. They're HIPAA-specific.

### Step 2 — Code review

Dispatch `superpowers:code-reviewer` agent with the inventory output as input + this prompt template:

> Code-quality review for GuardWell v2's `<AREA>` surface. Inventory attached below. Focus on: single-purpose modules, type safety (no `any`), defensiveness on null/empty, derivation rule correctness, server action input validation (Zod), test coverage, a11y attributes on interactive components. Flag Critical / Important / Minor. Working dir: `D:/GuardWell/guardwell-v2/`. Don't fix anything — report only.

Save the reviewer's findings to a temp file at `/tmp/<area>-code-review.md` for later aggregation.

### Step 3 — Test review

Run the test subset for the area. Specifically:

```bash
cd D:/GuardWell/guardwell-v2
# HIPAA-relevant
npm test -- --run tests/integration/officer-designation tests/integration/sra-completion tests/integration/sra-draft tests/integration/incident-lifecycle tests/integration/incident-breach-memo-pdf tests/integration/incident-notifications tests/integration/vendor-baa tests/integration/policy-adoption tests/integration/training-completion tests/integration/requirement-status tests/integration/notification-completeness tests/integration/state-overlays tests/integration/ai-assist 2>&1 | tail -20
# OSHA-relevant — TBD list during step 1 inventory; common: osha-policy-adoption, training-completion, incident-lifecycle (filtered to OSHA_RECORDABLE)
# Credentials — credential-expiry, credential-renewal, training-completion (CPR / BLS evidence)
# Allergy — allergy-equipment-check, allergy-drill, allergy-policy-adoption
```

For each test file in the area's inventory: confirm it passes. Note any flakes. Note which user-visible flows have NO integration test.

### Step 4 — Chrome verify

This is the heart of the audit. **Don't skip or shortcut this step.** Use `mcp__Claude_in_Chrome__*` tools against production `v2.app.gwcomp.com`.

Required tools (load via `ToolSearch query="select:Tool1,Tool2,..."` if not already loaded):
- `mcp__Claude_in_Chrome__list_connected_browsers` — pick the user's browser
- `mcp__Claude_in_Chrome__select_browser`
- `mcp__Claude_in_Chrome__navigate`
- `mcp__Claude_in_Chrome__computer` — click, scroll, type, screenshot
- `mcp__Claude_in_Chrome__read_page` — semantic page tree
- `mcp__Claude_in_Chrome__find` — locate elements by NL
- `mcp__Claude_in_Chrome__browser_batch` — multiple actions in one round trip
- `mcp__Claude_in_Chrome__tabs_context_mcp` — get current tab IDs

**Per-area Chrome checklist** (defined below for each area). For every step:

- Don't accept "looks fine" — interact with everything
- Scroll the full page (use `computer` action `scroll` direction `down` repeatedly until the bottom)
- Click every visible button + link to confirm destination
- Submit forms with valid input AND invalid input; verify both paths render the expected response
- Open every modal / drawer / popover; close them
- Test on mobile viewport too (use `computer` action with explicit small viewport, or just scroll-test the responsive breakpoints)

After each Chrome session, take 2-3 screenshots to attach to the findings report.

### Step 5 — Compile findings

For each area, create `docs/audit/2026-04-29-<area>-findings.md` with this structure:

```markdown
# <Area> Audit — Findings

**Date:** 2026-04-29
**Reviewer:** <name>
**Surface inventory:** N files, ~M LOC

## Summary

X working flows · Y bugs · Z UX gaps · K missing tests

## Working ✅

- <flow 1> — <one-line why it's solid>
- ...

## Bugs ❌

- <path:line> — <symptom> — <how to reproduce> — <impact (data corruption / UX broken / cosmetic)>
- ...

## UX gaps ⚠️

- <flow> — <what's rough> — <recommendation>
- ...

## Missing tests 📋

- <path> — <flow that has no test> — <integration vs. unit recommended>
- ...

## Deferred 💡

- <future-PR-worthy item>
- ...

## Screenshots

- `screenshot-<flow>-1.png` (attached via Chrome MCP `save_to_disk`)
- ...
```

### Step 6 — Open follow-up issues

Don't commit fixes during the audit. Each Critical/Important bug becomes a separate small PR after the audit completes. The findings docs are the input to a triage session with the user.

---

## Per-area Chrome checklists

### HIPAA

**Routes to exercise** (signed in as a practice OWNER):

1. `/dashboard` — verify ComplianceTrackWidget shows HIPAA score; click into HIPAA module
2. `/modules/hipaa` — full page scroll; expand every section; verify HipaaExtras renders (BreachReportableCalculator + NppDeliveryReference); click each requirement card → drill into detail
3. `/programs/policies` — verify HIPAA Privacy Policy / Security Policy / Breach Response Policy / Minimum Necessary Policy / NPP Policy / Workstation Policy all listed; click into one; adopt new version; review; verify staff acknowledgment flow
4. `/programs/training` — verify HIPAA_BASICS / HIPAA_BREACH_RESPONSE / HIPAA_BAA_MGMT / HIPAA_MINIMUM_NECESSARY / HIPAA_DOCUMENTATION courses listed; enroll a staff member; complete a course; verify completion appears in `/me/acknowledgments`
5. `/programs/incidents` — create new privacy incident with PHI involved; run breach determination wizard (4-factor analysis); verify reportable decision shown; download breach memo PDF; resolve incident
6. `/programs/risk` — start new SRA; save draft; complete SRA; verify HIPAA_SRA derivation flips status to COMPLIANT
7. `/programs/vendors` — create vendor; mark as Business Associate; send BAA; verify token URL works (open accept-baa page); accept on the vendor side; verify execution recorded
8. `/programs/staff` — designate Privacy Officer + Security Officer; verify HIPAA_PRIVACY_OFFICER + HIPAA_SECURITY_OFFICER requirements derive to COMPLIANT
9. `/audit/overview` — verify HIPAA score appears; click "Export PDF" — confirm PDF downloads
10. `/audit/activity` — verify all the events from the above flows appear in the activity log with correct copy

**Critical interactions** (don't miss):

- Breach memo PDF generation (`incident-breach-memo-pdf.tsx`) actually downloads
- BAA acceptance token URL (`/accept-baa/[token]`) renders without auth
- SRA wizard's draft-save survives page reload
- Major breach banner appears on dashboard when an incident affects ≥500 individuals
- `<Osha300AReminder>` does NOT appear (it's OSHA-specific) — verify it's not leaking

### OSHA

**Routes to exercise:**

1. `/dashboard` — verify OSHA score; if Feb 1 – Apr 30, verify Osha300AReminder banner shows
2. `/modules/osha` — full page scroll; verify OshaExtras renders (Form 300A worksheet + posting checklist + bloodborne pathogens ECP template)
3. `/programs/policies` — verify OSHA-specific policies listed (Hazard Communication, Bloodborne Pathogens ECP, Workplace Violence, etc.)
4. `/programs/training` — verify OSHA_TRAINING / BLOODBORNE / PPE / HAZARD courses listed; enroll + complete
5. `/programs/incidents` — create OSHA_RECORDABLE incident (a workplace injury); verify state-specific reporting reminders
6. Look for OSHA Form 300A worksheet — verify it accepts incident counts and produces a posting-ready PDF
7. PPE assessment — verify the `EVENT:PPE_ASSESSMENT_COMPLETED` synthetic event flow (probably under `/programs/staff` or a settings page)
8. Poster attestation — `EVENT:POSTER_ATTESTATION` flow

**Critical interactions:**

- Form 300A worksheet calculates totals correctly
- Bloodborne ECP template auto-populates with practice info
- OSHA-specific incidents appear in /programs/incidents with correct severity/type filter
- OSHA derivation rules (8/8 from Phase 1) all evaluate against real evidence

### Credentials

**Routes to exercise:**

1. `/programs/credentials` — verify list rendering; verify credential type filter; verify expiry status badges (ACTIVE / EXPIRING_SOON / EXPIRED / NO_EXPIRY)
2. Create new credential — pick credential type (DEA / NPI / Medical License / CPR / BLS / etc.); set expiry date; upload supporting doc
3. Renew credential — verify expiry date update; verify notification re-armed
4. Delete (or retire) a credential — verify it's filtered out of active queries
5. Search / filter — by staff member, by type, by expiring-this-week
6. Verify credentials list integrates with `/programs/staff` (each staff member's credentials shown on their detail page)
7. Verify credential expiry triggers notifications (notification bell + email digest)
8. Verify HIPAA_TRAINING evidence type pulls from completed credential training (if any)

**Critical interactions:**

- Expiry-date math: a credential expiring in 89 days = EXPIRING_SOON; in 91 days = ACTIVE
- Bulk import (if exists) — try uploading a CSV
- The credential evidence requirement contributes to compliance scoring
- DEA credential renewal — verifies DEA_LICENSE_RENEWAL evidence

### Allergy

**Routes to exercise:**

1. `/modules/allergy` — full page scroll; verify AllergyExtras renders (whatever extras exist for this framework)
2. `/programs/allergy` — verify the allergy-specific program page (4 derivation rules per Phase 1: ALLERGY_COMPETENCY, ALLERGY_EMERGENCY_KIT_CURRENT, ALLERGY_REFRIGERATOR_LOG, ALLERGY_ANNUAL_DRILL)
3. Allergy equipment check log — create entry; verify AllergyEquipmentCheck row written; verify ALLERGY_REFRIGERATOR_LOG derivation updates
4. Allergy drill — record drill completion; verify AllergyDrill row written; ALLERGY_ANNUAL_DRILL derivation flips
5. Emergency kit refresh — verify refrigerator log + emergency kit are tracked separately
6. Allergy training course — verify ALLERGY_COMPETENCY evidence flows through training completion
7. Allergy policies — 5 policy attestation rules (pre-wired); verify they show in /programs/policies

**Critical interactions:**

- Refrigerator log: enter a new check; verify timestamp; verify "last 30 days" filter on the dashboard widget
- Annual drill: record one; verify it satisfies ALLERGY_ANNUAL_DRILL; record a second the next day; verify the rule still requires ANNUAL (not just "ever logged")
- Emergency kit current: verify the kit's expiration tracker (epinephrine has a shelf life) flips ALLERGY_EMERGENCY_KIT_CURRENT to GAP near expiry

---

## Aggregation step (after all 4 areas)

Once all 4 area findings docs exist, dispatch a final summary subagent:

> Aggregate the 4 audit findings docs at `docs/audit/2026-04-29-{hipaa,osha,credentials,allergy}-findings.md` into a single triage doc at `docs/audit/2026-04-29-audit-summary.md`. Group bugs by severity (Critical / Important / Minor). Group UX gaps by surface. Identify cross-area patterns (e.g. "all 4 framework module pages are missing X"). Output a prioritized backlog: top 10 must-fix items in order, then next 10, then "nice to have." Don't suggest implementation — that's the next session.

---

## Tools the auditing session needs

Already loaded in the prior session — re-load if needed:

- `Agent` (delegate code review + inventory work) — built-in
- `mcp__Claude_in_Chrome__*` tools (full set) — load via:
  ```
  ToolSearch query="select:list_connected_browsers,select_browser,navigate,computer,read_page,find,browser_batch,tabs_context_mcp,tabs_create_mcp"
  ```
- `superpowers:code-reviewer` agent type — for the standard code-quality pass per area

---

## Estimated turn budget per area

| Step | Subagent dispatches | Approx turns |
|------|---------------------|--------------|
| 1. Inventory | 1 (Explore agent) | 1 |
| 2. Code review | 1 (code-reviewer) | 1 |
| 3. Test review | 0 (controller runs commands) | 1-2 |
| 4. Chrome verify | 0 (controller drives) | 8-15 |
| 5. Findings doc | 0 (controller writes) | 1 |
| 6. Issue spawning | 0 (deferred) | 0 |

**Per area:** ~12-20 turns. **All 4 areas:** ~50-80 turns. Don't attempt in one session.

---

## Hand-off context for next session

**Session state at handoff (2026-04-29 evening):**

- Settings restructure arc: COMPLETE. PRs #182-186 + hotfix #187 merged. Live revision `guardwell-v2-00186-nc7`.
- HIPAA surface inventory: ALREADY DONE (in this session — 92 files, ~7,700 LOC, 13 categories). Re-run if you want fresh state, but the inventory is reliable.
- 3 untracked plan docs in `docs/plans/` from earlier sessions remain uncommitted — your call.
- Backfill migration `scripts/backfill-practice-specialty.ts` not yet run in prod — affects pre-existing rows only; idempotent; safe to defer.

**Memory to read first:**

- `memory/MEMORY.md`
- `memory/collaboration-preferences.md`
- `memory/v2-feature-recovery-master.md` (settings restructure section is the latest entry)
- `memory/cron-gotchas.md` (in case audit surfaces another env-var trap)

**Resume order:**

1. Read this plan
2. Read the HIPAA inventory from this session's chat (or re-run via Explore agent — same prompt)
3. Run code-reviewer on HIPAA surface
4. Run HIPAA test subset
5. Connect Chrome + interactive verify HIPAA flows
6. Compile HIPAA findings doc
7. Repeat for OSHA, then Credentials, then Allergy

---

## What NOT to do during the audit

- Don't fix bugs inline. Findings doc only. Triage + fix is the next session.
- Don't refactor "while you're there." Out of scope.
- Don't add tests during the audit. Note "missing test" in the findings; add later.
- Don't skip Chrome verify because "code looks fine." The user explicitly asked for interactive verification.
- Don't accept first-render as proof of correctness. Scroll, click, submit, edit, delete, restore.

---

## Open question for the user (at the start of the audit session)

> "Quick check before I start interacting with prod data: should I create a fresh test practice for the audit (so my actions don't pollute your real data), or work against an existing practice you've designated as the test instance?"

The user's answer determines whether the auditor seeds a new practice + signs in as a test owner, or uses an existing practice's `practiceId`.
