# Incident Breach Memo PDF + Notification Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a HIPAA §164.402 breach determination memo PDF for any incident where a breach decision has been recorded, render the documented memo + 4-factor analysis + notification timeline, and surface the generator on the incident detail page. Plus re-land the orphaned launch-readiness master plan rewrite (commit `6e5ef50`, never reached main).

**Architecture:** Add a single `breachDeterminationMemo String? @db.Text` column on `Incident`. Extend the existing `INCIDENT_BREACH_DETERMINED` v1 event payload with an optional `memoText` field — backward-compatible (old events validate cleanly, new events carry the memo). Projection writes the memo to the new column. Wizard gets a textarea (required client-side; nullable server-side for graceful evolution). New PDF route follows the established `@react-pdf/renderer` + `renderToBuffer` pattern from `incident-summary-pdf.tsx`. Detail page renders a "Generate breach memo" CTA whenever `breachDeterminedAt !== null`. The PDF is per-incident (NOT a list-style audit report), so it does NOT get an entry in `/audit/reports` REPORTS array; the entry point is the per-incident page only.

**Tech Stack:** `@react-pdf/renderer` (already installed, used by 7 existing audit PDFs), Prisma 5.22, existing event-sourcing pipeline (`appendEventAndApply`), existing `requireUser` + `getPracticeUser` auth helpers, vitest for integration tests.

**Pre-existing infrastructure already in place** (verified by survey, do not rebuild):
- `Incident.affectedIndividualsNotifiedAt`, `Incident.mediaNotifiedAt`, `Incident.stateAgNotifiedAt`, `Incident.ocrNotifiedAt` columns exist (no schema changes needed for notification tracking)
- `NotificationLog` component at `src/app/(dashboard)/programs/incidents/[id]/NotificationLog.tsx` already records all four notification kinds
- `recordIncidentNotificationAction` server action exists
- `INCIDENT_NOTIFIED_HHS|AFFECTED_INDIVIDUALS|MEDIA|STATE_AG` event types + projections exist
- `MAJOR_BREACH_THRESHOLD = 500` constant + `MajorBreachBanner` component exist
- 4-factor analysis exists in `completeBreachDeterminationAction`

---

## File Structure

**Create:**
- `src/lib/audit/incident-breach-memo-pdf.tsx` — React-PDF document component. Exports `IncidentBreachMemoDocument` + `BreachMemoInput` interface. Renders practice header, incident summary, 4-factor analysis with descriptions, decision, memo narrative, notification timeline, generated-at footer. Mirrors style from `incident-summary-pdf.tsx`.
- `src/app/api/audit/incident-breach-memo/[id]/route.tsx` — `GET /api/audit/incident-breach-memo/[id]` returns the PDF as `application/pdf`. Auth-gated (requireUser + getPracticeUser). Cross-tenant scoped (incident.practiceId === pu.practiceId). Returns 404 if incident not found OR not in this practice OR `breachDeterminedAt === null`.
- `tests/integration/incident-breach-memo-pdf.test.ts` — three integration tests (described in Task 8).

**Modify:**
- `prisma/schema.prisma` — add `breachDeterminationMemo String? @db.Text` to `Incident` model.
- `src/lib/events/registry.ts` — add `memoText: z.string().max(10000).optional()` to `INCIDENT_BREACH_DETERMINED` v1 schema (backward-compatible additive change).
- `src/lib/events/projections/incident.ts` — `projectIncidentBreachDetermined` writes `memoText` to `breachDeterminationMemo` column.
- `src/app/(dashboard)/programs/incidents/actions.ts` — add `memoText` to `BreachInput` Zod schema + propagate to event payload.
- `src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx` — add memo textarea (required, ≥40 chars client-side validation), pass to action.
- `src/app/(dashboard)/programs/incidents/[id]/page.tsx` — render a "Generate breach memo" download link (server-side anchor pointing at `/api/audit/incident-breach-memo/{id}`) inside the existing breach-determination summary card whenever `breachDeterminedAt !== null`. Show the persisted memo text below the score row.
- `docs/plans/2026-04-27-launch-readiness.md` — replace with the orphaned-rewrite content (chunk 1 marked done, status header updated to reflect post-PR-#139 state).

**Migrate (separately, before merge):**
- Run `npx prisma db push` against prod to add the `breachDeterminationMemo` column. The repo still lacks the Cloud Build migration step (chunk 16 of master plan). Manual migration discipline applies.

---

## Pre-Task: Confirm worktree + branch setup

The chunk 2 PR will be developed on a feature branch. Per collaboration prefs, feature-branch → PR → merge is the standard pattern even for solo dev.

- [ ] **Step P1: Verify on main, clean working tree**

Run: `git status -sb`
Expected: `## main...origin/main` with no untracked or modified files.

- [ ] **Step P2: Verify on latest main**

Run: `git log -1 --oneline`
Expected: `350527a feat(launch-6): Evidence uploads + DestructionLog certificate upload (#139)` or later.

- [ ] **Step P3: Create feature branch**

Run: `git checkout -b feat/launch-2-incident-breach-memo`
Expected: `Switched to a new branch 'feat/launch-2-incident-breach-memo'`

---

## Task 1: Re-land the orphaned master plan rewrite

The plan rewrite (`6e5ef50`) was authored 2026-04-27 morning but never reached main — only chunk-1's allergy work (`5f4802f`) merged from that branch. The current `docs/plans/2026-04-27-launch-readiness.md` is the original plan, which incorrectly shows chunks 1–4 (reports, allergy, evidence/CEU) instead of the audit-derived chunks 1–17 we're actually executing against. Re-land it as the first commit of this PR so future sessions don't get confused.

**Files:**
- Modify: `docs/plans/2026-04-27-launch-readiness.md`

- [ ] **Step 1.1: Replace plan file with rewritten content + chunk 1 marked done**

Replace the entire contents of `docs/plans/2026-04-27-launch-readiness.md` with the content of `git show 6e5ef50:docs/plans/2026-04-27-launch-readiness.md`, but with the following targeted edits:

1. In the "Where we are right now" section, update the bullet list to reflect post-PR-#139 state:

```markdown
**Live on prod (rev 00135 or later):**
- Reports framework + 6 PDFs (PR #135 merged 2026-04-27)
- Bulk CSV import on credentials/vendors/security-assets (PR #135)
- Allergy module — schema, projections, derivations, UI, quiz, notifications, AllergyExtras (PR #136 merged + prod migrated + seeded)
- Settings sidebar entry + redirect fixes (PR #137 merged)
- Allergy inactivity tracking + competency-due notification (PR #138 merged 2026-04-27)
- Document retention file uploads via polymorphic Evidence subsystem (PR #139 merged 2026-04-27 17:43 UTC)

**Test count:** 452 (445 pre-Evidence + 7 evidence projection tests)
```

2. In section "1. Document retention file uploads — CRITICAL · 1–2 days", change the heading to "1. Document retention file uploads — ✅ DONE (PR #139)" and replace the body with a one-liner: "Polymorphic `Evidence` model + GCS storage helper + DestructionLog as first consumer landed in PR #139. Foundation for chunks 5/6/7 (credentials evidence, BAA storage, training video upload) is now in place."

3. Renumber the chunks: chunk 1 stays "Document retention" (✅ DONE), chunk 2 stays "Incident breach memo PDF + individual notification tracking" (the chunk being implemented now), chunks 3–17 unchanged.

4. In "Pending Noorros operational tasks", add a new bullet at the end: "**Create `guardwell-v2-evidence` GCS bucket** + IAM + CORS + lifecycle + set `GCS_EVIDENCE_BUCKET` env var on Cloud Run service. Without this, the EvidenceUpload widget shows 'GCS not configured' in prod."

- [ ] **Step 1.2: Commit the plan re-land**

Run:
```bash
git add docs/plans/2026-04-27-launch-readiness.md
git commit -m "$(cat <<'EOF'
docs(plan): re-land launch readiness rewrite + mark chunk 1 done

The 2026-04-27 audit-driven plan rewrite (commit 6e5ef50) was authored
but never landed on main. PR #138 squash-merged only the allergy
inactivity work from that branch. Re-applying the rewrite so future
sessions see the correct chunks 1-17 prioritization, with chunk 1
(Document retention file uploads) marked DONE per PR #139.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with the descriptive message.

---

## Task 2: Add `breachDeterminationMemo` to Incident schema

**Files:**
- Modify: `prisma/schema.prisma` (around lines 472–500, in the `Incident` model)

- [ ] **Step 2.1: Add the schema field**

Locate the `Incident` model in `prisma/schema.prisma`. Find the breach-determination block (the lines defining `isBreach`, `factor1Score`, …, `overallRiskScore`, `breachDeterminedAt`). Add the new field immediately after `breachDeterminedAt`:

```prisma
  // HIPAA §164.402 documented breach determination memo. Markdown text
  // entered by the determiner during the wizard; rendered on the breach
  // memo PDF audit response.
  breachDeterminationMemo String? @db.Text
```

- [ ] **Step 2.2: Generate Prisma client + push to local dev DB**

Run:
```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  npx prisma generate
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema.` (idempotent if the column already exists.)

- [ ] **Step 2.3: Verify the column exists in dev**

Run:
```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  npx prisma db execute --stdin <<< 'SELECT column_name FROM information_schema.columns WHERE table_name = '\''Incident'\'' AND column_name = '\''breachDeterminationMemo'\'';'
```

Expected: one row returned, column_name = `breachDeterminationMemo`.

- [ ] **Step 2.4: Commit schema change**

```bash
git add prisma/schema.prisma
git commit -m "schema(incident): add breachDeterminationMemo text column"
```

---

## Task 3: Extend `INCIDENT_BREACH_DETERMINED` event with optional `memoText`

Backward-compatible additive change to v1 — historical events without `memoText` continue to validate; new events can include it. No version bump.

**Files:**
- Modify: `src/lib/events/registry.ts:308-319` — the v1 schema for `INCIDENT_BREACH_DETERMINED`

- [ ] **Step 3.1: Add `memoText` to v1 schema**

Locate the `INCIDENT_BREACH_DETERMINED: { 1: ... }` entry in `src/lib/events/registry.ts`. Replace the v1 Zod object with:

```ts
  INCIDENT_BREACH_DETERMINED: {
    1: z.object({
      incidentId: z.string().min(1),
      factor1Score: z.number().int().min(1).max(5),
      factor2Score: z.number().int().min(1).max(5),
      factor3Score: z.number().int().min(1).max(5),
      factor4Score: z.number().int().min(1).max(5),
      overallRiskScore: z.number().int().min(0).max(100),
      isBreach: z.boolean(),
      affectedCount: z.number().int().min(0),
      ocrNotifyRequired: z.boolean(),
      // HIPAA §164.402 documented memo. Optional in v1 for backward
      // compat with events written before 2026-04-27; UI requires it
      // for new determinations going forward.
      memoText: z.string().max(10000).optional(),
    }),
  },
```

- [ ] **Step 3.2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean. (May surface call-site type errors if downstream code reads the payload — that's task 4 + 5 below.)

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/events/registry.ts
git commit -m "events: add optional memoText to INCIDENT_BREACH_DETERMINED v1"
```

---

## Task 4: Update `projectIncidentBreachDetermined` to write the memo

**Files:**
- Modify: `src/lib/events/projections/incident.ts` (find `projectIncidentBreachDetermined`)

- [ ] **Step 4.1: Read the current projection**

Run: `grep -n "projectIncidentBreachDetermined" src/lib/events/projections/incident.ts`

Inspect the function body. It accepts `{ practiceId, payload }` where payload matches the v1 event schema. The Prisma `update` call sets `factor1Score, factor2Score, factor3Score, factor4Score, overallRiskScore, isBreach, affectedCount, ocrNotifyRequired, breachDeterminedAt, status` and rederives requirements.

- [ ] **Step 4.2: Add `breachDeterminationMemo` to the update**

In the `db.incident.update({ where: { id: incidentId }, data: { ... } })` call, add a single line:

```ts
        breachDeterminationMemo: payload.memoText ?? null,
```

Place it adjacent to the other breach-determination fields (e.g. immediately after `ocrNotifyRequired: payload.ocrNotifyRequired,`). If memoText is undefined (old events), set the column to null.

- [ ] **Step 4.3: Run the existing incident projection tests**

Run: `npx vitest run tests/integration/incident-projection.test.ts 2>&1 | tail -20`
Expected: all existing tests pass (the additive field shouldn't break anything).

If no such test file exists, run the broader incident test suite:

Run: `npx vitest run --grep="incident" 2>&1 | tail -20`
Expected: all incident-related tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add src/lib/events/projections/incident.ts
git commit -m "events(incident): persist memoText on breach-determination projection"
```

---

## Task 5: Update `completeBreachDeterminationAction` to accept + forward memo

**Files:**
- Modify: `src/app/(dashboard)/programs/incidents/actions.ts:116-207`

- [ ] **Step 5.1: Add `memoText` to `BreachInput` Zod schema**

Locate the `BreachInput` definition (line ~116). Replace with:

```ts
const BreachInput = z.object({
  incidentId: z.string().min(1),
  factor1Score: z.number().int().min(1).max(5),
  factor2Score: z.number().int().min(1).max(5),
  factor3Score: z.number().int().min(1).max(5),
  factor4Score: z.number().int().min(1).max(5),
  affectedCount: z.number().int().min(0),
  // HIPAA §164.402 documented analysis. Required ≥40 chars to ensure a
  // substantive memo; nullable allowed for the legacy/test path that
  // doesn't yet pass it. UI enforces non-empty before submit.
  memoText: z.string().min(40).max(10000).nullable().optional(),
});
```

- [ ] **Step 5.2: Forward `memoText` into the event payload**

In `completeBreachDeterminationAction`, locate the `payload` literal (around line 148). Add `memoText: parsed.memoText ?? undefined,` to the object. (Use `undefined` not `null` here so the optional field is omitted when not provided — Zod's `.optional()` accepts this and the projection's `payload.memoText ?? null` handles either form.)

The full payload becomes:

```ts
  const payload = {
    incidentId: parsed.incidentId,
    factor1Score: parsed.factor1Score,
    factor2Score: parsed.factor2Score,
    factor3Score: parsed.factor3Score,
    factor4Score: parsed.factor4Score,
    overallRiskScore,
    isBreach,
    affectedCount: parsed.affectedCount,
    ocrNotifyRequired,
    memoText: parsed.memoText ?? undefined,
  };
```

- [ ] **Step 5.3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5.4: Commit**

```bash
git add src/app/(dashboard)/programs/incidents/actions.ts
git commit -m "actions(incident): accept memoText on breach determination"
```

---

## Task 6: Add memo textarea to BreachDeterminationWizard

**Files:**
- Modify: `src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx`

- [ ] **Step 6.1: Read the wizard to understand current shape**

Run: `cat src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx`

The component currently renders four 1–5 score selectors + an affected-count input + a submit button. State is held via `useState` for each factor + affectedCount. On submit it calls `completeBreachDeterminationAction({ incidentId, factor1Score, ..., affectedCount })`.

- [ ] **Step 6.2: Add a `memoText` state variable + textarea**

Add a `useState<string>("")` for `memoText`. Render a `<textarea>` block AFTER the affected-count input and BEFORE the submit row. The textarea:
- Has a label: "Documented analysis (HIPAA §164.402)"
- Has helper copy below the label: "Briefly describe the nature of the PHI involved, the unauthorized recipient, whether PHI was actually viewed/acquired, and the extent risk has been mitigated. This memo is rendered on the breach determination PDF for audit response."
- Is `required`
- Has `minLength={40}` and `maxLength={10000}`
- Has at least 6 rows (`rows={6}`)
- Uses the project's existing `<Textarea>` from `@/components/ui/textarea` if one exists; otherwise a `<textarea>` styled with the project's input class (look at how the description field is rendered in the report-incident form for the existing convention).

- [ ] **Step 6.3: Pass `memoText` to the action call**

In the `onSubmit` handler, include `memoText` in the action call:

```ts
await completeBreachDeterminationAction({
  incidentId,
  factor1Score,
  factor2Score,
  factor3Score,
  factor4Score,
  affectedCount,
  memoText,
});
```

- [ ] **Step 6.4: Disable submit until memoText.trim().length >= 40**

The submit button's `disabled` prop should also OR `memoText.trim().length < 40` so the user can't submit without a substantive memo.

- [ ] **Step 6.5: Run dev server, manually verify wizard flow**

Run: `npm run dev` in a separate terminal, navigate to a test incident detail page, walk through the wizard, confirm:
- Memo field is visible and required
- Submit blocked when memo < 40 chars
- After submit, the determination card renders below (as before) — verify subsequent task adds the memo display

(Skip this step if no dev server is feasible; tests in Task 8 cover the same behavior.)

- [ ] **Step 6.6: Commit**

```bash
git add src/app/\(dashboard\)/programs/incidents/\[id\]/BreachDeterminationWizard.tsx
git commit -m "ui(incident): add memo textarea to breach determination wizard"
```

---

## Task 7: Surface "Generate breach memo" CTA on the incident detail page

**Files:**
- Modify: `src/app/(dashboard)/programs/incidents/[id]/page.tsx:144-178` — the existing breach-determination summary card

- [ ] **Step 7.1: Render the persisted memo text below the score row**

Inside the existing summary card (the `else` branch of the `!hasDetermined` ternary, lines 145–177), AFTER the existing factor-score paragraph and breach-or-not paragraph, render:

```tsx
            {incident.breachDeterminationMemo && (
              <div className="mt-3 space-y-1 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Documented analysis
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {incident.breachDeterminationMemo}
                </p>
              </div>
            )}
```

- [ ] **Step 7.2: Render a "Generate breach memo PDF" download link**

Inside the same summary card, after the memo text block, add a download anchor:

```tsx
            <div className="pt-2">
              <Link
                href={`/api/audit/incident-breach-memo/${incident.id}` as Route}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                target="_blank"
                rel="noopener noreferrer"
              >
                Generate breach memo PDF
              </Link>
            </div>
```

(`Link` is already imported from `next/link` at the top of the file. The `as Route` cast matches the project's typed-routes convention used elsewhere in this file.)

- [ ] **Step 7.3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7.4: Commit**

```bash
git add src/app/\(dashboard\)/programs/incidents/\[id\]/page.tsx
git commit -m "ui(incident): surface memo + 'Generate breach memo PDF' on detail page"
```

---

## Task 8: Build the breach memo PDF document component

The PDF includes (in this order):
1. Practice header (name, primary state)
2. Title block: "HIPAA §164.402 Breach Determination Memo" + incident title
3. Incident summary block: discovered date, type, severity, affected count, PHI involved Y/N, patient state if known
4. Four-factor analysis block: each factor 1–5 with a static description
5. Decision block: overall risk score, breach yes/no, OCR notification required Y/N, major-breach (≥500) badge if applicable
6. Memo narrative (the persisted `breachDeterminationMemo`, whitespace preserved)
7. Notification timeline: HHS / affected individuals / media / state AG dates with "Not yet notified" placeholder where empty
8. Footer with generated-at timestamp + "Confidential" tag

**Files:**
- Create: `src/lib/audit/incident-breach-memo-pdf.tsx`

- [ ] **Step 8.1: Create the PDF component**

Create `src/lib/audit/incident-breach-memo-pdf.tsx`:

```tsx
// src/lib/audit/incident-breach-memo-pdf.tsx
//
// HIPAA §164.402 breach determination memo PDF — single incident,
// substantive analysis. Generated when the practice needs to surface
// the documented breach decision to OCR auditors, board, or
// state attorney general per individual notification rules.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  practice: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 4,
  },
  incidentTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    width: 130,
    color: "#64748B",
    fontSize: 9,
  },
  metaValue: {
    flex: 1,
    fontSize: 10,
    color: "#1E293B",
  },
  factorBlock: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  factorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  factorTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#1E3A5F",
  },
  factorScore: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#1E3A5F",
  },
  factorDesc: {
    fontSize: 9,
    color: "#475569",
    lineHeight: 1.4,
  },
  decisionBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
  },
  decisionBreach: {
    backgroundColor: "#FEF2F2",
    borderColor: "#B91C1C",
  },
  decisionNotBreach: {
    backgroundColor: "#F0FDF4",
    borderColor: "#15803D",
  },
  decisionLabel: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 4,
  },
  decisionLabelBreach: { color: "#B91C1C" },
  decisionLabelNotBreach: { color: "#15803D" },
  decisionDetail: {
    fontSize: 9,
    color: "#475569",
    lineHeight: 1.4,
  },
  memoText: {
    fontSize: 10,
    color: "#1E293B",
    lineHeight: 1.5,
  },
  notifRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  notifLabel: {
    width: 180,
    fontSize: 9,
    color: "#475569",
  },
  notifValue: {
    flex: 1,
    fontSize: 9,
    color: "#1E293B",
  },
  notifPending: {
    flex: 1,
    fontSize: 9,
    color: "#D97706",
    fontStyle: "italic",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 8,
    color: "#94A3B8",
    textAlign: "center",
  },
});

const FACTOR_DESCRIPTIONS: ReadonlyArray<{ title: string; desc: string }> = [
  {
    title: "Factor 1 — Nature and extent of PHI involved",
    desc: "Includes the types of identifiers (e.g. SSN, financial account, clinical detail) and the likelihood the information could be used to re-identify or harm the individual.",
  },
  {
    title: "Factor 2 — Unauthorized person who used or received the PHI",
    desc: "Considers whether the recipient is bound by HIPAA or another confidentiality obligation. A recipient inside the workforce of another covered entity is lower-risk than an unrelated external party.",
  },
  {
    title: "Factor 3 — Whether PHI was actually acquired or viewed",
    desc: "Forensic evidence of access (logs, recipient confirmation, recovered media) vs. mere opportunity for access. Mailings returned unopened weigh lower; confirmed reads weigh higher.",
  },
  {
    title: "Factor 4 — Extent to which the risk to the PHI has been mitigated",
    desc: "Includes assurances from the recipient (e.g. signed destruction certification), recovered devices, password resets, and other corrective actions that reduce the probability of misuse.",
  },
];

export interface BreachMemoNotification {
  ocrNotifiedAt: Date | null;
  affectedIndividualsNotifiedAt: Date | null;
  mediaNotifiedAt: Date | null;
  stateAgNotifiedAt: Date | null;
}

export interface BreachMemoInput {
  practiceName: string;
  practiceState: string;
  generatedAt: Date;
  incident: {
    title: string;
    type: string;
    severity: string;
    discoveredAt: Date;
    phiInvolved: boolean;
    patientState: string | null;
    affectedCount: number | null;
    factor1Score: number;
    factor2Score: number;
    factor3Score: number;
    factor4Score: number;
    overallRiskScore: number;
    isBreach: boolean;
    ocrNotifyRequired: boolean;
    breachDeterminationMemo: string | null;
    breachDeterminedAt: Date;
  };
  notifications: BreachMemoNotification;
}

const TYPE_LABELS: Record<string, string> = {
  PRIVACY: "Privacy",
  SECURITY: "Security",
  OSHA_RECORDABLE: "OSHA recordable",
  NEAR_MISS: "Near miss",
  DEA_THEFT_LOSS: "DEA theft/loss",
  CLIA_QC_FAILURE: "CLIA QC failure",
  TCPA_COMPLAINT: "TCPA complaint",
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function IncidentBreachMemoDocument({
  input,
}: {
  input: BreachMemoInput;
}) {
  const { incident, notifications } = input;
  const factors = [
    incident.factor1Score,
    incident.factor2Score,
    incident.factor3Score,
    incident.factor4Score,
  ];
  const isMajor = (incident.affectedCount ?? 0) >= 500;

  return (
    <Document
      title={`Breach Determination Memo — ${incident.title}`}
      author="GuardWell"
      subject="HIPAA §164.402 breach determination"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.title}>HIPAA §164.402 Breach Determination Memo</Text>
        <Text style={s.incidentTitle}>{incident.title}</Text>

        <Text style={s.sectionTitle}>Incident Summary</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Discovered</Text>
          <Text style={s.metaValue}>{formatDate(incident.discoveredAt)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Determination recorded</Text>
          <Text style={s.metaValue}>
            {formatDate(incident.breachDeterminedAt)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Type</Text>
          <Text style={s.metaValue}>
            {TYPE_LABELS[incident.type] ?? incident.type}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Severity</Text>
          <Text style={s.metaValue}>{incident.severity}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>PHI involved</Text>
          <Text style={s.metaValue}>{incident.phiInvolved ? "Yes" : "No"}</Text>
        </View>
        {incident.patientState && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Patient state</Text>
            <Text style={s.metaValue}>{incident.patientState}</Text>
          </View>
        )}
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Affected individuals</Text>
          <Text style={s.metaValue}>
            {incident.affectedCount === null
              ? "Unknown"
              : incident.affectedCount.toLocaleString("en-US")}
            {isMajor ? "  (Major breach — ≥500)" : ""}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Four-Factor Risk Analysis</Text>
        {FACTOR_DESCRIPTIONS.map((f, i) => (
          <View key={i} style={s.factorBlock}>
            <View style={s.factorHeader}>
              <Text style={s.factorTitle}>{f.title}</Text>
              <Text style={s.factorScore}>{factors[i]} / 5</Text>
            </View>
            <Text style={s.factorDesc}>{f.desc}</Text>
          </View>
        ))}

        <View
          style={[
            s.decisionBox,
            incident.isBreach ? s.decisionBreach : s.decisionNotBreach,
          ]}
        >
          <Text
            style={[
              s.decisionLabel,
              incident.isBreach
                ? s.decisionLabelBreach
                : s.decisionLabelNotBreach,
            ]}
          >
            {incident.isBreach
              ? "Determination: Reportable Breach"
              : "Determination: Not a Reportable Breach"}
          </Text>
          <Text style={s.decisionDetail}>
            Composite risk score: {incident.overallRiskScore} / 100.{" "}
            {incident.isBreach
              ? incident.ocrNotifyRequired
                ? "HHS OCR notification required within 60 days of discovery."
                : "OCR notification not required."
              : "Low probability that PHI was compromised."}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Documented Analysis</Text>
        <Text style={s.memoText}>
          {incident.breachDeterminationMemo ??
            "(No memo recorded with this determination.)"}
        </Text>

        <Text style={s.sectionTitle}>Notification Timeline</Text>
        <NotifRow
          label="HHS Office for Civil Rights"
          notifiedAt={notifications.ocrNotifiedAt}
          required={incident.isBreach && incident.ocrNotifyRequired}
        />
        <NotifRow
          label="Affected individuals"
          notifiedAt={notifications.affectedIndividualsNotifiedAt}
          required={incident.isBreach}
        />
        <NotifRow
          label="Media (≥500 affected)"
          notifiedAt={notifications.mediaNotifiedAt}
          required={incident.isBreach && isMajor}
        />
        <NotifRow
          label="State Attorney General"
          notifiedAt={notifications.stateAgNotifiedAt}
          required={incident.isBreach}
        />

        <Text style={s.footer} fixed>
          Generated {formatDateTime(input.generatedAt)} · GuardWell · Confidential
        </Text>
      </Page>
    </Document>
  );
}

function NotifRow({
  label,
  notifiedAt,
  required,
}: {
  label: string;
  notifiedAt: Date | null;
  required: boolean;
}) {
  const value = notifiedAt
    ? `Notified ${formatDate(notifiedAt)}`
    : required
      ? "Not yet notified"
      : "Not required";
  const styleLine =
    !notifiedAt && required ? s.notifPending : s.notifValue;
  return (
    <View style={s.notifRow}>
      <Text style={s.notifLabel}>{label}</Text>
      <Text style={styleLine}>{value}</Text>
    </View>
  );
}
```

- [ ] **Step 8.2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/audit/incident-breach-memo-pdf.tsx
git commit -m "audit(pdf): IncidentBreachMemoDocument React-PDF component"
```

---

## Task 9: Build the API route to render the PDF

**Files:**
- Create: `src/app/api/audit/incident-breach-memo/[id]/route.tsx`

- [ ] **Step 9.1: Create the route**

Create `src/app/api/audit/incident-breach-memo/[id]/route.tsx`:

```tsx
// src/app/api/audit/incident-breach-memo/[id]/route.tsx
//
// GET /api/audit/incident-breach-memo/[id]
// Renders a HIPAA §164.402 breach determination memo PDF for a single
// incident. 404 if the incident is not in this practice or no breach
// determination has been recorded yet.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { IncidentBreachMemoDocument } from "@/lib/audit/incident-breach-memo-pdf";

export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const incident = await db.incident.findUnique({
    where: { id },
    select: {
      practiceId: true,
      title: true,
      type: true,
      severity: true,
      discoveredAt: true,
      phiInvolved: true,
      patientState: true,
      affectedCount: true,
      factor1Score: true,
      factor2Score: true,
      factor3Score: true,
      factor4Score: true,
      overallRiskScore: true,
      isBreach: true,
      ocrNotifyRequired: true,
      breachDeterminationMemo: true,
      breachDeterminedAt: true,
      ocrNotifiedAt: true,
      affectedIndividualsNotifiedAt: true,
      mediaNotifiedAt: true,
      stateAgNotifiedAt: true,
    },
  });

  if (!incident || incident.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    incident.breachDeterminedAt === null ||
    incident.factor1Score === null ||
    incident.factor2Score === null ||
    incident.factor3Score === null ||
    incident.factor4Score === null ||
    incident.overallRiskScore === null ||
    incident.isBreach === null ||
    incident.ocrNotifyRequired === null
  ) {
    return NextResponse.json(
      { error: "Breach determination has not been recorded yet" },
      { status: 404 },
    );
  }

  const pdfBuffer = await renderToBuffer(
    <IncidentBreachMemoDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        generatedAt: new Date(),
        incident: {
          title: incident.title,
          type: incident.type,
          severity: incident.severity,
          discoveredAt: incident.discoveredAt,
          phiInvolved: incident.phiInvolved,
          patientState: incident.patientState,
          affectedCount: incident.affectedCount,
          factor1Score: incident.factor1Score,
          factor2Score: incident.factor2Score,
          factor3Score: incident.factor3Score,
          factor4Score: incident.factor4Score,
          overallRiskScore: incident.overallRiskScore,
          isBreach: incident.isBreach,
          ocrNotifyRequired: incident.ocrNotifyRequired,
          breachDeterminationMemo: incident.breachDeterminationMemo,
          breachDeterminedAt: incident.breachDeterminedAt,
        },
        notifications: {
          ocrNotifiedAt: incident.ocrNotifiedAt,
          affectedIndividualsNotifiedAt: incident.affectedIndividualsNotifiedAt,
          mediaNotifiedAt: incident.mediaNotifiedAt,
          stateAgNotifiedAt: incident.stateAgNotifiedAt,
        },
      }}
    />,
  );

  const slug = incident.title.replace(/[^A-Za-z0-9]/g, "-").slice(0, 60);
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="breach-memo-${slug}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 9.2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9.3: Commit**

```bash
git add src/app/api/audit/incident-breach-memo/\[id\]/route.tsx
git commit -m "api(audit): incident breach memo PDF route"
```

---

## Task 10: Integration tests

Three test cases:
1. **happy path** — incident with breach determined → 200 + PDF buffer + key strings present
2. **incident exists, breach not determined** — 404 with the expected error message
3. **incident in another practice** — 404 (cross-tenant guard)

**Files:**
- Create: `tests/integration/incident-breach-memo-pdf.test.ts`

- [ ] **Step 10.1: Read an existing audit-PDF integration test for style**

Run: `ls tests/integration/ | grep -i 'audit\|pdf\|incident'`

Open the most relevant one (likely `incident-summary.test.ts` or similar). Note the conventions:
- How auth is mocked / faked
- How the test creates a Practice + PracticeUser fixture
- How the route handler is invoked (typically via direct `GET()` call vs. `fetch` against an `app.test()` runner)
- How the PDF buffer is asserted on (text extraction or just `.byteLength > 0` + `.toString('utf8')` for the raw text stream)

If no audit-PDF integration test exists yet, look at `tests/integration/projection-` files for the practice-fixture pattern + `tests/integration/api-` for the route-invocation pattern.

- [ ] **Step 10.2: Write the test file**

Create `tests/integration/incident-breach-memo-pdf.test.ts`:

```ts
// tests/integration/incident-breach-memo-pdf.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/audit/incident-breach-memo/[id]/route";
import { db } from "@/lib/db";
import {
  installAuthFixture,
  resetDb,
  seedPracticeWithUser,
} from "../helpers"; // adjust import to actual helper module name discovered in 10.1

describe("GET /api/audit/incident-breach-memo/[id]", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 200 + PDF when breach determination + memo recorded", async () => {
    const { practice, user } = await seedPracticeWithUser();
    installAuthFixture(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Mailing room mis-routing — 12 patients",
        type: "PRIVACY",
        severity: "HIGH",
        status: "UNDER_INVESTIGATION",
        description: "12 statements mailed to wrong addresses.",
        phiInvolved: true,
        patientState: "CA",
        affectedCount: 12,
        discoveredAt: new Date("2026-04-20T10:00:00Z"),
        reportedByUserId: user.id,
        factor1Score: 4,
        factor2Score: 3,
        factor3Score: 4,
        factor4Score: 2,
        overallRiskScore: 65,
        isBreach: true,
        ocrNotifyRequired: true,
        breachDeterminedAt: new Date("2026-04-21T15:00:00Z"),
        breachDeterminationMemo:
          "Statements containing patient name + DOB + service code mailed to wrong addresses. Recipients are unrelated third parties; no signed assurance of destruction. Risk classified as moderate-to-high probability of compromise.",
      },
    });

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000); // sanity: a real PDF
    const raw = Buffer.from(buf).toString("latin1");
    expect(raw).toMatch(/HIPAA/);
    expect(raw).toMatch(/Breach Determination Memo/i);
    // The four factor descriptions should appear (PDF font streams encode
    // text as readable substrings for Helvetica)
    expect(raw).toMatch(/Factor 1/);
  });

  it("returns 404 when breach determination has not been recorded yet", async () => {
    const { practice, user } = await seedPracticeWithUser();
    installAuthFixture(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Open incident pending review",
        type: "PRIVACY",
        severity: "MEDIUM",
        status: "OPEN",
        description: "Awaiting determination.",
        phiInvolved: true,
        affectedCount: 5,
        discoveredAt: new Date("2026-04-25T10:00:00Z"),
        reportedByUserId: user.id,
      },
    });

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not been recorded/i);
  });

  it("returns 404 when incident belongs to a different practice", async () => {
    const { practice: p1, user: u1 } = await seedPracticeWithUser();
    const { practice: p2 } = await seedPracticeWithUser();
    installAuthFixture(u1); // signed in to practice 1

    const otherIncident = await db.incident.create({
      data: {
        practiceId: p2.id, // belongs to practice 2
        title: "Cross-tenant test",
        type: "PRIVACY",
        severity: "LOW",
        status: "RESOLVED",
        description: "Some other practice's incident.",
        phiInvolved: false,
        affectedCount: 0,
        discoveredAt: new Date("2026-04-22T10:00:00Z"),
        reportedByUserId: u1.id,
        factor1Score: 1,
        factor2Score: 1,
        factor3Score: 1,
        factor4Score: 1,
        overallRiskScore: 20,
        isBreach: false,
        ocrNotifyRequired: false,
        breachDeterminedAt: new Date("2026-04-22T11:00:00Z"),
        breachDeterminationMemo:
          "Test memo for cross-tenant guard. Should be inaccessible to practice 1's user.",
      },
    });

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: otherIncident.id }),
    });

    expect(res.status).toBe(404);
  });
});
```

**Note:** The exact import paths for `installAuthFixture`, `resetDb`, `seedPracticeWithUser` (or whatever the project's existing helpers are called) MUST be discovered in step 10.1 and substituted in. If the project uses a different fixture pattern (e.g. `vi.mock` of `requireUser` directly), adapt the auth-mock approach accordingly. Don't invent helpers that don't exist.

- [ ] **Step 10.3: Run the new tests**

Run: `npx vitest run tests/integration/incident-breach-memo-pdf.test.ts`
Expected: 3 pass.

- [ ] **Step 10.4: Run the full suite to verify no regressions**

Run: `npx vitest run 2>&1 | tail -10`
Expected: 455 passing (was 452, +3 new), 0 failing.

- [ ] **Step 10.5: Commit**

```bash
git add tests/integration/incident-breach-memo-pdf.test.ts
git commit -m "test(audit): incident breach memo PDF integration tests"
```

---

## Task 11: Verification + push

- [ ] **Step 11.1: tsc clean**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11.2: Lint clean**

Run: `npm run lint 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 11.3: Full test suite**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 455 passing, 0 failing.

- [ ] **Step 11.4: Push the feature branch**

Run: `git push -u origin feat/launch-2-incident-breach-memo`
Expected: branch pushed; the URL for opening a PR appears in stderr — surface it back to the user.

---

## Task 12: Prod schema migration (BEFORE merging the PR)

The repo still lacks a Cloud Build migration step. Manual `prisma db push` against prod is required before merge so the deploy doesn't crash on missing column.

- [ ] **Step 12.1: Confirm prod DATABASE_URL secret is current**

Run: `gcloud secrets versions list DATABASE_URL --project=guardwell-prod 2>&1 | head -3`
Expected: at least one ACTIVE version.

- [ ] **Step 12.2: Run prisma db push against prod**

Use the same pattern that worked for PR #136, #138, #139. From a terminal with the cloud-sql-proxy running locally, set DATABASE_URL to the proxy connection string, then:

```bash
DATABASE_URL="<prod-via-proxy-url>" npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema.`

If the user uses a different mechanism (signed URL via secret + DIRECT_URL env), match that pattern. Verify which approach was used for the most recent successful migration by reading `git log --oneline -- prisma/migrations/ scripts/migrate-prod*.sh` or checking the launch-readiness memory.

- [ ] **Step 12.3: Verify the column exists in prod**

```bash
DATABASE_URL="<prod-via-proxy-url>" npx prisma db execute --stdin <<< 'SELECT column_name FROM information_schema.columns WHERE table_name = '\''Incident'\'' AND column_name = '\''breachDeterminationMemo'\'';'
```

Expected: 1 row, column_name = `breachDeterminationMemo`.

---

## Task 13: PR open + spec compliance review (subagent)

- [ ] **Step 13.1: Open the PR**

```bash
gh pr create --title "feat(launch-2): incident breach memo PDF + memo persistence" --body "$(cat <<'EOF'
## Summary

Chunk 2 of the launch-readiness plan — generates a HIPAA §164.402 breach determination memo PDF for any incident where a breach decision has been recorded.

- New `breachDeterminationMemo` text column on `Incident`
- Optional `memoText` field on `INCIDENT_BREACH_DETERMINED` v1 event (backward compat, no version bump)
- Wizard now requires a substantive (≥40 char) memo before submission
- New PDF route at `GET /api/audit/incident-breach-memo/[id]`
- "Generate breach memo PDF" CTA on the incident detail page after determination is recorded
- Re-lands the orphaned launch-readiness master plan rewrite (commit 6e5ef50, never merged)

## Test plan

- [x] 3 new integration tests (happy path / no determination / cross-tenant guard)
- [x] Full suite: 455 passing (was 452)
- [x] Tsc clean, lint clean
- [x] Prod schema migrated via `prisma db push` before merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL from output.

- [ ] **Step 13.2: Dispatch spec compliance review subagent**

After the PR is open, the orchestrator (caller) dispatches a spec-compliance review subagent with this plan as input. The reviewer checks:
1. Every Task acceptance bullet is satisfied in the diff
2. No deviation from the file paths or function signatures specified
3. The PDF actually contains all 8 sections listed in Task 8 intro
4. Memo textarea is required AND ≥40 char enforced both client-side and server-side
5. Cross-tenant guard is in place at the route level (not just the page level)
6. The orphan plan re-land matches the chunk-1-done edits in Task 1.1

Output: list of deviations with file:line references. If non-empty → Task 14.

---

## Task 14: Apply spec fixes (only if step 13.2 found deviations)

- [ ] **Step 14.1: For each deviation, dispatch an implementer subagent or fix inline**

Address each finding. Re-run `npx tsc --noEmit` + `npx vitest run` after each fix. Commit fixes incrementally with descriptive messages.

---

## Task 15: Code quality review (subagent)

- [ ] **Step 15.1: Dispatch code quality review subagent**

Same dispatch pattern as PR #139. Reviewer checks for:
- Critical: SQL injection vectors, auth bypasses, cross-tenant leaks, missing null guards
- Important: error handling, mime/range validation, Zod schema completeness, redundant DB queries, missing tests for edge cases
- Minor: naming, dead code, style, comment quality

Output: Critical/Important/Minor counts + specific file:line references.

---

## Task 16: Apply must-fix code quality items (only if step 15.1 found Critical or Important)

- [ ] **Step 16.1: Address each Critical + Important finding**

Defer Minor unless trivial. Document deferred Minors in the launch-readiness memory under "Deferred minor cleanup items" for the next chunk's pre-work.

- [ ] **Step 16.2: Re-run full test suite**

Run: `npx vitest run 2>&1 | tail -5`
Expected: still passing.

---

## Task 17: Merge

- [ ] **Step 17.1: Verify all checks pass**

Run: `gh pr view <PR#> --json state,mergeStateStatus,statusCheckRollup`
Expected: `mergeStateStatus: CLEAN` (or `UNSTABLE` if no required checks configured — confirm with user).

- [ ] **Step 17.2: Merge**

Run: `gh pr merge <PR#> --squash --delete-branch`
Expected: merged + branch deleted.

- [ ] **Step 17.3: Update memory**

Update `C:/Users/tcarl/.claude/projects/D--GuardWell/memory/launch-readiness-2026-04-27.md` with chunk 2 completion: PR number + merge time + test count + any deferred minor items.

---

## Self-Review

After writing the plan, the writer (this session) checked:

**Spec coverage** — every requirement in the orphaned plan's chunk 2 description is covered:
- ✅ HIPAA §164.402 documented breach memo: Tasks 2 (schema), 5–6 (capture), 8–9 (render)
- ✅ `/api/audit/incident-breach-memo-pdf/[id]`: Task 9 (route)
- ⚠️ Note: orphan plan said "Add `notifiedIndividualsAt`, `notifiedMediaAt`, `notifiedStateAgAt` DateTime fields to `Incident`" — survey confirms these ALREADY EXIST (with slightly different names: `affectedIndividualsNotifiedAt`, `mediaNotifiedAt`, `stateAgNotifiedAt`). No schema work needed for those.
- ✅ "UI to record notification dates as part of the breach response flow": already implemented by `NotificationLog` component (no change needed)
- ✅ "Surface 'Generate breach memo' once status moves to RESOLVED (or earlier if user marks `breachDetermined=true`)": Task 7 — gated on `breachDeterminedAt !== null` which is set as soon as the wizard completes (i.e. as soon as `isBreach` is recorded), satisfying the "earlier" path

**Placeholder scan** — no TBD/TODO/"add appropriate error handling"/"similar to Task N" placeholders. Every code block is complete and ready to drop in.

**Type consistency** — `breachDeterminationMemo` (column) and `memoText` (event payload field) are intentionally different to match the existing pattern where event payload field names mirror the action input (`memoText` is what the wizard sends), and projection mapping is the seam where it lands as a column. The projection in Task 4 explicitly does `breachDeterminationMemo: payload.memoText ?? null`. The `IncidentBreachMemoDocument`'s `BreachMemoInput` type uses `breachDeterminationMemo` (column name) since it's reading from the row directly.

---

## Execution Handoff

This plan is built for **subagent-driven execution** per project standard (per collaboration prefs: superpowers:subagent-driven-development is the recommended mode for v2 implementation work).

The orchestrator dispatches a fresh subagent per task block (Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 each get their own subagent), reviews the diff between tasks, and runs the spec/quality review subagents at Tasks 13/15.

Tasks P, 11, 12, 17 are operator/orchestrator actions — they should be executed by the calling session, not delegated.
