# Compliance Track / Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generated, milestone-based onramp that solves the "blank dashboard" problem for new practices. Each practice gets a personalized track keyed by their specialty + size, with tasks that auto-complete when the underlying compliance work happens.

**Architecture:** Two new tables (`PracticeTrack` + `PracticeTrackTask`) + 3 new event types + auto-generation hook in the existing `PRACTICE_PROFILE_UPDATED` projection + auto-completion hook in `rederiveRequirementStatus` + a new `/programs/track` page + sidebar entry. Templates are static data keyed by `specialtyCategory`. Tasks with `requirementCode` set auto-complete; the rest require explicit user click.

**Tech Stack:** Next.js 16 App Router, Prisma 5.22, event-sourced projections per ADR-0001, Tailwind v4 + Shadcn for UI, vitest for tests.

---

## File Structure

**Create:**
- `src/lib/track/templates.ts` — 4 static templates (GENERAL_PRIMARY_CARE, DENTAL, BEHAVIORAL, GENERIC)
- `src/lib/track/applicability.ts` — pure pickTemplateForProfile(profile) helper
- `src/lib/events/projections/track.ts` — projectTrackGenerated + projectTrackTaskCompleted + projectTrackTaskReopened
- `src/app/(dashboard)/programs/track/page.tsx` — server-rendered page
- `src/app/(dashboard)/programs/track/actions.ts` — recordTrackTaskCompletionAction + reopenTrackTaskAction
- `src/app/(dashboard)/programs/track/TrackTaskRow.tsx` — client island for the Mark-done button
- `tests/integration/track-generation.test.ts` — auto-generation + auto-completion + percent-complete math
- `tests/integration/track-task-actions.test.ts` — server-action coverage

**Modify:**
- `prisma/schema.prisma` — add `Practice.complianceTrack` + `Practice.trackTasks` relations (PracticeTrack already added; missing the back-relations)
- `src/lib/events/registry.ts` — add 3 EventType literals + 3 EVENT_SCHEMAS entries
- `src/lib/events/projections/practiceProfile.ts` — call generateTrackIfMissing at end
- `src/lib/compliance/derivation/rederive.ts` — after each COMPLIANT flip, mark matching track tasks complete
- `src/components/gw/AppShell/Sidebar.tsx` — add "Get started" entry as first item under My Programs

**Test:**
- `tests/integration/track-generation.test.ts`
- `tests/integration/track-task-actions.test.ts`

---

## Task 1: Finish schema + sync local DB

**Files:**
- Modify: `prisma/schema.prisma` — add 2 back-relations on Practice
- Run: `npx prisma db push --skip-generate`
- Run: `npx prisma generate`

- [ ] **Step 1: Add Practice back-relations**

In `prisma/schema.prisma`, find the `model Practice` block (line ~68) and locate the relations list (around line 109 — `scoreSnapshots ComplianceScoreSnapshot[]`). Insert before the closing `}`:

```prisma
  complianceTrack PracticeTrack?
  trackTasks      PracticeTrackTask[]
```

- [ ] **Step 2: Push schema to local Postgres**

```bash
cd D:/GuardWell/guardwell-v2 && npx prisma db push --skip-generate
```

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd D:/GuardWell/guardwell-v2 && npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma && git commit -m "schema(track): finish Practice back-relations for PracticeTrack + PracticeTrackTask"
```

---

## Task 2: Track templates + applicability picker

**Files:**
- Create: `src/lib/track/templates.ts`
- Create: `src/lib/track/applicability.ts`
- Test: `src/lib/track/applicability.test.ts`

- [ ] **Step 1: Write failing test for pickTemplateForProfile**

Create `src/lib/track/applicability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickTemplateForProfile } from "./applicability";

describe("pickTemplateForProfile", () => {
  it("returns GENERAL_PRIMARY_CARE for primary care", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "PRIMARY_CARE" })).toBe(
      "GENERAL_PRIMARY_CARE",
    );
  });
  it("returns DENTAL for dental", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "DENTAL" })).toBe("DENTAL");
  });
  it("returns BEHAVIORAL for behavioral", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "BEHAVIORAL" })).toBe(
      "BEHAVIORAL",
    );
  });
  it("returns GENERIC for SPECIALTY/ALLIED/OTHER/null", () => {
    expect(pickTemplateForProfile({ specialtyCategory: "SPECIALTY" })).toBe("GENERIC");
    expect(pickTemplateForProfile({ specialtyCategory: "ALLIED" })).toBe("GENERIC");
    expect(pickTemplateForProfile({ specialtyCategory: "OTHER" })).toBe("GENERIC");
    expect(pickTemplateForProfile({ specialtyCategory: null })).toBe("GENERIC");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (no module)**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run src/lib/track/applicability.test.ts
```

Expected: error "Cannot find module './applicability'".

- [ ] **Step 3: Implement applicability.ts**

Create `src/lib/track/applicability.ts`:

```ts
// src/lib/track/applicability.ts
//
// Picks the right Track template for a practice given its compliance
// profile. Templates are keyed by specialtyCategory. Unknown / null /
// non-mappable values fall through to GENERIC.

export type TrackTemplateCode =
  | "GENERAL_PRIMARY_CARE"
  | "DENTAL"
  | "BEHAVIORAL"
  | "GENERIC";

export function pickTemplateForProfile(profile: {
  specialtyCategory: string | null;
}): TrackTemplateCode {
  switch (profile.specialtyCategory) {
    case "PRIMARY_CARE":
      return "GENERAL_PRIMARY_CARE";
    case "DENTAL":
      return "DENTAL";
    case "BEHAVIORAL":
      return "BEHAVIORAL";
    default:
      return "GENERIC";
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run src/lib/track/applicability.test.ts
```

Expected: 4/4 passing.

- [ ] **Step 5: Implement templates.ts**

Create `src/lib/track/templates.ts`:

```ts
// src/lib/track/templates.ts
//
// Static Track templates. Each template is an ordered list of tasks bucketed
// into target weeks (1, 2, 4, 8, 12). Tasks with `requirementCode` set
// auto-complete when the matching ComplianceItem flips to COMPLIANT
// (handled in rederiveRequirementStatus). Tasks without a requirementCode
// require explicit user click.

import type { TrackTemplateCode } from "./applicability";

export interface TrackTemplateTask {
  weekTarget: 1 | 2 | 4 | 8 | 12;
  sortOrder: number;
  title: string;
  description: string;
  href: string;
  requirementCode?: string;
}

const COMMON_WEEK_1: TrackTemplateTask[] = [
  {
    weekTarget: 1,
    sortOrder: 10,
    title: "Designate a Privacy Officer",
    description:
      "Pick the staff member who'll own HIPAA Privacy. Required by §164.530(a)(1)(i).",
    href: "/programs/staff",
    requirementCode: "HIPAA_PRIVACY_OFFICER",
  },
  {
    weekTarget: 1,
    sortOrder: 20,
    title: "Designate a Security Officer",
    description:
      "Pick the staff member who'll own HIPAA Security. Required by §164.308(a)(2). Often the same person as Privacy Officer for solo practices.",
    href: "/programs/staff",
    requirementCode: "HIPAA_SECURITY_OFFICER",
  },
  {
    weekTarget: 1,
    sortOrder: 30,
    title: "Adopt the HIPAA Notice of Privacy Practices",
    description:
      "Adopt + post your NPP. Patients receive a copy at their first visit.",
    href: "/programs/policies",
    requirementCode: "HIPAA_NPP",
  },
];

const COMMON_WEEK_2: TrackTemplateTask[] = [
  {
    weekTarget: 2,
    sortOrder: 10,
    title: "Adopt your core HIPAA policies",
    description:
      "Privacy, Security, and Breach Response policies. Required by §164.530(i)(1).",
    href: "/programs/policies",
    requirementCode: "HIPAA_POLICIES_PROCEDURES",
  },
  {
    weekTarget: 2,
    sortOrder: 20,
    title: "Have all staff complete HIPAA Basics training",
    description:
      "≥95% workforce completion required by §164.530(b)(1). Single-owner practices hit 100% after one completion.",
    href: "/programs/training",
    requirementCode: "HIPAA_WORKFORCE_TRAINING",
  },
  {
    weekTarget: 2,
    sortOrder: 30,
    title: "List your PHI vendors + execute BAAs",
    description:
      "Every active vendor that touches PHI needs a Business Associate Agreement. §164.308(b)(1).",
    href: "/programs/vendors",
    requirementCode: "HIPAA_BAAS",
  },
];

const COMMON_WEEK_4: TrackTemplateTask[] = [
  {
    weekTarget: 4,
    sortOrder: 10,
    title: "Complete your annual Security Risk Assessment",
    description:
      "HIPAA §164.308(a)(1)(ii)(A). Walks the 20-question SRA wizard; sets a fresh-for-365-days clock.",
    href: "/programs/risk",
    requirementCode: "HIPAA_SRA",
  },
  {
    weekTarget: 4,
    sortOrder: 20,
    title: "Verify staff licenses + DEA registrations are current",
    description:
      "Add credentials with expiry dates so the platform can warn you 60 days before lapse.",
    href: "/programs/credentials",
  },
];

const COMMON_WEEK_8: TrackTemplateTask[] = [
  {
    weekTarget: 8,
    sortOrder: 10,
    title: "Run your first incident-reporting drill",
    description:
      "Even a near-miss report exercises the breach-determination wizard so workforce knows the flow.",
    href: "/programs/incidents/new",
  },
  {
    weekTarget: 8,
    sortOrder: 20,
    title: "Review your Audit Overview",
    description:
      "Cross-framework readiness snapshot. Identify the 2–3 critical gaps to close before week 12.",
    href: "/audit/overview",
  },
];

const COMMON_WEEK_12: TrackTemplateTask[] = [
  {
    weekTarget: 12,
    sortOrder: 10,
    title: "Generate your compliance report",
    description:
      "Download the cross-framework PDF and review with the practice owner. Establish a recurring quarterly cadence.",
    href: "/audit/overview",
  },
  {
    weekTarget: 12,
    sortOrder: 20,
    title: "Schedule annual policy review",
    description:
      "Set a calendar reminder to revisit each policy + the SRA next year on this date.",
    href: "/programs/policies",
  },
];

export const TRACK_TEMPLATES: Record<TrackTemplateCode, TrackTemplateTask[]> = {
  GENERAL_PRIMARY_CARE: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  DENTAL: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    {
      weekTarget: 4,
      sortOrder: 30,
      title: "Confirm OSHA Bloodborne Pathogens compliance",
      description:
        "Dental practices have routine BBP exposure risk. Confirm exposure-control plan + annual training.",
      href: "/modules/osha",
    },
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  BEHAVIORAL: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    {
      weekTarget: 2,
      sortOrder: 40,
      title: "Document your psychotherapy notes handling",
      description:
        "Behavioral practices have stricter §164.508 authorization rules around psychotherapy notes. Document your release protocol.",
      href: "/programs/policies",
    },
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  GENERIC: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
};
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/track/ && git commit -m "feat(track): templates + specialty-based picker"
```

---

## Task 3: Event registry entries

**Files:**
- Modify: `src/lib/events/registry.ts`

- [ ] **Step 1: Add 3 literals to EVENT_TYPES array**

In `src/lib/events/registry.ts`, find the `EVENT_TYPES` const (line ~9) and append before the closing `]`:

```ts
  "TRACK_GENERATED",
  "TRACK_TASK_COMPLETED",
  "TRACK_TASK_REOPENED",
```

- [ ] **Step 2: Add 3 schemas to EVENT_SCHEMAS object**

Append before the closing `} as const;` of `EVENT_SCHEMAS`:

```ts
  TRACK_GENERATED: {
    1: z.object({
      templateCode: z.enum([
        "GENERAL_PRIMARY_CARE",
        "DENTAL",
        "BEHAVIORAL",
        "GENERIC",
      ]),
      taskCount: z.number().int().min(0),
    }),
  },
  TRACK_TASK_COMPLETED: {
    1: z.object({
      trackTaskId: z.string().min(1),
      completedByUserId: z.string().nullable(),
      // null actor + reason="DERIVED" indicates auto-completion via the
      // requirementCode hook; explicit user clicks set completedByUserId.
      reason: z.enum(["USER", "DERIVED"]),
    }),
  },
  TRACK_TASK_REOPENED: {
    1: z.object({
      trackTaskId: z.string().min(1),
    }),
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/events/registry.ts && git commit -m "events(track): TRACK_GENERATED + TRACK_TASK_COMPLETED + TRACK_TASK_REOPENED"
```

---

## Task 4: Track projection + auto-generation helper

**Files:**
- Create: `src/lib/events/projections/track.ts`
- Test: `tests/integration/track-generation.test.ts`

- [ ] **Step 1: Write failing test for auto-generation**

Create `tests/integration/track-generation.test.ts`:

```ts
// tests/integration/track-generation.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Test", primaryState: "AZ" },
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
} as const;

describe("Compliance Track auto-generation", () => {
  it("creates a track + tasks the first time PRACTICE_PROFILE_UPDATED fires", async () => {
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
    const track = await db.practiceTrack.findUnique({
      where: { practiceId: practice.id },
      include: { tasks: true },
    });
    expect(track?.templateCode).toBe("GENERAL_PRIMARY_CARE");
    expect(track?.tasks.length).toBeGreaterThan(0);
  });

  it("does NOT regenerate the track on a second PRACTICE_PROFILE_UPDATED", async () => {
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
    const firstGeneratedAt = (await db.practiceTrack.findUniqueOrThrow({
      where: { practiceId: practice.id },
    })).generatedAt;

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload: { ...payload, billsMedicaid: true },
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload: { ...payload, billsMedicaid: true },
        }),
    );
    const second = await db.practiceTrack.findUniqueOrThrow({
      where: { practiceId: practice.id },
    });
    expect(second.generatedAt.getTime()).toBe(firstGeneratedAt.getTime());
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (no track row)**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-generation.test.ts
```

Expected: assertion failures (track is null).

- [ ] **Step 3: Implement projections**

Create `src/lib/events/projections/track.ts`:

```ts
// src/lib/events/projections/track.ts
//
// Projections for Compliance Track lifecycle:
//   TRACK_GENERATED        → INSERT PracticeTrack + N PracticeTrackTask rows
//   TRACK_TASK_COMPLETED   → UPDATE one task's completedAt + completedByUserId
//   TRACK_TASK_REOPENED    → clear completedAt + completedByUserId on one task
//
// Plus the auto-generate helper used by projectPracticeProfileUpdated:
// generateTrackIfMissing(tx, practiceId) is idempotent — returns null if
// a track already exists, otherwise emits TRACK_GENERATED + writes rows.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { TRACK_TEMPLATES } from "@/lib/track/templates";
import { pickTemplateForProfile } from "@/lib/track/applicability";

type TrackGenPayload = PayloadFor<"TRACK_GENERATED", 1>;
type TaskCompletedPayload = PayloadFor<"TRACK_TASK_COMPLETED", 1>;
type TaskReopenedPayload = PayloadFor<"TRACK_TASK_REOPENED", 1>;

export async function projectTrackGenerated(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    templateCode: TrackGenPayload["templateCode"];
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
}

export async function projectTrackTaskCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TaskCompletedPayload },
): Promise<void> {
  await tx.practiceTrackTask.update({
    where: { id: args.payload.trackTaskId },
    data: {
      completedAt: new Date(),
      completedByUserId: args.payload.completedByUserId,
    },
  });
  await maybeMarkTrackComplete(tx, args.practiceId);
}

export async function projectTrackTaskReopened(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TaskReopenedPayload },
): Promise<void> {
  await tx.practiceTrackTask.update({
    where: { id: args.payload.trackTaskId },
    data: { completedAt: null, completedByUserId: null },
  });
  // Re-opening a task clears the track's completedAt if it was set.
  await tx.practiceTrack.update({
    where: { practiceId: args.practiceId },
    data: { completedAt: null },
  });
}

async function maybeMarkTrackComplete(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<void> {
  const remaining = await tx.practiceTrackTask.count({
    where: { practiceId, completedAt: null },
  });
  if (remaining === 0) {
    await tx.practiceTrack.update({
      where: { practiceId },
      data: { completedAt: new Date() },
    });
  }
}

export async function generateTrackIfMissing(
  tx: Prisma.TransactionClient,
  practiceId: string,
  actorUserId: string | null,
): Promise<{ generated: boolean; templateCode: string | null }> {
  const existing = await tx.practiceTrack.findUnique({
    where: { practiceId },
    select: { templateCode: true },
  });
  if (existing) return { generated: false, templateCode: existing.templateCode };

  const profile = await tx.practiceComplianceProfile.findUnique({
    where: { practiceId },
    select: { specialtyCategory: true },
  });
  const templateCode = pickTemplateForProfile({
    specialtyCategory: profile?.specialtyCategory ?? null,
  });
  const tasks = TRACK_TEMPLATES[templateCode];

  await tx.eventLog.create({
    data: {
      practiceId,
      actorUserId,
      type: "TRACK_GENERATED",
      schemaVersion: 1,
      payload: { templateCode, taskCount: tasks.length },
    },
  });
  await projectTrackGenerated(tx, { practiceId, templateCode });
  return { generated: true, templateCode };
}
```

- [ ] **Step 4: Wire generateTrackIfMissing into the practice profile projection**

Modify `src/lib/events/projections/practiceProfile.ts`. After the framework-applicability loop (after line 122), add before the function's closing `}`:

```ts

  // Auto-generate the Compliance Track for this practice if none exists.
  // Idempotent — second + later calls are no-ops since the row already
  // exists. Per docs/specs/v1-ideas-survey.md §1.2.
  const { generateTrackIfMissing } = await import("./track");
  await generateTrackIfMissing(tx, practiceId, null);
```

(Dynamic import to avoid the projections circular import warning the eslint rule has flagged in the past for this file.)

- [ ] **Step 5: Run test — expect PASS**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-generation.test.ts
```

Expected: 2/2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/events/projections/track.ts src/lib/events/projections/practiceProfile.ts tests/integration/track-generation.test.ts && git commit -m "feat(track): projections + auto-generation hook on PRACTICE_PROFILE_UPDATED"
```

---

## Task 5: Auto-completion derivation hook

**Files:**
- Modify: `src/lib/compliance/derivation/rederive.ts`
- Test: extend `tests/integration/track-generation.test.ts` with a third test

- [ ] **Step 1: Write failing test for auto-completion**

Append to `tests/integration/track-generation.test.ts`:

```ts
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { hipaaPrivacyOfficerRule } from "@/lib/compliance/derivation/hipaa";

it("auto-completes track tasks whose requirementCode flips to COMPLIANT", async () => {
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
      projectPracticeProfileUpdated(tx, { practiceId: practice.id, payload }),
  );
  // Now make the user a Privacy Officer + rederive HIPAA_PRIVACY_OFFICER.
  // The track task with requirementCode=HIPAA_PRIVACY_OFFICER should
  // auto-complete.
  const pu = await db.practiceUser.findFirstOrThrow({
    where: { userId: user.id, practiceId: practice.id },
  });
  await db.practiceUser.update({
    where: { id: pu.id },
    data: { isPrivacyOfficer: true },
  });
  // Need a HIPAA framework + a HIPAA_PRIVACY_OFFICER requirement seeded
  // for rederive to find a target. Reuse the test seeding from
  // tests/integration/incident-lifecycle.test.ts pattern.
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
  await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "HIPAA_PRIVACY_OFFICER",
      },
    },
    update: { acceptedEvidenceTypes: ["OFFICER:PRIVACY"] },
    create: {
      frameworkId: framework.id,
      code: "HIPAA_PRIVACY_OFFICER",
      title: "Privacy Officer",
      severity: "CRITICAL",
      weight: 1.5,
      description: "Designate a Privacy Officer.",
      acceptedEvidenceTypes: ["OFFICER:PRIVACY"],
      sortOrder: 10,
    },
  });
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: { enabled: true },
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
    },
  });
  await db.$transaction(async (tx) => {
    await rederiveRequirementStatus(tx, practice.id, "OFFICER:PRIVACY");
  });
  // The track task for HIPAA_PRIVACY_OFFICER should now be completed.
  const completedTask = await db.practiceTrackTask.findFirst({
    where: {
      practiceId: practice.id,
      requirementCode: "HIPAA_PRIVACY_OFFICER",
    },
  });
  expect(completedTask?.completedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run test — expect FAIL (task still open)**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-generation.test.ts -t "auto-completes"
```

Expected: assertion failure (`completedAt` is null).

- [ ] **Step 3: Modify rederive.ts to call the auto-completion hook**

In `src/lib/compliance/derivation/rederive.ts`, find the block where a flip to COMPLIANT lands (after `await tx.complianceItem.upsert(...)` then `await recomputeFrameworkScore(...)` around lines 128-141). Insert after the `recomputeFrameworkScore` call, before the `rederived += 1`:

```ts
    // Auto-complete any Track task whose requirementCode matches and
    // hasn't been completed yet. Fires on derived flips to COMPLIANT;
    // also fires on a USER → COMPLIANT path because the same code path
    // here runs the upsert.
    if (derivedStatus === "COMPLIANT") {
      const matchingTasks = await tx.practiceTrackTask.findMany({
        where: {
          practiceId,
          requirementCode: req.code,
          completedAt: null,
        },
        select: { id: true },
      });
      for (const t of matchingTasks) {
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
          data: {
            completedAt: new Date(),
            completedByUserId: null,
          },
        });
      }
      // If that closed every remaining open task, mark the track complete.
      if (matchingTasks.length > 0) {
        const remaining = await tx.practiceTrackTask.count({
          where: { practiceId, completedAt: null },
        });
        if (remaining === 0) {
          await tx.practiceTrack.update({
            where: { practiceId },
            data: { completedAt: new Date() },
          });
        }
      }
    }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-generation.test.ts -t "auto-completes"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/derivation/rederive.ts tests/integration/track-generation.test.ts && git commit -m "feat(track): auto-complete tasks via requirementCode in rederive"
```

---

## Task 6: Server actions for explicit user clicks

**Files:**
- Create: `src/app/(dashboard)/programs/track/actions.ts`
- Test: `tests/integration/track-task-actions.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/track-task-actions.test.ts`:

```ts
// tests/integration/track-task-actions.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";
import {
  projectTrackTaskCompleted,
  projectTrackTaskReopened,
} from "@/lib/events/projections/track";

async function seedAndGetTrackTask() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `tact-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Action Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const payload = {
    hasInHouseLab: false,
    dispensesControlledSubstances: false,
    medicareParticipant: false,
    billsMedicaid: false,
    subjectToMacraMips: false,
    sendsAutomatedPatientMessages: false,
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
      projectPracticeProfileUpdated(tx, { practiceId: practice.id, payload }),
  );
  const task = await db.practiceTrackTask.findFirstOrThrow({
    where: { practiceId: practice.id },
  });
  return { user, practice, task };
}

describe("Track task projections", () => {
  it("TRACK_TASK_COMPLETED writes completedAt + actor", async () => {
    const { user, practice, task } = await seedAndGetTrackTask();
    const payload = {
      trackTaskId: task.id,
      completedByUserId: user.id,
      reason: "USER" as const,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "TRACK_TASK_COMPLETED",
        payload,
      },
      async (tx) =>
        projectTrackTaskCompleted(tx, { practiceId: practice.id, payload }),
    );
    const updated = await db.practiceTrackTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(updated.completedAt).not.toBeNull();
    expect(updated.completedByUserId).toBe(user.id);
  });

  it("TRACK_TASK_REOPENED clears completedAt", async () => {
    const { user, practice, task } = await seedAndGetTrackTask();
    await db.practiceTrackTask.update({
      where: { id: task.id },
      data: { completedAt: new Date(), completedByUserId: user.id },
    });
    const payload = { trackTaskId: task.id };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "TRACK_TASK_REOPENED",
        payload,
      },
      async (tx) =>
        projectTrackTaskReopened(tx, { practiceId: practice.id, payload }),
    );
    const updated = await db.practiceTrackTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(updated.completedAt).toBeNull();
    expect(updated.completedByUserId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect PASS (projections work) but server action not yet exists**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/track-task-actions.test.ts
```

Expected: 2/2 passing (projections already work from Task 4).

- [ ] **Step 3: Implement server actions**

Create `src/app/(dashboard)/programs/track/actions.ts`:

```ts
// src/app/(dashboard)/programs/track/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectTrackTaskCompleted,
  projectTrackTaskReopened,
} from "@/lib/events/projections/track";

const TaskInput = z.object({
  trackTaskId: z.string().min(1),
});

export async function recordTrackTaskCompletionAction(
  input: z.infer<typeof TaskInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = TaskInput.parse(input);
  // Ownership guard — task must belong to the caller's practice.
  const task = await db.practiceTrackTask.findUnique({
    where: { id: parsed.trackTaskId },
    select: { practiceId: true, completedAt: true },
  });
  if (!task || task.practiceId !== pu.practiceId) {
    throw new Error("Task not found");
  }
  if (task.completedAt) return; // idempotent

  const payload = {
    trackTaskId: parsed.trackTaskId,
    completedByUserId: user.id,
    reason: "USER" as const,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRACK_TASK_COMPLETED",
      payload,
    },
    async (tx) =>
      projectTrackTaskCompleted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/track");
  revalidatePath("/dashboard");
}

export async function reopenTrackTaskAction(
  input: z.infer<typeof TaskInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = TaskInput.parse(input);
  const task = await db.practiceTrackTask.findUnique({
    where: { id: parsed.trackTaskId },
    select: { practiceId: true, completedAt: true },
  });
  if (!task || task.practiceId !== pu.practiceId) {
    throw new Error("Task not found");
  }
  if (!task.completedAt) return; // idempotent

  const payload = { trackTaskId: parsed.trackTaskId };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRACK_TASK_REOPENED",
      payload,
    },
    async (tx) =>
      projectTrackTaskReopened(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/track");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/programs/track/actions.ts tests/integration/track-task-actions.test.ts && git commit -m "feat(track): server actions for user-driven complete + reopen"
```

---

## Task 7: Page + client island

**Files:**
- Create: `src/app/(dashboard)/programs/track/page.tsx`
- Create: `src/app/(dashboard)/programs/track/TrackTaskRow.tsx`

- [ ] **Step 1: Implement client island**

Create `src/app/(dashboard)/programs/track/TrackTaskRow.tsx`:

```tsx
// src/app/(dashboard)/programs/track/TrackTaskRow.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import {
  recordTrackTaskCompletionAction,
  reopenTrackTaskAction,
} from "./actions";

export interface TrackTaskRowProps {
  taskId: string;
  title: string;
  description: string;
  href: string;
  requirementCode: string | null;
  completedAt: string | null;
}

export function TrackTaskRow({
  taskId,
  title,
  description,
  href,
  requirementCode,
  completedAt,
}: TrackTaskRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const handle = async (mode: "complete" | "reopen") => {
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "complete") {
          await recordTrackTaskCompletionAction({ trackTaskId: taskId });
        } else {
          await reopenTrackTaskAction({ trackTaskId: taskId });
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };
  const done = completedAt !== null;
  return (
    <li
      className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between ${
        done ? "bg-muted/30" : ""
      }`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {done && (
            <Check
              className="h-3.5 w-3.5 text-[color:var(--gw-color-compliant)]"
              aria-label="Completed"
            />
          )}
          <p
            className={`text-sm font-medium ${
              done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {title}
          </p>
          {requirementCode && (
            <Badge variant="outline" className="text-[9px]">
              auto-completes
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{description}</p>
        {error && (
          <p className="text-[10px] text-[color:var(--gw-color-risk)]">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button asChild size="sm" variant="outline">
          <Link href={href as Route}>Open</Link>
        </Button>
        {done ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handle("reopen")}
            disabled={isPending}
            className="text-[10px]"
          >
            Reopen
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handle("complete")}
            disabled={isPending}
            className="text-[10px]"
          >
            Mark done
          </Button>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Implement page**

Create `src/app/(dashboard)/programs/track/page.tsx`:

```tsx
// src/app/(dashboard)/programs/track/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Compass } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { EmptyState } from "@/components/gw/EmptyState";
import { TrackTaskRow } from "./TrackTaskRow";

export const metadata = { title: "Get started · My Programs" };
export const dynamic = "force-dynamic";

const WEEK_LABELS: Record<number, string> = {
  1: "Week 1 — Designate + adopt",
  2: "Week 2 — Policies + training",
  4: "Week 4 — Risk + credentials",
  8: "Week 8 — Practice the response",
  12: "Week 12 — Lock in the cadence",
};

export default async function TrackPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const track = await db.practiceTrack.findUnique({
    where: { practiceId: pu.practiceId },
    include: {
      tasks: {
        orderBy: [{ weekTarget: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  // Onboarding gate — no track means the user hasn't filled out the
  // compliance profile yet. Defer to onboarding.
  if (!track) {
    redirect("/onboarding/compliance-profile");
  }

  const total = track.tasks.length;
  const done = track.tasks.filter((t) => t.completedAt !== null).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const grouped = new Map<number, typeof track.tasks>();
  for (const t of track.tasks) {
    const arr = grouped.get(t.weekTarget) ?? [];
    arr.push(t);
    grouped.set(t.weekTarget, arr);
  }
  const weeks = [...grouped.keys()].sort((a, b) => a - b);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Get started" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Get started</h1>
          <p className="text-sm text-muted-foreground">
            A 12-week roadmap built for your practice. Tasks tagged
            <span className="mx-1 rounded border px-1 text-[10px]">auto-completes</span>
            tick off when the underlying compliance work happens; the rest
            need an explicit Mark done click.
          </p>
        </div>
        <ScoreRing score={pct} size={64} strokeWidth={7} assessed />
      </header>

      {track.completedAt && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold text-[color:var(--gw-color-compliant)]">
              ✓ Track complete
            </p>
            <p className="text-xs text-muted-foreground">
              Every task is closed. Review the audit overview to start a
              quarterly cadence —{" "}
              <Link
                href={"/audit/overview" as Route}
                className="underline"
              >
                /audit/overview
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {weeks.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No tasks yet"
          description="The track is empty for your specialty template — that shouldn't happen. Contact support."
        />
      ) : (
        weeks.map((week) => {
          const tasks = grouped.get(week)!;
          const weekDone = tasks.filter((t) => t.completedAt !== null).length;
          return (
            <section key={week} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {WEEK_LABELS[week] ?? `Week ${week}`}
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {weekDone} / {tasks.length} done
                </span>
              </div>
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <TrackTaskRow
                    key={t.id}
                    taskId={t.id}
                    title={t.title}
                    description={t.description}
                    href={t.href}
                    requirementCode={t.requirementCode}
                    completedAt={t.completedAt?.toISOString() ?? null}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/programs/track/ && git commit -m "feat(track): /programs/track page with grouped milestones + client island"
```

---

## Task 8: Sidebar entry

**Files:**
- Modify: `src/components/gw/AppShell/Sidebar.tsx`

- [ ] **Step 1: Add Compass import + new entry**

In `src/components/gw/AppShell/Sidebar.tsx`, find the lucide-react import (top of file) and add `Compass` to the destructured import. Then find the programs list (line ~71 starts `Staff`) and prepend before `Staff`:

```tsx
  { label: "Get started", icon: Compass, href: "/programs/track" as Route },
```

- [ ] **Step 2: Commit**

```bash
git add src/components/gw/AppShell/Sidebar.tsx && git commit -m "ui(sidebar): Get started entry pointing at /programs/track"
```

---

## Task 9: Validate full suite + Cloud SQL push

**Files:**
- None (validation only)

- [ ] **Step 1: Run tsc**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 2: Run eslint on changed surfaces**

```bash
cd D:/GuardWell/guardwell-v2 && npx eslint src/lib/track src/lib/events/projections/track.ts src/lib/events/projections/practiceProfile.ts src/lib/compliance/derivation/rederive.ts src/components/gw/AppShell/Sidebar.tsx "src/app/(dashboard)/programs/track" 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Run full test suite**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run 2>&1 | tail -10
```

Expected: 364 → 369 passing (+3 new track tests + +2 actions = 5 new).

- [ ] **Step 4: Push schema to Cloud SQL**

```bash
cd D:/GuardWell/guardwell-v2 && DATABASE_URL='postgresql://gwapp:PVBcxB8v3JrGiRRwyJEIs8666oRDNZ3B@127.0.0.1:5434/guardwell_v2?schema=public' npx prisma db push --skip-generate
```

Expected: "Your database is now in sync".

---

## Task 10: PR + merge + deploy

- [ ] **Step 1: Push branch**

```bash
cd D:/GuardWell/guardwell-v2 && git push -u origin feat/compliance-track 2>&1 | tail -3
```

- [ ] **Step 2: Create PR**

```bash
cd D:/GuardWell/guardwell-v2 && "/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(track): Compliance Track / Roadmap — auto-generated 12-week onramp" --body "Per docs/specs/v1-ideas-survey.md §1.2. Auto-generates a personalized 12-week roadmap on PRACTICE_PROFILE_UPDATED; tasks with requirementCode auto-complete via the rederive hook; rest require explicit user click."
```

- [ ] **Step 3: Merge**

```bash
cd D:/GuardWell/guardwell-v2 && "/c/Program Files/GitHub CLI/gh.exe" pr merge <PR#> --merge --delete-branch
```

- [ ] **Step 4: Sync local main + verify deploy + Chrome verify**

```bash
cd D:/GuardWell/guardwell-v2 && git checkout main && git pull --ff-only origin main
```

Then poll Cloud Run revision; once active, navigate to `https://v2.app.gwcomp.com/programs/track` and confirm the track renders with milestones grouped by week.

---

## Self-Review

**Spec coverage:**
- Schema (PracticeTrack + PracticeTrackTask + back-relations) → Task 1 ✓
- 4 templates keyed by specialtyCategory → Task 2 ✓
- Auto-generation on PRACTICE_PROFILE_UPDATED → Task 4 ✓
- Auto-completion via requirementCode hook in rederive → Task 5 ✓
- TRACK_GENERATED + TRACK_TASK_COMPLETED + TRACK_TASK_REOPENED events → Task 3 ✓
- recordTrackTaskCompletionAction (+ reopen) → Task 6 ✓
- /programs/track page with milestones + Mark done + ScoreRing → Task 7 ✓
- Sidebar "Get started" before Staff → Task 8 ✓

**Placeholder scan:** None.

**Type consistency:** TrackTemplateCode is the union; TRACK_GENERATED zod schema enums all 4. Task properties (weekTarget, sortOrder, title, description, href, requirementCode) match between template type, projection writes, and page reads.
