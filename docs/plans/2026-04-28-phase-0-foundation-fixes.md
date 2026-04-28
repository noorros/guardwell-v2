# Phase 0 — Foundation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the visible defects and missing operational documentation in v2 so subsequent phases stack on a clean foundation.

**Architecture:** Three small code changes (Track auto-completion backfill, manual Sync action+button, `.env.example` parity), one defensive route redirect, and two operational runbooks documenting user-blocking actions (Resend domain verification + Cloud SQL tier upsize). Each lands as a separate PR; each is Chrome-verified or runbook-reviewed.

**Tech Stack:** Next.js 16 App Router · Server Actions · Prisma 5.22 · PostgreSQL · Vitest · Cloud Run · Cloud SQL · Resend.

---

## Scope confirmed against current code state (2026-04-28)

The master plan listed 8 candidate Phase 0 items. Code verification narrowed the real scope to 5:

| Item | Verified state | Disposition |
|---|---|---|
| Sidebar `Get started` 404 | Sidebar correctly hrefs `/programs/track`; the 404 was direct navigation to a non-route. | Drop — but add defensive redirect from `/programs/get-started` (Task 4). |
| Compliance Track auto-completion sync | Real bug. `rederiveRequirementStatus` auto-completes only on forward events. Tracks generated for practices with pre-existing COMPLIANT requirements stay at 0% complete. | Fix — Task 1 (backfill at generation) + Task 2 (manual Sync action). |
| Score-ring "Not assessed" empty state | Already shipped. `<ScoreRing assessed={…}>` + `<ModuleHeader assessed={…}>` exist; module page passes `assessed={items.length > 0}`. | Skip — already done. |
| Cross-file integration test pollution | Resolved. 532/532 tests pass under combined run. `tests/setup.ts` cleanup + `process.env.RESEND_API_KEY` deletion + `UPSTASH_DISABLE=1` already present. | Skip — already done. |
| Resend domain verification | User-blocking; cron + templates ready, domain unverified. | Document — Task 5. |
| Cloud SQL tier upsize | Pending before customer traffic. | Document — Task 5. |
| Notification.subjectType audit | Belongs in Phase 7 (Notification depth), not Phase 0. | Defer to Phase 7. |
| `.env.example` parity | 2 missing vars (`APP_URL`, `GOOGLE_APPLICATION_CREDENTIALS`). | Fix — Task 3. |

---

## File structure

Files this plan creates or modifies:

```
src/lib/events/projections/track.ts           Modify: extend projectTrackGenerated to backfill
src/app/(dashboard)/programs/track/actions.ts  Modify: add syncTrackFromEvidenceAction
src/app/(dashboard)/programs/track/page.tsx    Modify: render <SyncButton/> in header
src/app/(dashboard)/programs/track/SyncButton.tsx       Create: client component
src/app/(dashboard)/programs/track/SyncButton.test.tsx  Create: jsdom test
src/app/programs/get-started/page.tsx          Create: thin redirect file (defensive)
.env.example                                    Modify: add 2 missing vars

tests/integration/track-backfill.test.ts        Create: covers Task 1
tests/integration/track-sync-action.test.ts     Create: covers Task 2

docs/runbooks/resend-domain.md                  Create: Task 5
docs/runbooks/cloud-sql-tier.md                 Create: Task 5
```

PR boundaries:
- **PR 1** — Task 1 (backfill at track generation). Smallest, independent.
- **PR 2** — Task 2 (manual Sync action + button + Chrome-verify). Depends on Task 1's helper extraction.
- **PR 3** — Task 3 (`.env.example`) + Task 4 (defensive redirect). Two tiny diffs bundled.
- **PR 4** — Task 5 (two runbooks). Doc-only.

Each PR is Chrome-verified where applicable (PR 2) and includes a "what verified" line in the PR body.

---

## Pre-flight checks

Run these once before starting Task 1. They establish the green baseline.

- [ ] **Confirm Postgres container running**

Run:
```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep guardwell-v2-pg
```
Expected: `guardwell-v2-pg  0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp`

If missing:
```bash
docker start guardwell-v2-pg
```

- [ ] **Confirm full test suite passes baseline**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npm test
```
Expected: `Test Files  76 passed (76)` and `Tests  532 passed (532)`. If any failure, stop and investigate before adding new code.

- [ ] **Confirm typecheck clean**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx tsc --noEmit
```
Expected: zero output, exit 0.

- [ ] **Confirm `main` branch + clean tree**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git status
```
Expected: `On branch main` and `nothing to commit, working tree clean` (untracked files OK).

- [ ] **Confirm in-sync with origin**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git fetch origin && git status -sb
```
Expected: `## main...origin/main` (no `[ahead]` or `[behind]`).

If any check fails, halt this plan and resolve before proceeding.

---

## Task 1 — Backfill Track tasks at generation time

**Files:**
- Modify: `src/lib/events/projections/track.ts`
- Create: `tests/integration/track-backfill.test.ts`

**Why:** When a practice generates its Compliance Track AFTER it has already accumulated COMPLIANT requirements (e.g., onboarding finished, then user clicks /programs/track for the first time), the existing `rederiveRequirementStatus` auto-complete only catches forward events. Tasks whose `requirementCode` already matches a COMPLIANT `ComplianceItem` at generation time stay open. Verified live: practice `Prod Smoke Test` shows HIPAA score 89 / Track ring 0%.

The fix runs an inline pass at the end of `projectTrackGenerated` that walks the just-created tasks, checks for matching COMPLIANT items, and emits `TRACK_TASK_COMPLETED` events with `reason: "DERIVED"`. Same write path as the existing rederive auto-complete — no new event type, no schema change.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/track-backfill.test.ts`:

```typescript
// tests/integration/track-backfill.test.ts
//
// Phase 0 / Task 1: when a Compliance Track is freshly generated for a
// practice that ALREADY has matching COMPLIANT ComplianceItems, the
// generation projection backfills the matching tasks to completed.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-bf-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Backfill Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

const PROFILE_BASELINE = {
  hasInHouseLab: false,
  dispensesControlledSubstances: false,
  medicareParticipant: false,
  billsMedicaid: false,
  subjectToMacraMips: false,
  sendsAutomatedPatientMessages: false,
  compoundsAllergens: false,
} as const;

describe("Compliance Track backfill at generation", () => {
  it("auto-completes tasks whose requirementCode is already COMPLIANT when track is generated", async () => {
    const { user, practice } = await seedFreshPractice();

    // Pre-seed a COMPLIANT ComplianceItem for HIPAA_PRIVACY_OFFICER
    // BEFORE the track is generated. The framework + requirement may
    // already exist from prior seed runs; upsert keeps this resilient.
    const framework = await db.regulatoryFramework.upsert({
      where: { code: "HIPAA" },
      update: {},
      create: {
        code: "HIPAA",
        name: "HIPAA",
        description: "test",
        jurisdiction: "federal",
        weightDefault: 0.25,
        scoringStrategy: "STANDARD_CHECKLIST",
        sortOrder: 10,
      },
    });
    const requirement = await db.regulatoryRequirement.upsert({
      where: {
        frameworkId_code: {
          frameworkId: framework.id,
          code: "HIPAA_PRIVACY_OFFICER",
        },
      },
      update: { acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"] },
      create: {
        frameworkId: framework.id,
        code: "HIPAA_PRIVACY_OFFICER",
        title: "Privacy Officer",
        severity: "CRITICAL",
        weight: 1.5,
        description: "Designate a Privacy Officer.",
        acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"],
        sortOrder: 10,
      },
    });
    await db.complianceItem.upsert({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: requirement.id,
        },
      },
      update: { status: "COMPLIANT" },
      create: {
        practiceId: practice.id,
        requirementId: requirement.id,
        status: "COMPLIANT",
      },
    });

    // Now generate the track for the first time.
    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    // The Privacy Officer task should be COMPLETED (backfill ran).
    const task = await db.practiceTrackTask.findFirst({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(task).not.toBeNull();
    expect(task?.completedAt).not.toBeNull();

    // A TRACK_TASK_COMPLETED event with reason "DERIVED" was logged.
    const completionEvents = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "TRACK_TASK_COMPLETED",
      },
    });
    expect(completionEvents.length).toBeGreaterThanOrEqual(1);
    const reasons = completionEvents.map(
      (e) => (e.payload as { reason?: string })?.reason ?? null,
    );
    expect(reasons).toContain("DERIVED");
  });

  it("leaves tasks without a requirementCode untouched at generation", async () => {
    const { user, practice } = await seedFreshPractice();

    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    // Tasks without requirementCode (e.g., "Verify staff licenses…")
    // remain open even if some other COMPLIANT state exists. Pick the
    // canonical "no requirementCode" task from COMMON_WEEK_4.
    const noCodeTask = await db.practiceTrackTask.findFirst({
      where: {
        practiceId: practice.id,
        requirementCode: null,
      },
    });
    expect(noCodeTask).not.toBeNull();
    expect(noCodeTask?.completedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-backfill.test.ts
```
Expected: First test FAILS with `expected null not to be null` on the completedAt assertion. Second test PASSES (no requirementCode means no work expected).

- [ ] **Step 3: Modify `projectTrackGenerated` to run the backfill pass**

Open `src/lib/events/projections/track.ts`. Replace the existing `projectTrackGenerated` function (lines 24–51) with this version that performs the backfill:

```typescript
export async function projectTrackGenerated(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    templateCode: TrackTemplateCode;
  },
): Promise<void> {
  const tasks = TRACK_TEMPLATES[args.templateCode];
  await tx.practiceTrack.create({
    data: {
      practiceId: args.practiceId,
      templateCode: args.templateCode,
    },
  });
  for (const t of tasks) {
    await tx.practiceTrackTask.create({
      data: {
        practiceId: args.practiceId,
        weekTarget: t.weekTarget,
        sortOrder: t.sortOrder,
        title: t.title,
        description: t.description,
        href: t.href,
        requirementCode: t.requirementCode ?? null,
      },
    });
  }

  // Backfill pass: any task whose requirementCode matches an existing
  // COMPLIANT ComplianceItem on this practice is closed immediately,
  // emitting TRACK_TASK_COMPLETED with reason="DERIVED". Same shape as
  // the forward rederive auto-complete in rederiveRequirementStatus —
  // see src/lib/compliance/derivation/rederive.ts:142-188.
  const codedTasks = tasks
    .map((t) => t.requirementCode)
    .filter((code): code is string => code != null);
  if (codedTasks.length === 0) return;

  const compliantRequirementCodes = await tx.regulatoryRequirement.findMany({
    where: {
      code: { in: codedTasks },
      complianceItems: {
        some: { practiceId: args.practiceId, status: "COMPLIANT" },
      },
    },
    select: { code: true },
  });
  if (compliantRequirementCodes.length === 0) return;

  const compliantCodeSet = new Set(
    compliantRequirementCodes.map((r) => r.code),
  );
  const tasksToBackfill = await tx.practiceTrackTask.findMany({
    where: {
      practiceId: args.practiceId,
      requirementCode: { in: [...compliantCodeSet] },
      completedAt: null,
    },
    select: { id: true },
  });

  for (const t of tasksToBackfill) {
    await tx.eventLog.create({
      data: {
        practiceId: args.practiceId,
        actorUserId: null,
        type: "TRACK_TASK_COMPLETED",
        schemaVersion: 1,
        payload: {
          trackTaskId: t.id,
          completedByUserId: null,
          reason: "DERIVED",
        },
      },
    });
    await tx.practiceTrackTask.update({
      where: { id: t.id },
      data: {
        completedAt: new Date(),
        completedByUserId: null,
      },
    });
  }

  const remaining = await tx.practiceTrackTask.count({
    where: { practiceId: args.practiceId, completedAt: null },
  });
  if (remaining === 0) {
    await tx.practiceTrack.update({
      where: { practiceId: args.practiceId },
      data: { completedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-backfill.test.ts
```
Expected: Both tests PASS.

- [ ] **Step 5: Run the existing track-generation suite to confirm no regression**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-generation.test.ts
```
Expected: 3/3 tests PASS (the file already existed and tests forward auto-completion).

- [ ] **Step 6: Run the full suite**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npm test
```
Expected: `Test Files  77 passed (77)` and `Tests  ≥534 passed`.

- [ ] **Step 7: Typecheck + lint**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx tsc --noEmit && npm run lint
```
Expected: zero errors.

- [ ] **Step 8: Commit on a feature branch**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git checkout -b feat/phase-0-track-backfill
git add src/lib/events/projections/track.ts tests/integration/track-backfill.test.ts
git commit -m "$(cat <<'EOF'
fix(track): backfill at generation when COMPLIANT items already exist

Practices that complete onboarding before opening /programs/track had
their Track generated against current state, but tasks whose
requirementCode matched an already-COMPLIANT ComplianceItem stayed
open. Now projectTrackGenerated runs an inline backfill that walks the
just-created tasks, queries matching COMPLIANT items, and emits
TRACK_TASK_COMPLETED with reason="DERIVED" for each. Same write path as
the forward auto-complete in rederiveRequirementStatus.

Verified:
- New test tests/integration/track-backfill.test.ts (2/2 pass)
- Existing track-generation.test.ts (3/3 pass)
- Full suite: Test Files 77 passed, Tests 534 passed
- tsc --noEmit clean
- npm run lint clean

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Push + open PR**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git push -u origin feat/phase-0-track-backfill
```
Expected: GitHub prints a PR-creation URL. Open it; create PR with body referencing this plan + test evidence. Merge after green CI.

---

## Task 2 — Manual Track Sync action + button

**Files:**
- Modify: `src/app/(dashboard)/programs/track/actions.ts`
- Create: `src/app/(dashboard)/programs/track/SyncButton.tsx`
- Create: `src/app/(dashboard)/programs/track/SyncButton.test.tsx`
- Modify: `src/app/(dashboard)/programs/track/page.tsx`
- Create: `tests/integration/track-sync-action.test.ts`

**Why:** Even with Task 1's backfill, state can drift if a practice manually marks something COMPLIANT outside the track-aware path or if a future schema change lands without re-running backfill. A user-visible "Sync" button is a one-click escape hatch — also useful for support agents diagnosing user reports of "my track is stuck."

The Sync button calls a new server action that re-runs the same backfill pass against the current state, idempotent.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/track-sync-action.test.ts`:

```typescript
// tests/integration/track-sync-action.test.ts
//
// Phase 0 / Task 2: syncTrackFromEvidenceAction re-runs the backfill
// against current ComplianceItem state, idempotent on repeat.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";
import { syncTrackTasksFromEvidence } from "@/app/(dashboard)/programs/track/sync-internals";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-sync-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Sync Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

const PROFILE_BASELINE = {
  hasInHouseLab: false,
  dispensesControlledSubstances: false,
  medicareParticipant: false,
  billsMedicaid: false,
  subjectToMacraMips: false,
  sendsAutomatedPatientMessages: false,
  compoundsAllergens: false,
} as const;

describe("syncTrackTasksFromEvidence", () => {
  it("closes a task whose ComplianceItem flipped to COMPLIANT after track creation", async () => {
    const { user, practice } = await seedFreshPractice();

    // Generate track first (no COMPLIANT items yet).
    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    // Now seed a COMPLIANT item DIRECTLY (simulating drift — bypasses
    // the rederive path that would normally also auto-complete).
    const framework = await db.regulatoryFramework.upsert({
      where: { code: "HIPAA" },
      update: {},
      create: {
        code: "HIPAA",
        name: "HIPAA",
        description: "test",
        jurisdiction: "federal",
        weightDefault: 0.25,
        scoringStrategy: "STANDARD_CHECKLIST",
        sortOrder: 10,
      },
    });
    const requirement = await db.regulatoryRequirement.upsert({
      where: {
        frameworkId_code: {
          frameworkId: framework.id,
          code: "HIPAA_PRIVACY_OFFICER",
        },
      },
      update: { acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"] },
      create: {
        frameworkId: framework.id,
        code: "HIPAA_PRIVACY_OFFICER",
        title: "Privacy Officer",
        severity: "CRITICAL",
        weight: 1.5,
        description: "Designate a Privacy Officer.",
        acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"],
        sortOrder: 10,
      },
    });
    await db.complianceItem.upsert({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: requirement.id,
        },
      },
      update: { status: "COMPLIANT" },
      create: {
        practiceId: practice.id,
        requirementId: requirement.id,
        status: "COMPLIANT",
      },
    });

    // Sanity: the task is still open before sync.
    const before = await db.practiceTrackTask.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(before.completedAt).toBeNull();

    // Sync.
    const result = await syncTrackTasksFromEvidence(practice.id);
    expect(result.closed).toBe(1);

    // Task is now closed with reason DERIVED.
    const after = await db.practiceTrackTask.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(after.completedAt).not.toBeNull();
  });

  it("is idempotent on repeat calls", async () => {
    const { user, practice } = await seedFreshPractice();

    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const first = await syncTrackTasksFromEvidence(practice.id);
    const second = await syncTrackTasksFromEvidence(practice.id);
    expect(first.closed).toBe(0);
    expect(second.closed).toBe(0);
  });

  it("returns { closed: 0 } when the practice has no track yet", async () => {
    const { practice } = await seedFreshPractice();
    const result = await syncTrackTasksFromEvidence(practice.id);
    expect(result.closed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-sync-action.test.ts
```
Expected: FAIL with `Cannot find module '@/app/(dashboard)/programs/track/sync-internals'` or similar — the module doesn't exist yet.

- [ ] **Step 3: Create the internals module**

Create `src/app/(dashboard)/programs/track/sync-internals.ts`:

```typescript
// src/app/(dashboard)/programs/track/sync-internals.ts
//
// Server-only logic for re-running the track auto-complete pass against
// current ComplianceItem state. Pure-by-practiceId so it can be called
// from the server action AND from integration tests without RBAC/auth
// noise. The wrapping action layer handles auth.

import { db } from "@/lib/db";

export interface SyncResult {
  closed: number;
}

export async function syncTrackTasksFromEvidence(
  practiceId: string,
): Promise<SyncResult> {
  const track = await db.practiceTrack.findUnique({
    where: { practiceId },
    select: { practiceId: true },
  });
  if (!track) return { closed: 0 };

  return await db.$transaction(async (tx) => {
    const openCodedTasks = await tx.practiceTrackTask.findMany({
      where: {
        practiceId,
        completedAt: null,
        NOT: { requirementCode: null },
      },
      select: { id: true, requirementCode: true },
    });
    if (openCodedTasks.length === 0) return { closed: 0 };

    const codes = [...new Set(openCodedTasks.map((t) => t.requirementCode!))];
    const compliant = await tx.regulatoryRequirement.findMany({
      where: {
        code: { in: codes },
        complianceItems: {
          some: { practiceId, status: "COMPLIANT" },
        },
      },
      select: { code: true },
    });
    if (compliant.length === 0) return { closed: 0 };

    const compliantSet = new Set(compliant.map((c) => c.code));
    const tasksToClose = openCodedTasks.filter(
      (t) => t.requirementCode != null && compliantSet.has(t.requirementCode),
    );
    if (tasksToClose.length === 0) return { closed: 0 };

    for (const t of tasksToClose) {
      await tx.eventLog.create({
        data: {
          practiceId,
          actorUserId: null,
          type: "TRACK_TASK_COMPLETED",
          schemaVersion: 1,
          payload: {
            trackTaskId: t.id,
            completedByUserId: null,
            reason: "DERIVED",
          },
        },
      });
      await tx.practiceTrackTask.update({
        where: { id: t.id },
        data: { completedAt: new Date(), completedByUserId: null },
      });
    }

    const remaining = await tx.practiceTrackTask.count({
      where: { practiceId, completedAt: null },
    });
    if (remaining === 0) {
      await tx.practiceTrack.update({
        where: { practiceId },
        data: { completedAt: new Date() },
      });
    }

    return { closed: tasksToClose.length };
  });
}
```

- [ ] **Step 4: Run the integration test again**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-sync-action.test.ts
```
Expected: 3/3 tests PASS.

- [ ] **Step 5: Add the server action wrapper**

Open `src/app/(dashboard)/programs/track/actions.ts`. Append below the existing `reopenTrackTaskAction`:

```typescript
import { syncTrackTasksFromEvidence } from "./sync-internals";

export async function syncTrackFromEvidenceAction(): Promise<{
  closed: number;
}> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  // RBAC: any authenticated practice member can sync. No write to
  // shared state beyond the practice's own tasks; idempotent.
  void user;

  const result = await syncTrackTasksFromEvidence(pu.practiceId);
  if (result.closed > 0) {
    revalidatePath("/programs/track");
    revalidatePath("/dashboard");
  }
  return result;
}
```

- [ ] **Step 6: Create the client SyncButton component**

Create `src/app/(dashboard)/programs/track/SyncButton.tsx`:

```typescript
// src/app/(dashboard)/programs/track/SyncButton.tsx
"use client";

import { useState, useTransition } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncTrackFromEvidenceAction } from "./actions";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    startTransition(async () => {
      try {
        const { closed } = await syncTrackFromEvidenceAction();
        setMessage(
          closed === 0
            ? "Already up to date"
            : `Closed ${closed} task${closed === 1 ? "" : "s"}`,
        );
      } catch (err) {
        setMessage("Sync failed — try again");
        // Surface for log inspection without leaking PII.
        console.error("[track-sync]", err);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={pending}
        aria-label="Sync track from current compliance state"
      >
        <RefreshCcw
          className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        <span className="ml-1.5">{pending ? "Syncing…" : "Sync"}</span>
      </Button>
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the jsdom unit test for the button**

Create `src/app/(dashboard)/programs/track/SyncButton.test.tsx`:

```typescript
// src/app/(dashboard)/programs/track/SyncButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  syncTrackFromEvidenceAction: vi.fn(),
}));

import { SyncButton } from "./SyncButton";
import { syncTrackFromEvidenceAction } from "./actions";

describe("<SyncButton>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Sync' in idle state", () => {
    render(<SyncButton />);
    expect(screen.getByRole("button")).toHaveTextContent("Sync");
  });

  it("calls syncTrackFromEvidenceAction on click and shows result", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 2 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(syncTrackFromEvidenceAction).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Closed 2 tasks",
    );
  });

  it("shows 'Already up to date' when zero closed", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 0 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Already up to date",
    );
  });

  it("shows 'Closed 1 task' (singular) when closed=1", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 1 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Closed 1 task",
    );
  });

  it("shows error message when action throws", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockRejectedValue(
      new Error("boom"),
    );
    // Suppress the console.error from the component so jest output stays clean.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sync failed — try again",
    );
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 8: Run the unit test**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx vitest run src/app/\(dashboard\)/programs/track/SyncButton.test.tsx
```
Expected: 5/5 tests PASS.

- [ ] **Step 9: Mount the SyncButton on the Track page**

Open `src/app/(dashboard)/programs/track/page.tsx`. Update the import block (after the existing `import { TrackTaskRow } from "./TrackTaskRow";`):

```typescript
import { SyncButton } from "./SyncButton";
```

Then update the header block (around lines 85–101) to include the Sync button next to the score ring:

```typescript
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Get started</h1>
          <p className="text-sm text-muted-foreground">
            A 12-week roadmap built for your practice. Tasks tagged{" "}
            <span className="mx-0.5 rounded border px-1 text-[10px]">
              auto-completes
            </span>{" "}
            tick off when the underlying compliance work happens; the rest
            need an explicit Mark done click.
          </p>
          <div className="pt-1">
            <SyncButton />
          </div>
        </div>
        <ScoreRing score={pct} size={64} strokeWidth={7} assessed />
      </header>
```

- [ ] **Step 10: Run the full test suite**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npm test
```
Expected: all tests pass.

- [ ] **Step 11: Typecheck + lint**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx tsc --noEmit && npm run lint
```
Expected: zero errors.

- [ ] **Step 12: Local dev smoke test**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npm run dev -- --port 3002
```
Open `http://localhost:3002/programs/track`. Sign in if prompted. Confirm:
- The "Sync" button renders in the header below the description
- Clicking it shows "Syncing…" briefly, then "Already up to date" (since no drift exists)

Stop the dev server with Ctrl+C.

- [ ] **Step 13: Commit on a feature branch**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git checkout main && git pull origin main
git checkout -b feat/phase-0-track-sync-button
git add src/app/\(dashboard\)/programs/track/sync-internals.ts \
        src/app/\(dashboard\)/programs/track/actions.ts \
        src/app/\(dashboard\)/programs/track/SyncButton.tsx \
        src/app/\(dashboard\)/programs/track/SyncButton.test.tsx \
        src/app/\(dashboard\)/programs/track/page.tsx \
        tests/integration/track-sync-action.test.ts
git commit -m "$(cat <<'EOF'
feat(track): manual Sync button on /programs/track

Adds a one-click "Sync" button in the Track page header that re-runs
the auto-complete backfill against current ComplianceItem state. Useful
when state drifts (manual ComplianceItem updates outside the rederive
path) or when support agents diagnose user-reported "stuck track"
issues. Idempotent — no event emitted when nothing to close.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 14: Push + open PR**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git push -u origin feat/phase-0-track-sync-button
```
Open the printed PR-creation URL. PR body must include:
- Reference to this plan + Task 2.
- Test counts: integration 3/3, jsdom 5/5, full suite count.
- A screenshot of `/programs/track` showing the Sync button. Use Chrome MCP `preview_screenshot` against `https://v2.app.gwcomp.com/programs/track` AFTER Cloud Run rollout (60-180s after merge). Paste in PR comment after merge.

Merge after green CI. Then Chrome-verify on prod and post the screenshot in the PR comment.

---

## Task 3 — `.env.example` parity

**Files:**
- Modify: `.env.example`

**Why:** Two `process.env.*` references in code aren't documented in `.env.example`, which means a fresh clone won't know they exist. Audit found:

```
process.env.APP_URL
process.env.GOOGLE_APPLICATION_CREDENTIALS
```

`APP_URL` is the server-side equivalent of `NEXT_PUBLIC_APP_URL` (used in places where the URL must not be embedded in the client bundle, e.g. internal links in PDF generators or notification emails).
`GOOGLE_APPLICATION_CREDENTIALS` is the standard GCP env var that the GCS client SDK looks for as a fallback when `GCP_KEY_FILE` isn't set. Documenting both prevents confusion for new contributors.

- [ ] **Step 1: Open `.env.example` and add the two missing entries**

Open `D:/GuardWell/guardwell-v2/.env.example`. Find the `# ── App config ──` section. Add `APP_URL` immediately after `NEXT_PUBLIC_MARKETING_URL`:

```bash
# ── App config ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://v2.app.gwcomp.com
NEXT_PUBLIC_MARKETING_URL=https://gwcomp.com
# Server-side equivalent of NEXT_PUBLIC_APP_URL — used by PDF generators,
# notification email templates, and any code path that builds links
# without putting the URL in the client bundle. Keep this in sync with
# NEXT_PUBLIC_APP_URL.
APP_URL=https://v2.app.gwcomp.com
```

Then find the `# ── GCS evidence bucket ──` section. Add `GOOGLE_APPLICATION_CREDENTIALS` after `GCP_KEY_FILE`:

```bash
# ── GCS evidence bucket (Evidence model — PR #139) ───────────────────────────
# Noorros creates the bucket once via docs/ops/2026-04-27-gcs-bucket-setup.md
# Leave unset in local dev — GCS helper falls back to a no-op (dev mode)
GCS_EVIDENCE_BUCKET=
GCP_PROJECT_ID=
# Local dev: path to a service-account key JSON. Cloud Run uses ADC automatically.
GCP_KEY_FILE=
# Standard GCP env var the SDK reads as a fallback when GCP_KEY_FILE is
# unset. Cloud Run honors Application Default Credentials so this is
# typically only set in local dev for service-account-based testing.
GOOGLE_APPLICATION_CREDENTIALS=
```

- [ ] **Step 2: Verify the file parses (no broken sections)**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && grep -c "^[A-Z]" .env.example
```
Expected: a count of env-var lines (≥ 28 after the additions).

- [ ] **Step 3: Confirm no real env value crept in**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && grep -E "^(STRIPE_|FIREBASE_|RESEND_|ANTHROPIC_)" .env.example | grep -v "^[A-Z_]*=$"
```
Expected: zero output (every secret-style var ends with `=` and nothing after).

If any line shows a real value, REMOVE the value before committing. `.env.example` is committed to public source control.

---

## Task 4 — Defensive redirect for `/programs/get-started`

**Files:**
- Create: `src/app/(dashboard)/programs/get-started/page.tsx`

**Why:** The path doesn't exist as a route, but it's a natural URL for a user to type or for an external doc to link to. A static redirect costs ~10 lines and removes a sharp edge.

- [ ] **Step 1: Create the redirect page**

Create `src/app/(dashboard)/programs/get-started/page.tsx`:

```typescript
// src/app/(dashboard)/programs/get-started/page.tsx
//
// Defensive redirect. The Compliance Track lives at /programs/track;
// users sometimes type or bookmark /programs/get-started (matching the
// sidebar label). Redirect rather than 404.

import type { Route } from "next";
import { redirect } from "next/navigation";

export const metadata = { title: "Get started · Redirect" };

export default function GetStartedRedirectPage(): never {
  redirect("/programs/track" as Route);
}
```

- [ ] **Step 2: Local smoke test**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npm run dev -- --port 3002
```
Open `http://localhost:3002/programs/get-started`. Confirm browser is redirected to `/programs/track`.

Stop the dev server.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit Task 3 + Task 4 together**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git checkout main && git pull origin main
git checkout -b chore/phase-0-env-and-redirect
git add .env.example src/app/\(dashboard\)/programs/get-started/page.tsx
git commit -m "$(cat <<'EOF'
chore(env+routes): document APP_URL/GOOGLE_APPLICATION_CREDENTIALS, redirect /programs/get-started

Two small fixes bundled:

1. .env.example adds APP_URL (server-side equivalent of
   NEXT_PUBLIC_APP_URL used by PDF generators + email templates) and
   GOOGLE_APPLICATION_CREDENTIALS (standard GCP env-var fallback when
   GCP_KEY_FILE is unset). Both were referenced in source but
   undocumented.

2. /programs/get-started is a natural URL to type given the sidebar
   label, but the route doesn't exist — was returning 404. Adds a
   server-side redirect to /programs/track.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push + open PR**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git push -u origin chore/phase-0-env-and-redirect
```
Open the printed PR URL. PR body: small chore, doc-only + 1 redirect file. Merge after green CI.

---

## Task 5 — Operational runbooks

**Files:**
- Create: `docs/runbooks/resend-domain.md`
- Create: `docs/runbooks/cloud-sql-tier.md`

**Why:** Two user-blocking actions sit between v2 and a production-ready posture. The code can't fix either (both are operations tasks the user — Noorros — must perform). What the plan can do is document the exact steps so the user can execute without context-switching every time. Runbooks also become the canonical reference if Noorros ever onboards a teammate or hires support help.

- [ ] **Step 1: Create the runbooks directory + Resend runbook**

Create `D:/GuardWell/guardwell-v2/docs/runbooks/resend-domain.md`:

```markdown
# Runbook — Resend domain verification

**Status:** Required before onboarding drip emails + daily/weekly digests will actually deliver in production.

**Owner:** Noorros (it@noorros.com).

**Time to complete:** ~30 minutes wall-clock + DNS propagation wait (up to 24 hours, usually <1 hour).

## Why this matters

Cron jobs `/api/cron/onboarding-drip` and `/api/notifications/digest/run` are wired and emit to Resend, but Resend silently no-ops sends from unverified domains. Symptom in prod: events fire, emails never arrive, no error surfaced.

The sender domain must be DKIM- and SPF-verified before Resend will deliver mail.

## Pre-reqs

- Resend account (https://resend.com) with billing enabled.
- DNS access for `gwcomp.com` (currently Cloud DNS in `guardwell-prod` GCP project).
- `RESEND_API_KEY` already in `Secret Manager → guardwell-v2` (set during onboarding-phase-c).

## Steps

1. **Sign in to Resend dashboard** → Domains → Add Domain.
2. **Enter** `gwcomp.com` (root domain — sub-domains inherit, and we want the same sender across marketing/app/v2).
3. **Resend issues 3 DNS records:**
   - A `TXT` for SPF (e.g. `v=spf1 include:_spf.resend.com ~all`)
   - A `TXT` for DKIM (e.g. `resend._domainkey TXT k=rsa;p=…`)
   - Optionally a `TXT` for DMARC (recommend `v=DMARC1; p=none; rua=mailto:dmarc@gwcomp.com`)
4. **Add the records to Cloud DNS:**
   ```bash
   gcloud dns record-sets transaction start \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction add \
     "v=spf1 include:_spf.resend.com ~all" \
     --name="gwcomp.com." --ttl=300 --type=TXT \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction add \
     "k=rsa;p=YOUR_DKIM_PUBKEY_FROM_RESEND" \
     --name="resend._domainkey.gwcomp.com." --ttl=300 --type=TXT \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction execute \
     --zone=gwcomp-com --project=guardwell-prod
   ```
5. **Wait for propagation.** Typically <10 minutes. Resend dashboard auto-checks every minute and flips status to "Verified" when satisfied.
6. **Confirm `EMAIL_FROM` env-var is `noreply@gwcomp.com` (or `support@gwcomp.com`)** in Cloud Run service `guardwell-v2`. Currently set per `.env.example`. If different, update via:
   ```bash
   gcloud run services update guardwell-v2 \
     --region us-central1 --project guardwell-prod \
     --update-env-vars EMAIL_FROM='GuardWell <noreply@gwcomp.com>'
   ```
7. **Smoke-test the cron endpoint manually:**
   ```bash
   curl -X POST -H "Authorization: Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET --project=guardwell-prod)" \
     https://v2.app.gwcomp.com/api/cron/onboarding-drip
   ```
   Expected: HTTP 200 with `{"sent":N}` where N matches the count of practices in the relevant drip windows. If N>0, check Resend dashboard → Logs → confirm delivery.

## Recovery

If a customer reports missing emails AFTER verification:

1. Check Resend dashboard → Logs → filter by recipient. Look for `delivered` vs `bounced` vs `complained`.
2. If bounced: confirm recipient address typo or permanent failure; reach out via in-app.
3. If delivered but customer hasn't seen: ask them to check spam (DKIM/SPF should put us in inbox, but enterprise mail rules vary).
4. Resend bounce/complaint webhook can auto-suppress addresses — endpoint is `/api/webhooks/resend` (TODO: wire up if not already; track in Phase 7).

## Related
- `src/lib/email/send.ts` — fallback no-op when `RESEND_API_KEY` is empty (also active in tests).
- `src/lib/onboarding/run-drip.ts` — drip cadence logic.
- `src/lib/notifications/run-digest.ts` — daily digest batch send.
```

- [ ] **Step 2: Create the Cloud SQL runbook**

Create `D:/GuardWell/guardwell-v2/docs/runbooks/cloud-sql-tier.md`:

```markdown
# Runbook — Cloud SQL tier upsize before customer traffic

**Status:** Required before opening v2 to real customer traffic. Current tier (`db-g1-small`, ~1 vCPU shared, 1.7 GB RAM, ~$26/mo) is fine for dev and the smoke-test practice; will hit CPU and memory pressure under any non-trivial query load.

**Owner:** Noorros (it@noorros.com).

**Time to complete:** ~30 seconds command + ~30 seconds maintenance downtime + verification.

## Why this matters

Cloud SQL instance `guardwell-v2-db` runs `db-g1-small` per the initial cost-conscious provision. Real-world load (cross-framework derivation queries, audit overview rollups, AI Concierge prompt context fetches) will saturate one shared vCPU quickly. Tier upsize is a single `gcloud sql instances patch` call; no schema migration needed.

Upsize target: `db-custom-1-3840` (1 dedicated vCPU + 3.75 GB RAM, ~$50/mo). Re-evaluate at 25 paying customers; bump to `db-custom-2-7680` (~$100/mo) if CPU >70% sustained.

## Pre-reqs

- `gcloud` authenticated as an account with `cloudsql.instances.update` on `guardwell-prod`.
- Confirmed-with-stakeholders maintenance window. Downtime is ~30s as Cloud SQL drains connections + restarts on the new tier.

## Steps

1. **Notify any active sessions** (Slack #ops or equivalent). At launch this is just Noorros.

2. **Take a backup** (defensive — Cloud SQL also takes one automatically before tier-change but explicit is better):
   ```bash
   gcloud sql backups create \
     --instance=guardwell-v2-db --project=guardwell-prod \
     --description="pre-tier-upsize-$(date -u +%Y%m%d-%H%M%S)"
   ```
   Wait for the command to return; ~30 seconds.

3. **Patch the tier:**
   ```bash
   gcloud sql instances patch guardwell-v2-db \
     --tier=db-custom-1-3840 \
     --project=guardwell-prod
   ```
   Confirm the prompt with `y`. Cloud SQL drains connections, restarts on the new tier, and resumes. Output: `Patching Cloud SQL instance...done.`

4. **Verify the new tier:**
   ```bash
   gcloud sql instances describe guardwell-v2-db \
     --project=guardwell-prod \
     --format="value(settings.tier,settings.dataDiskSizeGb,settings.dataDiskType)"
   ```
   Expected: `db-custom-1-3840  100  PD_SSD` (or whatever disk size is configured).

5. **Smoke-test connectivity from Cloud Run:**
   - Open `https://v2.app.gwcomp.com/dashboard` in browser.
   - Sign in. Confirm sidebar framework scores load (proves Prisma → Cloud SQL round-trip).
   - Open `/audit/overview`. Confirm framework breakdown table renders (heavier query — proves vCPU is happy).

6. **Smoke-test from local dev** (optional — only if using Cloud SQL Proxy):
   ```bash
   cd /d/GuardWell
   ./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5434 &
   PGPASSWORD="$(cat /d/GuardWell/gcp-secrets-v2.txt | grep gwapp | awk '{print $2}')" \
     psql -h 127.0.0.1 -p 5434 -U gwapp guardwell_v2 -c 'SELECT count(*) FROM "Practice";'
   ```
   Expected: returns the practice count without error.

## When to re-upsize

Watch the Cloud SQL → Insights → CPU + memory dashboards weekly. Trigger another upsize when:
- 7-day p95 CPU > 70%
- Memory committed > 80% of allocated
- Any query in the slow-query log >2s p95 that index tuning can't fix

Next tier up: `db-custom-2-7680` (~$100/mo). Then `db-custom-4-15360` (~$200/mo) when above 100 paying customers.

## Rollback

If the new tier introduces a regression (extremely unlikely — same engine, more resources), revert:
```bash
gcloud sql instances patch guardwell-v2-db \
  --tier=db-g1-small \
  --project=guardwell-prod
```
Same downtime profile. Then escalate to determine root cause before re-upsizing.

## Related
- Memory file `deployment.md` — Cloud Build auto-deploy + Cloud Scheduler crons.
- Memory file `v2-current-state.md` — Cloud SQL provisioning history.
- `cloudbuild.yaml` — application deploy pipeline (independent of DB tier).
```

- [ ] **Step 3: Confirm files render correctly**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && ls docs/runbooks/
```
Expected: `cloud-sql-tier.md  resend-domain.md`.

- [ ] **Step 4: Commit + push**

Run:
```bash
cd /d/GuardWell/guardwell-v2 && git checkout main && git pull origin main
git checkout -b docs/phase-0-runbooks
git add docs/runbooks/
git commit -m "$(cat <<'EOF'
docs(runbooks): Resend domain verification + Cloud SQL tier upsize

Two operational runbooks documenting user-blocking actions that gate
v2 production-readiness. Both are simple commands; the value is having
the exact steps + recovery paths checked into the repo so they're
findable by future-Noorros and any future teammate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin docs/phase-0-runbooks
```
Open the printed PR URL. Merge after review.

---

## Phase 0 close-out

After all 5 tasks merged:

- [ ] **Run the full test suite once more** to confirm green:
  ```bash
  cd /d/GuardWell/guardwell-v2 && git checkout main && git pull origin main && npm test
  ```
  Expected: all tests pass (count grew by Task 1's 2 tests + Task 2's 3 integration + 5 jsdom = 10 new tests).

- [ ] **Chrome-verify the live state** of `https://v2.app.gwcomp.com/programs/track` to confirm:
  - The Sync button is visible.
  - Clicking Sync returns "Already up to date" or correctly closes drift.
  - `/programs/get-started` redirects (paste URL, observe redirect).

- [ ] **Update memory file** `v2-current-state.md` with a "Phase 0 complete" entry that lists:
  - Track auto-completion sync fixed (PR 1 + PR 2 merged on YYYY-MM-DD).
  - `.env.example` parity (PR 3).
  - Two runbooks landed (PR 4).
  - Skipped items: score-ring "Not assessed" (already shipped), test pollution (already resolved — 532/532 green).
  - User-blocking actions remaining: Resend domain verification (per runbook), Cloud SQL tier upsize (per runbook).

- [ ] **Notify Noorros** that the two user-blocking runbook items are ready for execution. Resend domain is the higher priority (gates onboarding drip + digest emails).

- [ ] **Mark Phase 0 complete** in `docs/plans/2026-04-28-v2-feature-recovery-master.md` (add a "Status: shipped" line under the Phase 0 header).

---

## Spec coverage check

Cross-reference each Phase 0 scope item from the master plan with this plan's tasks:

| Master plan item | This plan |
|---|---|
| Sidebar `Get started` 404 fix | Task 4 (defensive redirect) |
| Compliance Track auto-completion sync | Tasks 1 + 2 |
| Score-ring "Not assessed yet" empty state | Skipped — already shipped (verified in `<ScoreRing>` + `<ModuleHeader>` + `/modules/[code]/page.tsx`) |
| Cross-file integration test pollution | Skipped — already resolved (532/532 green under combined run) |
| Resend domain verification | Task 5 (runbook) |
| Cloud SQL tier upsize | Task 5 (runbook) |
| Notification.subjectType audit | Deferred to Phase 7 (Notification depth) |
| `.env.example` parity | Task 3 |

All in-scope items have an explicit task. Items moved out of scope are documented with rationale.
