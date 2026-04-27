# Allergy / USP 797 §21 Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Allergy/Immunology module as a v2-faithful port of v1's allergy compliance subsystem (USP 797 §21 — allergen extract compounding) — customer-blocking ask. Auto-enables when the practice flags `compoundsAllergens=true`; tracks annual 3-component competency per compounder, monthly equipment checks, anaphylaxis drills, and 9 USP §21 requirement derivations.

**Architecture:** Modules-as-data per ADR-0004 (`RegulatoryFramework` row + 9 `RegulatoryRequirement` rows; module page auto-renders). Event-sourced per ADR-0001 (5 new event types; PracticeUser + new domain tables are projection targets). Faithful port of v1's three-component competency rule (quiz pass + ≥3 fingertip passes for initial / ≥1 for renewal + media fill pass) but emitted via events instead of v1's direct mutations.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 5.22, vitest, Tailwind v4 + Shadcn, existing event-sourcing pipeline (`appendEventAndApply`), existing notification system, existing module-page-contract auto-rendering.

---

## File Structure

**Create:**
- `src/lib/events/projections/allergyCompetency.ts` — `projectAllergyQuizCompleted`, `projectAllergyFingertipTestPassed`, `projectAllergyMediaFillPassed`. Recomputes `isFullyQualified` after each.
- `src/lib/events/projections/allergyEquipment.ts` — `projectAllergyEquipmentCheckLogged`. Triggers rederive of ALLERGY_EMERGENCY_KIT_CURRENT + ALLERGY_REFRIGERATOR_LOG.
- `src/lib/events/projections/allergyDrill.ts` — `projectAllergyDrillLogged`. Triggers rederive of ALLERGY_ANNUAL_DRILL.
- `src/lib/compliance/derivation/allergy.ts` — 4 derivation rules (annualCompetency, emergencyKit, refrigerator, annualDrill) + helper to compute `isFullyQualified`.
- `src/lib/compliance/policies.ts` — extend `ALLERGY_POLICY_CODES` for the 5 manual-attestation requirements that map to policy codes.
- `scripts/seed-allergy.ts` — seeds the framework + 9 requirements + quiz questions ported from v1.
- `scripts/_v1-allergy-quiz-export.json` — exported quiz questions from v1 (60+ questions across 8 categories).
- `src/app/(dashboard)/programs/allergy/page.tsx` — server component, fetches per-staff competency state + recent activity.
- `src/app/(dashboard)/programs/allergy/AllergyDashboard.tsx` — client shell with 3 tabs (Compounders / Equipment / Drills).
- `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx` — per-staff matrix with 3-component status + action buttons.
- `src/app/(dashboard)/programs/allergy/EquipmentTab.tsx` — equipment check log with logger form.
- `src/app/(dashboard)/programs/allergy/DrillTab.tsx` — drill history with logger form.
- `src/app/(dashboard)/programs/allergy/QuizRunner.tsx` — embedded quiz runner client component.
- `src/app/(dashboard)/programs/allergy/actions.ts` — 6 server actions: `submitQuizAttemptAction`, `attestFingertipTestAction`, `attestMediaFillTestAction`, `logEquipmentCheckAction`, `logDrillAction`, `toggleStaffAllergyRequirementAction`.
- `src/app/(dashboard)/programs/allergy/quiz/page.tsx` — standalone quiz route (so the user can re-take in a focused full-screen view).
- `src/lib/notifications/generators/allergy.ts` — 3 generators for drill due, fridge overdue, kit expiring.
- `tests/integration/allergy-competency.test.ts` — competency lifecycle (quiz → fingertip → media fill → isFullyQualified).
- `tests/integration/allergy-equipment.test.ts` — equipment check projection + derivations.
- `tests/integration/allergy-drill.test.ts` — drill projection + derivation.
- `tests/integration/allergy-derivation.test.ts` — 4 derivation rules end-to-end.

**Modify:**
- `prisma/schema.prisma` — add `compoundsAllergens` field on `PracticeComplianceProfile`, `requiresAllergyCompetency` on `PracticeUser`, and 5 new domain models + 2 enums.
- `src/lib/events/registry.ts` — add 5 EVENT_TYPES literals + 5 EVENT_SCHEMAS entries.
- `src/lib/events/projections/practiceProfile.ts` — extend `computeFrameworkApplicability` to include ALLERGY (true when `compoundsAllergens=true`).
- `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx` — add `compoundsAllergens` toggle.
- `src/app/onboarding/compliance-profile/actions.ts` — extend Zod schema + payload.
- `src/app/onboarding/compliance-profile/page.tsx` — pre-fill the new toggle from existing profile.
- `src/lib/events/registry.ts` — extend `PRACTICE_PROFILE_UPDATED` Zod schema with `compoundsAllergens`.
- `src/lib/notifications/generators/index.ts` — register the 3 allergy generators.
- `src/components/gw/AppShell/Sidebar.tsx` — add "Allergy" entry under My Programs (visible only when ALLERGY framework enabled).
- `src/app/(dashboard)/programs/staff/page.tsx` — add "Requires §21 competency" toggle column on the staff list (visible only when ALLERGY framework enabled).

**Test:**
- `tests/integration/allergy-competency.test.ts`
- `tests/integration/allergy-equipment.test.ts`
- `tests/integration/allergy-drill.test.ts`
- `tests/integration/allergy-derivation.test.ts`

---

## Task 1: Schema migration — 5 models + 2 enums + 2 field additions

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma db push --skip-generate` (after Docker Postgres is up)
- Run: `npx prisma generate`

- [ ] **Step 1: Add the two new fields on existing models**

In `prisma/schema.prisma`, locate the `PracticeComplianceProfile` model and add inside the body:

```prisma
  // Allergy/immunology specialty practices that compound allergen extracts
  // are subject to USP 797 §21. Toggling true enables the ALLERGY framework
  // via the PRACTICE_PROFILE_UPDATED projection.
  compoundsAllergens             Boolean @default(false)
```

Locate the `PracticeUser` model and add (next to the existing officer flags):

```prisma
  // USP 797 §21 — per-user gate. true = this user compounds allergen
  // extracts and must complete the annual 3-component competency.
  requiresAllergyCompetency      Boolean @default(false)
```

- [ ] **Step 2: Append the 5 new models + 2 enums at the end of schema.prisma**

```prisma

// ────────────────────────────────────────────────────────────────────────────
// Allergy / USP 797 §21 — allergen extract compounding compliance
// (docs/plans/2026-04-27-allergy-module.md)
// ────────────────────────────────────────────────────────────────────────────

enum AllergyQuizCategory {
  ASEPTIC_TECHNIQUE
  CALCULATIONS
  LABELING
  BEYOND_USE_DATES
  DOCUMENTATION
  EMERGENCY_RESPONSE
  STORAGE_STABILITY
  REGULATIONS
}

enum AllergyCheckType {
  EMERGENCY_KIT
  REFRIGERATOR_TEMP
  SKIN_TEST_SUPPLIES
}

/// Per-staff, per-year record of all three USP 797 §21 competency
/// components. Projected from ALLERGY_QUIZ_COMPLETED +
/// ALLERGY_FINGERTIP_TEST_PASSED + ALLERGY_MEDIA_FILL_PASSED events.
/// `isFullyQualified` is recomputed after every projection write.
model AllergyCompetency {
  id                    String    @id @default(cuid())
  practiceId            String
  practiceUserId        String
  year                  Int       // calendar year (e.g. 2026)
  // Component A: written quiz (ALLERGY_QUIZ_COMPLETED with passed=true)
  quizAttemptId         String?   @unique
  quizPassedAt          DateTime?
  // Component B: gloved fingertip + thumb sampling
  // (USP §21: 3 passes required for initial qualification; 1 for annual renewal)
  fingertipPassCount    Int       @default(0)
  fingertipLastPassedAt DateTime?
  fingertipAttestedById String?   // PracticeUser.id of attesting supervisor
  fingertipNotes        String?   @db.Text
  // Component C: media fill test (ALLERGY_MEDIA_FILL_PASSED)
  mediaFillPassedAt     DateTime?
  mediaFillAttestedById String?
  mediaFillNotes        String?   @db.Text
  // Derived
  isFullyQualified      Boolean   @default(false)
  lastCompoundedAt      DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  practice     Practice            @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  practiceUser PracticeUser        @relation("AllergyCompetencyHolder", fields: [practiceUserId], references: [id], onDelete: Cascade)
  passingAttempt AllergyQuizAttempt? @relation("PassingAttempt", fields: [quizAttemptId], references: [id])

  @@unique([practiceUserId, year])
  @@index([practiceId, year])
  @@index([practiceId, isFullyQualified])
}

/// USP 797 §21 quiz question. Static catalog seeded once via
/// scripts/seed-allergy.ts; not per-practice.
model AllergyQuizQuestion {
  id           String              @id @default(cuid())
  questionText String              @db.Text
  options      Json                // [{id: "a", text: "..."}, {id: "b", text: "..."}]
  correctId    String              // matches the id from options
  explanation  String?             @db.Text
  category     AllergyQuizCategory
  isActive     Boolean             @default(true)
  displayOrder Int                 @default(0)
  createdAt    DateTime            @default(now())

  answers AllergyQuizAnswer[]
}

/// One quiz attempt by a staff member. Result event = ALLERGY_QUIZ_COMPLETED.
model AllergyQuizAttempt {
  id             String    @id @default(cuid())
  practiceId     String
  practiceUserId String
  year           Int
  startedAt      DateTime  @default(now())
  completedAt    DateTime?
  score          Int?      // 0-100 percentage
  passed         Boolean?  // true if score >= 80
  totalQuestions Int       @default(0)
  correctAnswers Int       @default(0)

  practice          Practice            @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  practiceUser      PracticeUser        @relation("AllergyQuizTaker", fields: [practiceUserId], references: [id], onDelete: Cascade)
  answers           AllergyQuizAnswer[]
  passingCompetency AllergyCompetency?  @relation("PassingAttempt")

  @@index([practiceId, practiceUserId, year])
  @@index([practiceUserId, completedAt])
}

/// Per-question answer record on a quiz attempt.
model AllergyQuizAnswer {
  id         String  @id @default(cuid())
  attemptId  String
  questionId String
  selectedId String
  isCorrect  Boolean

  attempt  AllergyQuizAttempt  @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  question AllergyQuizQuestion @relation(fields: [questionId], references: [id])

  @@unique([attemptId, questionId])
}

/// Equipment check log. checkType discriminator drives which fields are set.
/// Projected from ALLERGY_EQUIPMENT_CHECK_LOGGED events.
model AllergyEquipmentCheck {
  id              String           @id @default(cuid())
  practiceId      String
  checkedById     String           // PracticeUser.id
  checkType       AllergyCheckType
  checkedAt       DateTime         @default(now())
  // EMERGENCY_KIT
  epiExpiryDate   DateTime?
  epiLotNumber    String?
  allItemsPresent Boolean?
  itemsReplaced   String?          @db.Text
  // REFRIGERATOR_TEMP
  temperatureC    Float?
  inRange         Boolean?         // acceptable: 2.0–8.0°C
  // shared
  notes           String?          @db.Text
  createdAt       DateTime         @default(now())

  practice  Practice     @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  checkedBy PracticeUser @relation("AllergyCheckPerformedBy", fields: [checkedById], references: [id])

  @@index([practiceId, checkType, checkedAt])
}

/// Anaphylaxis drill log. Annual minimum per practice. Projected from
/// ALLERGY_DRILL_LOGGED events.
model AllergyDrill {
  id                String   @id @default(cuid())
  practiceId        String
  conductedById     String   // PracticeUser.id
  conductedAt       DateTime
  scenario          String   @db.Text
  participantIds    String[]            // PracticeUser.id[]
  durationMinutes   Int?
  observations      String?  @db.Text
  correctiveActions String?  @db.Text
  nextDrillDue      DateTime?
  createdAt         DateTime @default(now())

  practice    Practice     @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  conductedBy PracticeUser @relation("AllergyDrillLedBy", fields: [conductedById], references: [id])

  @@index([practiceId, conductedAt])
}
```

- [ ] **Step 3: Add back-relations on existing models**

In `model Practice { ... }`, add inside the relations block (next to existing `dripSends OnboardingDripSent[]`):

```prisma
  allergyCompetencies     AllergyCompetency[]
  allergyQuizAttempts     AllergyQuizAttempt[]
  allergyEquipmentChecks  AllergyEquipmentCheck[]
  allergyDrills           AllergyDrill[]
```

In `model PracticeUser { ... }`, add inside the relations block (after the existing `credentials` relation):

```prisma
  allergyCompetencies   AllergyCompetency[]    @relation("AllergyCompetencyHolder")
  allergyQuizAttempts   AllergyQuizAttempt[]   @relation("AllergyQuizTaker")
  allergyEquipmentChecks AllergyEquipmentCheck[] @relation("AllergyCheckPerformedBy")
  allergyDrillsLed      AllergyDrill[]         @relation("AllergyDrillLedBy")
```

- [ ] **Step 4: Push schema to local Postgres**

```bash
docker start guardwell-v2-pg
cd /d/GuardWell/guardwell-v2
npx prisma db push --skip-generate
```

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 5: Regenerate Prisma client**

Stop the dev server first (or you'll get EPERM on Windows):

```bash
npx prisma generate
```

Expected: "Generated Prisma Client (...)" with no errors.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/launch-2-allergy-module
git add prisma/schema.prisma
git commit -m "feat(allergy): schema — competency, quiz, equipment, drill models"
```

---

## Task 2: Event registry — 5 new event types + Zod schemas

**Files:**
- Modify: `src/lib/events/registry.ts`

- [ ] **Step 1: Add 5 EVENT_TYPES literals + extend PRACTICE_PROFILE_UPDATED schema**

Find the `EVENT_TYPES` array in `src/lib/events/registry.ts` and add (after `ONBOARDING_FIRST_RUN_COMPLETED`):

```ts
  // Allergy / USP 797 §21 — see docs/plans/2026-04-27-allergy-module.md
  "ALLERGY_QUIZ_COMPLETED",
  "ALLERGY_FINGERTIP_TEST_PASSED",
  "ALLERGY_MEDIA_FILL_PASSED",
  "ALLERGY_EQUIPMENT_CHECK_LOGGED",
  "ALLERGY_DRILL_LOGGED",
```

In the same file, find the `PRACTICE_PROFILE_UPDATED` Zod schema and add `compoundsAllergens: z.boolean()` to its v1 payload.

- [ ] **Step 2: Add the 5 Zod schemas**

In `EVENT_SCHEMAS`, after `ONBOARDING_FIRST_RUN_COMPLETED`:

```ts
  // ALLERGY_QUIZ_COMPLETED — emitted on quiz submission. Carries the
  // attempt id + score so the projection can update both the attempt row
  // and (if passed) the AllergyCompetency row for the year.
  ALLERGY_QUIZ_COMPLETED: {
    1: z.object({
      attemptId: z.string().min(1),
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      score: z.number().int().min(0).max(100),
      passed: z.boolean(),
      correctAnswers: z.number().int().min(0),
      totalQuestions: z.number().int().min(1),
      answers: z.array(
        z.object({
          questionId: z.string().min(1),
          selectedId: z.string().min(1),
          isCorrect: z.boolean(),
        }),
      ),
    }),
  },
  // ALLERGY_FINGertip_TEST_PASSED — supervisor attests a passing
  // gloved-fingertip + thumb sampling. Projection increments
  // fingertipPassCount on the year's AllergyCompetency (creates row
  // if missing) and recomputes isFullyQualified.
  ALLERGY_FINGERTIP_TEST_PASSED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      attestedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_MEDIA_FILL_PASSED — supervisor attests a passing media
  // fill test (incubated 14 days, no turbidity). Idempotent — the
  // projection only sets mediaFillPassedAt if currently null OR the
  // event date is more recent.
  ALLERGY_MEDIA_FILL_PASSED: {
    1: z.object({
      practiceUserId: z.string().min(1),
      year: z.number().int().min(2024).max(3000),
      attestedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_EQUIPMENT_CHECK_LOGGED — emergency kit / fridge / supplies
  // check. Projection writes the AllergyEquipmentCheck row + triggers
  // rederive of ALLERGY_EMERGENCY_KIT_CURRENT + ALLERGY_REFRIGERATOR_LOG.
  ALLERGY_EQUIPMENT_CHECK_LOGGED: {
    1: z.object({
      equipmentCheckId: z.string().min(1),
      checkType: z.enum([
        "EMERGENCY_KIT",
        "REFRIGERATOR_TEMP",
        "SKIN_TEST_SUPPLIES",
      ]),
      checkedByUserId: z.string().min(1),
      checkedAt: z.string().datetime(),
      epiExpiryDate: z.string().datetime().nullable().optional(),
      epiLotNumber: z.string().max(100).nullable().optional(),
      allItemsPresent: z.boolean().nullable().optional(),
      itemsReplaced: z.string().max(2000).nullable().optional(),
      temperatureC: z.number().min(-20).max(40).nullable().optional(),
      inRange: z.boolean().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // ALLERGY_DRILL_LOGGED — anaphylaxis emergency drill conducted at
  // the practice. Projection writes the AllergyDrill row + rederives
  // ALLERGY_ANNUAL_DRILL.
  ALLERGY_DRILL_LOGGED: {
    1: z.object({
      drillId: z.string().min(1),
      conductedByUserId: z.string().min(1),
      conductedAt: z.string().datetime(),
      scenario: z.string().min(1).max(2000),
      participantIds: z.array(z.string().min(1)).min(1),
      durationMinutes: z.number().int().min(0).nullable().optional(),
      observations: z.string().max(2000).nullable().optional(),
      correctiveActions: z.string().max(2000).nullable().optional(),
      nextDrillDue: z.string().datetime().nullable().optional(),
    }),
  },
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/events/registry.ts
git commit -m "feat(allergy): 5 new event types + extend PRACTICE_PROFILE_UPDATED schema"
```

---

## Task 3: Projections (3 files)

**Files:**
- Create: `src/lib/events/projections/allergyCompetency.ts`
- Create: `src/lib/events/projections/allergyEquipment.ts`
- Create: `src/lib/events/projections/allergyDrill.ts`

- [ ] **Step 1: Write the failing competency-projection test**

Create `tests/integration/allergy-competency.test.ts`:

```ts
// tests/integration/allergy-competency.test.ts
//
// Competency lifecycle:
//   ALLERGY_QUIZ_COMPLETED (passed) → quizPassedAt set
//   ALLERGY_FINGERTIP_TEST_PASSED × 3 → count = 3
//   ALLERGY_MEDIA_FILL_PASSED → mediaFillPassedAt set
//   isFullyQualified flips true after all three components

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
} from "@/lib/events/projections/allergyCompetency";
import { randomUUID } from "node:crypto";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `allergy-${Math.random().toString(36).slice(2, 10)}`,
      email: `a-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Allergy Test Clinic", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  const compounder = await db.user.create({
    data: {
      firebaseUid: `compounder-${Math.random().toString(36).slice(2, 10)}`,
      email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const compounderPu = await db.practiceUser.create({
    data: {
      userId: compounder.id,
      practiceId: practice.id,
      role: "STAFF",
      requiresAllergyCompetency: true,
    },
  });
  return { owner, ownerPu, compounder, compounderPu, practice };
}

describe("Allergy competency lifecycle", () => {
  it("flips isFullyQualified true after all 3 components (initial: 3 fingertip passes)", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();

    // Quiz pass
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year,
          score: 92,
          passed: true,
          correctAnswers: 23,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year,
            score: 92,
            passed: true,
            correctAnswers: 23,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );

    // 3 fingertip passes
    for (let i = 0; i < 3; i++) {
      const payload = {
        practiceUserId: compounderPu.id,
        year,
        attestedByUserId: ownerPu.id,
        notes: null,
      };
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_FINGERTIP_TEST_PASSED",
          payload,
        },
        async (tx) =>
          projectAllergyFingertipTestPassed(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }

    // Media fill pass
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year },
      },
    });
    expect(comp.quizPassedAt).not.toBeNull();
    expect(comp.fingertipPassCount).toBe(3);
    expect(comp.mediaFillPassedAt).not.toBeNull();
    expect(comp.isFullyQualified).toBe(true);
  });

  it("renewal year only requires 1 fingertip pass when prior year was qualified", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const lastYear = new Date().getFullYear() - 1;
    const thisYear = lastYear + 1;

    // Pre-seed last year's qualification.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: lastYear,
        quizPassedAt: new Date(`${lastYear}-03-01`),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(`${lastYear}-03-15`),
        mediaFillPassedAt: new Date(`${lastYear}-04-01`),
        isFullyQualified: true,
      },
    });

    // This year: 1 quiz pass + 1 fingertip + 1 media fill should qualify.
    const attemptId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_QUIZ_COMPLETED",
        payload: {
          attemptId,
          practiceUserId: compounderPu.id,
          year: thisYear,
          score: 88,
          passed: true,
          correctAnswers: 22,
          totalQuestions: 25,
          answers: [],
        },
      },
      async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practice.id,
          payload: {
            attemptId,
            practiceUserId: compounderPu.id,
            year: thisYear,
            score: 88,
            passed: true,
            correctAnswers: 22,
            totalQuestions: 25,
            answers: [],
          },
        }),
    );
    const ftPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        payload: ftPayload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload: ftPayload,
        }),
    );
    const mfPayload = {
      practiceUserId: compounderPu.id,
      year: thisYear,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        payload: mfPayload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload: mfPayload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year: thisYear },
      },
    });
    expect(comp.fingertipPassCount).toBe(1);
    expect(comp.isFullyQualified).toBe(true);
  });

  it("is idempotent on duplicate quiz events (same attemptId)", async () => {
    const { owner, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const attemptId = randomUUID();
    const payload = {
      attemptId,
      practiceUserId: compounderPu.id,
      year,
      score: 92,
      passed: true,
      correctAnswers: 23,
      totalQuestions: 25,
      answers: [],
    };
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_QUIZ_COMPLETED",
          payload,
        },
        async (tx) =>
          projectAllergyQuizCompleted(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }
    const attempts = await db.allergyQuizAttempt.findMany({
      where: { id: attemptId },
    });
    expect(attempts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
npx vitest run tests/integration/allergy-competency.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/events/projections/allergyCompetency'`.

- [ ] **Step 3: Implement the competency projection**

Create `src/lib/events/projections/allergyCompetency.ts`:

```ts
// src/lib/events/projections/allergyCompetency.ts
//
// Three projections for the AllergyCompetency lifecycle:
//   ALLERGY_QUIZ_COMPLETED        → upsert AllergyQuizAttempt + (if passed)
//                                   set quizPassedAt on year's competency
//   ALLERGY_FINGERTIP_TEST_PASSED → increment fingertipPassCount
//   ALLERGY_MEDIA_FILL_PASSED     → set mediaFillPassedAt
// After every write, recomputes isFullyQualified per USP §21:
//   - Initial year: 3 fingertip passes required
//   - Renewal year (prior year had isFullyQualified=true): 1 pass required

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type QuizPayload = PayloadFor<"ALLERGY_QUIZ_COMPLETED", 1>;
type FingertipPayload = PayloadFor<"ALLERGY_FINGERTIP_TEST_PASSED", 1>;
type MediaFillPayload = PayloadFor<"ALLERGY_MEDIA_FILL_PASSED", 1>;

async function ensureCompetency(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; practiceUserId: string; year: number },
): Promise<string> {
  const existing = await tx.allergyCompetency.findUnique({
    where: {
      practiceUserId_year: {
        practiceUserId: args.practiceUserId,
        year: args.year,
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.allergyCompetency.create({
    data: {
      practiceId: args.practiceId,
      practiceUserId: args.practiceUserId,
      year: args.year,
    },
    select: { id: true },
  });
  return created.id;
}

async function recomputeIsFullyQualified(
  tx: Prisma.TransactionClient,
  competencyId: string,
): Promise<void> {
  const c = await tx.allergyCompetency.findUniqueOrThrow({
    where: { id: competencyId },
  });
  const priorQualified = await tx.allergyCompetency.findFirst({
    where: {
      practiceUserId: c.practiceUserId,
      year: { lt: c.year },
      isFullyQualified: true,
    },
    select: { id: true },
  });
  const fingertipNeeded = priorQualified ? 1 : 3;
  const qualified =
    Boolean(c.quizPassedAt) &&
    c.fingertipPassCount >= fingertipNeeded &&
    Boolean(c.mediaFillPassedAt);
  if (qualified !== c.isFullyQualified) {
    await tx.allergyCompetency.update({
      where: { id: competencyId },
      data: { isFullyQualified: qualified },
    });
  }
}

export async function projectAllergyQuizCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: QuizPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Idempotent on attemptId: upsert the AllergyQuizAttempt row.
  const attempt = await tx.allergyQuizAttempt.upsert({
    where: { id: payload.attemptId },
    create: {
      id: payload.attemptId,
      practiceId,
      practiceUserId: payload.practiceUserId,
      year: payload.year,
      completedAt: new Date(),
      score: payload.score,
      passed: payload.passed,
      totalQuestions: payload.totalQuestions,
      correctAnswers: payload.correctAnswers,
    },
    update: {
      completedAt: new Date(),
      score: payload.score,
      passed: payload.passed,
      totalQuestions: payload.totalQuestions,
      correctAnswers: payload.correctAnswers,
    },
  });

  // Insert per-question answer rows (skipDuplicates makes this idempotent
  // on the @@unique([attemptId, questionId])).
  if (payload.answers.length > 0) {
    await tx.allergyQuizAnswer.createMany({
      data: payload.answers.map((a) => ({
        attemptId: attempt.id,
        questionId: a.questionId,
        selectedId: a.selectedId,
        isCorrect: a.isCorrect,
      })),
      skipDuplicates: true,
    });
  }

  if (payload.passed) {
    const compId = await ensureCompetency(tx, {
      practiceId,
      practiceUserId: payload.practiceUserId,
      year: payload.year,
    });
    await tx.allergyCompetency.update({
      where: { id: compId },
      data: { quizAttemptId: attempt.id, quizPassedAt: new Date() },
    });
    await recomputeIsFullyQualified(tx, compId);
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_COMPETENCY",
    );
  }
}

export async function projectAllergyFingertipTestPassed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: FingertipPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const compId = await ensureCompetency(tx, {
    practiceId,
    practiceUserId: payload.practiceUserId,
    year: payload.year,
  });
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: {
      fingertipPassCount: { increment: 1 },
      fingertipLastPassedAt: new Date(),
      fingertipAttestedById: payload.attestedByUserId,
      fingertipNotes: payload.notes ?? null,
    },
  });
  await recomputeIsFullyQualified(tx, compId);
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}

export async function projectAllergyMediaFillPassed(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: MediaFillPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const compId = await ensureCompetency(tx, {
    practiceId,
    practiceUserId: payload.practiceUserId,
    year: payload.year,
  });
  await tx.allergyCompetency.update({
    where: { id: compId },
    data: {
      mediaFillPassedAt: new Date(),
      mediaFillAttestedById: payload.attestedByUserId,
      mediaFillNotes: payload.notes ?? null,
    },
  });
  await recomputeIsFullyQualified(tx, compId);
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_COMPETENCY");
}
```

- [ ] **Step 4: Run the test — should now pass**

```bash
npx vitest run tests/integration/allergy-competency.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Implement the equipment projection**

Create `src/lib/events/projections/allergyEquipment.ts`:

```ts
// src/lib/events/projections/allergyEquipment.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"ALLERGY_EQUIPMENT_CHECK_LOGGED", 1>;

export async function projectAllergyEquipmentCheckLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.allergyEquipmentCheck.upsert({
    where: { id: payload.equipmentCheckId },
    create: {
      id: payload.equipmentCheckId,
      practiceId,
      checkedById: payload.checkedByUserId,
      checkType: payload.checkType,
      checkedAt: new Date(payload.checkedAt),
      epiExpiryDate: payload.epiExpiryDate
        ? new Date(payload.epiExpiryDate)
        : null,
      epiLotNumber: payload.epiLotNumber ?? null,
      allItemsPresent: payload.allItemsPresent ?? null,
      itemsReplaced: payload.itemsReplaced ?? null,
      temperatureC: payload.temperatureC ?? null,
      inRange: payload.inRange ?? null,
      notes: payload.notes ?? null,
    },
    update: {
      checkedAt: new Date(payload.checkedAt),
      epiExpiryDate: payload.epiExpiryDate
        ? new Date(payload.epiExpiryDate)
        : null,
      epiLotNumber: payload.epiLotNumber ?? null,
      allItemsPresent: payload.allItemsPresent ?? null,
      itemsReplaced: payload.itemsReplaced ?? null,
      temperatureC: payload.temperatureC ?? null,
      inRange: payload.inRange ?? null,
      notes: payload.notes ?? null,
    },
  });
  if (payload.checkType === "EMERGENCY_KIT") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_EMERGENCY_KIT_CURRENT",
    );
  }
  if (payload.checkType === "REFRIGERATOR_TEMP") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "ALLERGY_REFRIGERATOR_LOG",
    );
  }
}
```

- [ ] **Step 6: Implement the drill projection**

Create `src/lib/events/projections/allergyDrill.ts`:

```ts
// src/lib/events/projections/allergyDrill.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"ALLERGY_DRILL_LOGGED", 1>;

export async function projectAllergyDrillLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.allergyDrill.upsert({
    where: { id: payload.drillId },
    create: {
      id: payload.drillId,
      practiceId,
      conductedById: payload.conductedByUserId,
      conductedAt: new Date(payload.conductedAt),
      scenario: payload.scenario,
      participantIds: payload.participantIds,
      durationMinutes: payload.durationMinutes ?? null,
      observations: payload.observations ?? null,
      correctiveActions: payload.correctiveActions ?? null,
      nextDrillDue: payload.nextDrillDue
        ? new Date(payload.nextDrillDue)
        : null,
    },
    update: {
      conductedAt: new Date(payload.conductedAt),
      scenario: payload.scenario,
      participantIds: payload.participantIds,
      durationMinutes: payload.durationMinutes ?? null,
      observations: payload.observations ?? null,
      correctiveActions: payload.correctiveActions ?? null,
      nextDrillDue: payload.nextDrillDue
        ? new Date(payload.nextDrillDue)
        : null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_ANNUAL_DRILL");
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/events/projections/allergyCompetency.ts src/lib/events/projections/allergyEquipment.ts src/lib/events/projections/allergyDrill.ts tests/integration/allergy-competency.test.ts
git commit -m "feat(allergy): 3 projections + competency lifecycle test"
```

---

## Task 4: Compliance derivation rules

**Files:**
- Create: `src/lib/compliance/derivation/allergy.ts`
- Create: `tests/integration/allergy-derivation.test.ts`
- Modify: `src/lib/compliance/derivation/rederive.ts` (register the allergy rules)

- [ ] **Step 1: Write the failing derivation test**

Create `tests/integration/allergy-derivation.test.ts`:

```ts
// tests/integration/allergy-derivation.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

async function seedFrameworkAndPractice() {
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "ALLERGY" },
    update: {},
    create: { code: "ALLERGY", name: "Allergy / USP 797 §21", sortOrder: 100 },
  });
  // 4 derived requirements (others are policy-attestation).
  for (const r of [
    { code: "ALLERGY_COMPETENCY", title: "Annual 3-component competency", severity: "CRITICAL", weight: 1 },
    { code: "ALLERGY_EMERGENCY_KIT_CURRENT", title: "Emergency kit current", severity: "HIGH", weight: 1 },
    { code: "ALLERGY_REFRIGERATOR_LOG", title: "Refrigerator log within 30d", severity: "HIGH", weight: 1 },
    { code: "ALLERGY_ANNUAL_DRILL", title: "Anaphylaxis drill within 365d", severity: "HIGH", weight: 1 },
  ]) {
    await db.regulatoryRequirement.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code,
        title: r.title,
        frameworkId: fw.id,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: [],
      },
    });
  }
  const owner = await db.user.create({
    data: {
      firebaseUid: `der-${Math.random().toString(36).slice(2, 10)}`,
      email: `d-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Derive Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  await db.practiceFramework.create({
    data: {
      practiceId: practice.id,
      frameworkId: fw.id,
      enabled: true,
      enabledAt: new Date(),
      scoreCache: 0,
      scoreLabel: "At Risk",
      lastScoredAt: new Date(),
    },
  });
  return { practice, owner, framework: fw };
}

describe("Allergy derivations", () => {
  it("ALLERGY_COMPETENCY → COMPLIANT only when all required compounders are isFullyQualified", async () => {
    const { practice } = await seedFrameworkAndPractice();
    // Add a required compounder with no competency record.
    const compounder = await db.user.create({
      data: {
        firebaseUid: `c-${Math.random().toString(36).slice(2, 10)}`,
        email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const compounderPu = await db.practiceUser.create({
      data: {
        userId: compounder.id,
        practiceId: practice.id,
        role: "STAFF",
        requiresAllergyCompetency: true,
      },
    });

    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_COMPETENCY");
    });
    let item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_COMPETENCY" } },
    });
    expect(item.status).toBe("GAP");

    // Mark fully qualified.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year: new Date().getFullYear(),
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(),
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_COMPETENCY");
    });
    item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_COMPETENCY" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_EMERGENCY_KIT_CURRENT → COMPLIANT when latest EMERGENCY_KIT check ≤90 days, allItemsPresent=true, epi not expired", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date(),
        epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        allItemsPresent: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(
        tx,
        practice.id,
        "ALLERGY_EMERGENCY_KIT_CURRENT",
      );
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirement: { code: "ALLERGY_EMERGENCY_KIT_CURRENT" },
      },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_REFRIGERATOR_LOG → COMPLIANT when ≥1 in-range REFRIGERATOR_TEMP check in last 30 days", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        temperatureC: 5.0,
        inRange: true,
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_REFRIGERATOR_LOG");
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_REFRIGERATOR_LOG" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });

  it("ALLERGY_ANNUAL_DRILL → COMPLIANT when most recent drill within 365 days", async () => {
    const { practice, owner } = await seedFrameworkAndPractice();
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: owner.id, practiceId: practice.id },
    });
    await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: ownerPu.id,
        conductedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        scenario: "Patient develops anaphylaxis 5 minutes after injection",
        participantIds: [ownerPu.id],
      },
    });
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "ALLERGY_ANNUAL_DRILL");
    });
    const item = await db.complianceItem.findFirstOrThrow({
      where: { practiceId: practice.id, requirement: { code: "ALLERGY_ANNUAL_DRILL" } },
    });
    expect(item.status).toBe("COMPLIANT");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
npx vitest run tests/integration/allergy-derivation.test.ts
```

Expected: FAIL — likely "no derivation rule registered" or stays GAP.

- [ ] **Step 3: Implement the derivation rules**

Create `src/lib/compliance/derivation/allergy.ts`:

```ts
// src/lib/compliance/derivation/allergy.ts
//
// Four derived rules for the ALLERGY framework. The other 5 §21
// requirements (designated area, hand hygiene, BUD labeling, vial
// labeling, records retention) are POLICY:* attestation evidence and
// derive via the existing policy-derivation pipeline.

import type { Prisma } from "@prisma/client";

const KIT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FRIDGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DRILL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export interface DeriveResult {
  status: "COMPLIANT" | "GAP" | "NOT_STARTED";
  reason?: string;
}

/** Are all `requiresAllergyCompetency=true` users isFullyQualified for the current year? */
export async function deriveAllergyCompetency(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeriveResult> {
  const required = await tx.practiceUser.findMany({
    where: {
      practiceId,
      requiresAllergyCompetency: true,
      removedAt: null,
    },
    select: { id: true },
  });
  if (required.length === 0) return { status: "NOT_STARTED" };
  const year = new Date().getFullYear();
  const qualified = await tx.allergyCompetency.findMany({
    where: {
      practiceId,
      year,
      isFullyQualified: true,
      practiceUserId: { in: required.map((r) => r.id) },
    },
    select: { practiceUserId: true },
  });
  if (qualified.length === required.length) return { status: "COMPLIANT" };
  return {
    status: "GAP",
    reason: `${qualified.length}/${required.length} compounders fully qualified for ${year}`,
  };
}

export async function deriveAllergyEmergencyKit(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeriveResult> {
  const latest = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "EMERGENCY_KIT" },
    orderBy: { checkedAt: "desc" },
  });
  if (!latest) return { status: "NOT_STARTED" };
  if (latest.checkedAt.getTime() < Date.now() - KIT_WINDOW_MS) {
    return { status: "GAP", reason: "Last kit check >90 days old" };
  }
  if (!latest.allItemsPresent) {
    return { status: "GAP", reason: "Last check reported missing items" };
  }
  if (latest.epiExpiryDate && latest.epiExpiryDate.getTime() < Date.now()) {
    return { status: "GAP", reason: "Epinephrine expired" };
  }
  return { status: "COMPLIANT" };
}

export async function deriveAllergyRefrigeratorLog(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeriveResult> {
  const latest = await tx.allergyEquipmentCheck.findFirst({
    where: {
      practiceId,
      checkType: "REFRIGERATOR_TEMP",
      checkedAt: { gt: new Date(Date.now() - FRIDGE_WINDOW_MS) },
    },
    orderBy: { checkedAt: "desc" },
  });
  if (!latest) return { status: "NOT_STARTED" };
  if (!latest.inRange) {
    return { status: "GAP", reason: "Latest reading out of 2-8°C range" };
  }
  return { status: "COMPLIANT" };
}

export async function deriveAllergyAnnualDrill(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeriveResult> {
  const latest = await tx.allergyDrill.findFirst({
    where: { practiceId },
    orderBy: { conductedAt: "desc" },
  });
  if (!latest) return { status: "NOT_STARTED" };
  if (latest.conductedAt.getTime() < Date.now() - DRILL_WINDOW_MS) {
    return { status: "GAP", reason: "Last drill >365 days ago" };
  }
  return { status: "COMPLIANT" };
}

export const ALLERGY_DERIVATIONS = {
  ALLERGY_COMPETENCY: deriveAllergyCompetency,
  ALLERGY_EMERGENCY_KIT_CURRENT: deriveAllergyEmergencyKit,
  ALLERGY_REFRIGERATOR_LOG: deriveAllergyRefrigeratorLog,
  ALLERGY_ANNUAL_DRILL: deriveAllergyAnnualDrill,
} as const;
```

- [ ] **Step 4: Wire the allergy rules into the central rederive helper**

Open `src/lib/compliance/derivation/rederive.ts`. Find the dispatcher that maps requirement codes to derivation functions (likely a `switch` or registry object). Add an entry mapping each of the 4 ALLERGY codes to its corresponding function from `ALLERGY_DERIVATIONS`. The exact integration depends on the existing dispatcher shape — read the file first and follow the same pattern used for HIPAA / OSHA derivations.

- [ ] **Step 5: Run the test — should pass**

```bash
npx vitest run tests/integration/allergy-derivation.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/compliance/derivation/allergy.ts src/lib/compliance/derivation/rederive.ts tests/integration/allergy-derivation.test.ts
git commit -m "feat(allergy): 4 derivation rules + tests"
```

---

## Task 5: Seed framework + 9 requirements + USP 797 §21 course

**Files:**
- Create: `scripts/seed-allergy.ts`
- Modify: `scripts/seed-training.ts` to also load `_v2-allergy-courses.json` if present

- [ ] **Step 1: Build the seed**

Create `scripts/seed-allergy.ts`:

```ts
// scripts/seed-allergy.ts
//
// Seeds the ALLERGY framework + 9 requirements + a baseline set of
// quiz questions for the USP 797 §21 quiz. Idempotent — every upsert
// is keyed on a stable code.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const REQUIREMENTS = [
  // Manual policy attestations (5)
  {
    code: "ALLERGY_DESIGNATED_COMPOUNDING_AREA",
    title: "Designated compounding area (USP §21.1)",
    severity: "MEDIUM",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_COMPOUNDING_AREA_SOP"],
  },
  {
    code: "ALLERGY_HAND_HYGIENE_GARBING",
    title: "Hand hygiene + garbing procedures (USP §21.2)",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_HAND_HYGIENE_GARBING_SOP"],
  },
  {
    code: "ALLERGY_BUD_LABELING_PROCEDURE",
    title: "Beyond-Use Date (BUD) labeling SOP (USP §21.4)",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_BUD_LABELING_SOP"],
  },
  {
    code: "ALLERGY_VIAL_LABELING_PROCEDURE",
    title: "Vial labeling SOP (USP §21.5)",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_VIAL_LABELING_SOP"],
  },
  {
    code: "ALLERGY_RECORDS_RETENTION_3YR",
    title: "Compounding records retained ≥3 years (state pharmacy practice acts)",
    severity: "MEDIUM",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_RECORDS_RETENTION_SOP"],
  },
  // Derived (4) — see src/lib/compliance/derivation/allergy.ts
  {
    code: "ALLERGY_COMPETENCY",
    title: "Annual 3-component competency for every compounder (USP §21.3)",
    severity: "CRITICAL",
    weight: 2,
    acceptedEvidenceTypes: [],
  },
  {
    code: "ALLERGY_EMERGENCY_KIT_CURRENT",
    title: "Emergency kit current (epi unexpired, all items present) within 90 days",
    severity: "CRITICAL",
    weight: 2,
    acceptedEvidenceTypes: [],
  },
  {
    code: "ALLERGY_REFRIGERATOR_LOG",
    title: "Refrigerator temp log within 30 days, in 2–8°C range",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: [],
  },
  {
    code: "ALLERGY_ANNUAL_DRILL",
    title: "Anaphylaxis drill within last 365 days",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: [],
  },
];

async function main() {
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "ALLERGY" },
    update: {
      name: "Allergy / USP 797 §21",
      shortName: "Allergy",
      sortOrder: 100,
    },
    create: {
      code: "ALLERGY",
      name: "Allergy / USP 797 §21",
      shortName: "Allergy",
      sortOrder: 100,
    },
  });
  console.log(`Framework: ${fw.code} (${fw.id})`);

  for (const r of REQUIREMENTS) {
    await db.regulatoryRequirement.upsert({
      where: { code: r.code },
      update: {
        title: r.title,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        frameworkId: fw.id,
      },
      create: {
        code: r.code,
        title: r.title,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        frameworkId: fw.id,
      },
    });
  }
  console.log(`Upserted ${REQUIREMENTS.length} requirements`);

  // Seed the static quiz questions catalog from _v1-allergy-quiz-export.json
  // if it exists. The file is a faithful export from v1's
  // AllergyQuizQuestion table (60+ questions across 8 categories).
  // Skipping the seed if the file is absent lets the schema migration
  // land before the content is ported.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const exportPath = path.join("scripts", "_v1-allergy-quiz-export.json");
  try {
    const text = await fs.readFile(exportPath, "utf-8");
    const questions = JSON.parse(text) as Array<{
      questionText: string;
      options: Array<{ id: string; text: string }>;
      correctId: string;
      explanation?: string;
      category: string;
      displayOrder: number;
    }>;
    for (const q of questions) {
      const stableId = `allergy-q-${q.category.toLowerCase()}-${q.displayOrder}`;
      await db.allergyQuizQuestion.upsert({
        where: { id: stableId },
        update: {
          questionText: q.questionText,
          options: q.options,
          correctId: q.correctId,
          explanation: q.explanation ?? null,
          category: q.category as never,
          displayOrder: q.displayOrder,
          isActive: true,
        },
        create: {
          id: stableId,
          questionText: q.questionText,
          options: q.options,
          correctId: q.correctId,
          explanation: q.explanation ?? null,
          category: q.category as never,
          displayOrder: q.displayOrder,
          isActive: true,
        },
      });
    }
    console.log(`Upserted ${questions.length} quiz questions`);
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      console.log(
        "scripts/_v1-allergy-quiz-export.json not present — skipping quiz seed (run again after exporting from v1)",
      );
    } else {
      throw err;
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

- [ ] **Step 2: Run the seed**

```bash
cd /d/GuardWell/guardwell-v2
npx tsx scripts/seed-allergy.ts
```

Expected: "Framework: ALLERGY ..." + "Upserted 9 requirements" + (if export file exists) "Upserted N quiz questions".

- [ ] **Step 3: Export quiz questions from v1**

This is a one-time export. Connect to v1's database (the user does this — credentials are theirs):

```bash
# v1 DB — use a quick script to export AllergyQuizQuestion as JSON
docker exec guardwell-postgres psql -U gwapp -d guardwell -c \
  "COPY (SELECT json_agg(t) FROM (SELECT \"questionText\", options, \"correctId\", explanation, category::text, \"displayOrder\" FROM \"AllergyQuizQuestion\" WHERE \"isActive\" = true ORDER BY category, \"displayOrder\") t) TO STDOUT" \
  > scripts/_v1-allergy-quiz-export.json
```

If v1's container name or DB user differ, adjust accordingly. Re-run the seed after to populate questions.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-allergy.ts scripts/_v1-allergy-quiz-export.json
git commit -m "feat(allergy): seed framework + 9 requirements + quiz questions ported from v1"
```

- [ ] **Step 5: Add the USP_797_ALLERGEN_COMPOUNDING course to seed-training**

Open `scripts/seed-training.ts`. Find the existing course-loading logic (it likely reads a JSON file into TrainingCourse rows). Add a load of `_v2-allergy-courses.json` (which already exists at the repo root) so the course shows up in the practice's training catalog.

```bash
npx tsx scripts/seed-training.ts
git add scripts/seed-training.ts
git commit -m "feat(allergy): seed USP 797 §21 training course"
```

---

## Task 6: Compliance profile field — `compoundsAllergens` toggle

**Files:**
- Modify: `src/app/onboarding/compliance-profile/actions.ts`
- Modify: `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx`
- Modify: `src/app/onboarding/compliance-profile/page.tsx`
- Modify: `src/lib/events/projections/practiceProfile.ts`

- [ ] **Step 1: Extend the action's Zod schema**

Open `src/app/onboarding/compliance-profile/actions.ts`. Add `compoundsAllergens: z.boolean()` to the `Input` schema and pass it through into the event payload.

- [ ] **Step 2: Add the toggle to the form**

In `ComplianceProfileForm.tsx`, add a new entry to the `TOGGLES` array (before the existing `sendsAutomatedPatientMessages`):

```tsx
{
  key: "compoundsAllergens",
  title: "Compounds allergen extracts",
  description:
    "You mix or dilute allergen extracts on-site for skin testing or immunotherapy. Subject to USP 797 §21.",
  enables: "ALLERGY",
},
```

Extend the `initial` interface, `toggles` state, and `saveComplianceProfileAction` call site.

- [ ] **Step 3: Pre-fill from existing profile in page.tsx**

In `compliance-profile/page.tsx`, add `compoundsAllergens: existing?.compoundsAllergens ?? false` to the `initial` prop.

- [ ] **Step 4: Extend the projection**

In `src/lib/events/projections/practiceProfile.ts`, find `computeFrameworkApplicability` and add:

```ts
ALLERGY: profile.compoundsAllergens,
```

Also extend the upsert payload to write `compoundsAllergens`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/onboarding/compliance-profile/ src/lib/events/projections/practiceProfile.ts
git commit -m "feat(allergy): compoundsAllergens toggle on compliance profile"
```

---

## Task 7: `/programs/allergy` server component + dashboard shell

**Files:**
- Create: `src/app/(dashboard)/programs/allergy/page.tsx`
- Create: `src/app/(dashboard)/programs/allergy/AllergyDashboard.tsx`
- Modify: `src/components/gw/AppShell/Sidebar.tsx` (add "Allergy" entry, gated on framework enabled)

- [ ] **Step 1: Implement the page**

Create `src/app/(dashboard)/programs/allergy/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { Syringe } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { AllergyDashboard } from "./AllergyDashboard";

export const metadata = { title: "Allergy · My Programs" };
export const dynamic = "force-dynamic";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

export default async function AllergyProgramPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  // Visible only when the framework is enabled.
  const framework = await db.practiceFramework.findFirst({
    where: {
      practiceId: pu.practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!framework) {
    redirect("/programs" as Route);
  }
  const year = new Date().getFullYear();
  const [members, competencies, equipmentChecks, drills] = await Promise.all([
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId, removedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ requiresAllergyCompetency: "desc" }, { joinedAt: "asc" }],
    }),
    db.allergyCompetency.findMany({
      where: { practiceId: pu.practiceId, year },
    }),
    db.allergyEquipmentCheck.findMany({
      where: {
        practiceId: pu.practiceId,
        checkedAt: { gte: new Date(Date.now() - SIX_MONTHS_MS) },
      },
      orderBy: { checkedAt: "desc" },
    }),
    db.allergyDrill.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { conductedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Allergy" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Syringe className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Allergy / USP 797 §21
          </h1>
          <p className="text-sm text-muted-foreground">
            Annual 3-component competency for every compounder, monthly
            equipment + fridge logs, and anaphylaxis drills. Drives the
            ALLERGY module score.
          </p>
        </div>
      </header>
      <AllergyDashboard
        canManage={pu.role === "OWNER" || pu.role === "ADMIN"}
        currentPracticeUserId={pu.id}
        year={year}
        members={members.map((m) => ({
          id: m.id,
          role: m.role,
          requiresAllergyCompetency: m.requiresAllergyCompetency,
          name:
            [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
            m.user.email ||
            "Unknown",
          email: m.user.email,
        }))}
        competencies={competencies.map((c) => ({
          id: c.id,
          practiceUserId: c.practiceUserId,
          year: c.year,
          quizPassedAt: c.quizPassedAt?.toISOString() ?? null,
          fingertipPassCount: c.fingertipPassCount,
          fingertipLastPassedAt: c.fingertipLastPassedAt?.toISOString() ?? null,
          mediaFillPassedAt: c.mediaFillPassedAt?.toISOString() ?? null,
          isFullyQualified: c.isFullyQualified,
        }))}
        equipmentChecks={equipmentChecks.map((e) => ({
          id: e.id,
          checkType: e.checkType,
          checkedAt: e.checkedAt.toISOString(),
          epiExpiryDate: e.epiExpiryDate?.toISOString() ?? null,
          allItemsPresent: e.allItemsPresent,
          temperatureC: e.temperatureC,
          inRange: e.inRange,
          notes: e.notes,
        }))}
        drills={drills.map((d) => ({
          id: d.id,
          conductedAt: d.conductedAt.toISOString(),
          scenario: d.scenario,
          participantIds: d.participantIds,
          durationMinutes: d.durationMinutes,
          observations: d.observations,
          correctiveActions: d.correctiveActions,
          nextDrillDue: d.nextDrillDue?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
```

- [ ] **Step 2: Build the dashboard shell with 3 tabs**

Create `src/app/(dashboard)/programs/allergy/AllergyDashboard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompetencyTab, type CompetencyTabProps } from "./CompetencyTab";
import { EquipmentTab, type EquipmentTabProps } from "./EquipmentTab";
import { DrillTab, type DrillTabProps } from "./DrillTab";

export interface AllergyDashboardProps {
  canManage: boolean;
  currentPracticeUserId: string;
  year: number;
  members: CompetencyTabProps["members"];
  competencies: CompetencyTabProps["competencies"];
  equipmentChecks: EquipmentTabProps["checks"];
  drills: DrillTabProps["drills"];
}

export function AllergyDashboard(props: AllergyDashboardProps) {
  const [tab, setTab] = useState("compounders");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="compounders">Compounders</TabsTrigger>
        <TabsTrigger value="equipment">Equipment</TabsTrigger>
        <TabsTrigger value="drills">Drills</TabsTrigger>
      </TabsList>
      <TabsContent value="compounders" className="pt-4">
        <CompetencyTab
          canManage={props.canManage}
          year={props.year}
          members={props.members}
          competencies={props.competencies}
          currentPracticeUserId={props.currentPracticeUserId}
        />
      </TabsContent>
      <TabsContent value="equipment" className="pt-4">
        <EquipmentTab canManage={props.canManage} checks={props.equipmentChecks} />
      </TabsContent>
      <TabsContent value="drills" className="pt-4">
        <DrillTab
          canManage={props.canManage}
          members={props.members}
          drills={props.drills}
        />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 3: Add Allergy to the sidebar (visible only when ALLERGY framework enabled)**

Open `src/components/gw/AppShell/Sidebar.tsx`. The sidebar already receives `myComplianceItems` from the dashboard layout. The "My Programs" section is hardcoded; add an "Allergy" link conditionally based on whether the practice has the ALLERGY framework enabled. The simplest pattern: pass an `enabledFrameworks` array (or derive from `myComplianceItems`) and conditionally render the link. Match the existing pattern of static-link-with-conditional-render.

- [ ] **Step 4: Commit (Tab components are stubs for now — see Task 8-10)**

Stub the 3 tab components first so the page compiles:

```bash
# Create stubs that just render their props as JSON so the page compiles.
# Real implementations land in Task 8 (Competency), Task 9 (Equipment), Task 10 (Drill).
```

For each of `CompetencyTab.tsx`, `EquipmentTab.tsx`, `DrillTab.tsx`:

```tsx
"use client";
export interface CompetencyTabProps { /* TODO Task 8 */ }
export function CompetencyTab(_: CompetencyTabProps) { return <p>compounders — Task 8</p>; }
```

(Repeat shape for Equipment + Drill.)

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/programs/allergy/ src/components/gw/AppShell/Sidebar.tsx
git commit -m "feat(allergy): /programs/allergy shell + sidebar entry (tabs stubbed)"
```

---

## Task 8: Competency tab (per-staff matrix + actions)

**Files:**
- Replace stub at: `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx`
- Create: `src/app/(dashboard)/programs/allergy/actions.ts`

- [ ] **Step 1: Implement the server actions for competency events**

Create `src/app/(dashboard)/programs/allergy/actions.ts`:

```ts
// src/app/(dashboard)/programs/allergy/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
} from "@/lib/events/projections/allergyCompetency";
import {
  projectAllergyEquipmentCheckLogged,
} from "@/lib/events/projections/allergyEquipment";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import { db } from "@/lib/db";

async function requireAdmin() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can manage allergy compliance");
  }
  return { user, pu };
}

const FingertipInput = z.object({
  practiceUserId: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

export async function attestFingertipTestAction(
  input: z.infer<typeof FingertipInput>,
) {
  const { user, pu } = await requireAdmin();
  const parsed = FingertipInput.parse(input);
  const year = new Date().getFullYear();
  const payload = {
    practiceUserId: parsed.practiceUserId,
    year,
    attestedByUserId: pu.id,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_FINGERTIP_TEST_PASSED",
      payload,
    },
    async (tx) =>
      projectAllergyFingertipTestPassed(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const MediaFillInput = z.object({
  practiceUserId: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

export async function attestMediaFillTestAction(
  input: z.infer<typeof MediaFillInput>,
) {
  const { user, pu } = await requireAdmin();
  const parsed = MediaFillInput.parse(input);
  const year = new Date().getFullYear();
  const payload = {
    practiceUserId: parsed.practiceUserId,
    year,
    attestedByUserId: pu.id,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_MEDIA_FILL_PASSED",
      payload,
    },
    async (tx) =>
      projectAllergyMediaFillPassed(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const ToggleStaffInput = z.object({
  practiceUserId: z.string().min(1),
  required: z.boolean(),
});

export async function toggleStaffAllergyRequirementAction(
  input: z.infer<typeof ToggleStaffInput>,
) {
  const { pu } = await requireAdmin();
  const parsed = ToggleStaffInput.parse(input);
  const target = await db.practiceUser.findUnique({
    where: { id: parsed.practiceUserId },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  await db.practiceUser.update({
    where: { id: parsed.practiceUserId },
    data: { requiresAllergyCompetency: parsed.required },
  });
  revalidatePath("/programs/allergy");
  revalidatePath("/programs/staff");
}

const QuizSubmitInput = z.object({
  attemptId: z.string().min(1),
  answers: z.array(
    z.object({ questionId: z.string().min(1), selectedId: z.string().min(1) }),
  ),
});

export async function submitQuizAttemptAction(
  input: z.infer<typeof QuizSubmitInput>,
): Promise<{ score: number; passed: boolean }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = QuizSubmitInput.parse(input);

  const questions = await db.allergyQuizQuestion.findMany({
    where: { id: { in: parsed.answers.map((a) => a.questionId) } },
    select: { id: true, correctId: true },
  });
  const correctMap = new Map(questions.map((q) => [q.id, q.correctId]));
  let correct = 0;
  const annotated = parsed.answers.map((a) => {
    const isCorrect = correctMap.get(a.questionId) === a.selectedId;
    if (isCorrect) correct += 1;
    return { questionId: a.questionId, selectedId: a.selectedId, isCorrect };
  });
  const total = parsed.answers.length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 100);
  const passed = score >= 80;
  const year = new Date().getFullYear();

  const payload = {
    attemptId: parsed.attemptId,
    practiceUserId: pu.id,
    year,
    score,
    passed,
    correctAnswers: correct,
    totalQuestions: total,
    answers: annotated,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_QUIZ_COMPLETED",
      payload,
    },
    async (tx) =>
      projectAllergyQuizCompleted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
  return { score, passed };
}

const EquipmentInput = z.object({
  checkType: z.enum([
    "EMERGENCY_KIT",
    "REFRIGERATOR_TEMP",
    "SKIN_TEST_SUPPLIES",
  ]),
  epiExpiryDate: z.string().nullable().optional(),
  epiLotNumber: z.string().max(100).nullable().optional(),
  allItemsPresent: z.boolean().nullable().optional(),
  itemsReplaced: z.string().max(2000).nullable().optional(),
  temperatureC: z.number().min(-20).max(40).nullable().optional(),
  inRange: z.boolean().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function logEquipmentCheckAction(
  input: z.infer<typeof EquipmentInput>,
) {
  const { user, pu } = await requireAdmin();
  const parsed = EquipmentInput.parse(input);
  const equipmentCheckId = randomUUID();
  const payload = {
    equipmentCheckId,
    checkType: parsed.checkType,
    checkedByUserId: pu.id,
    checkedAt: new Date().toISOString(),
    epiExpiryDate: parsed.epiExpiryDate
      ? new Date(parsed.epiExpiryDate).toISOString()
      : null,
    epiLotNumber: parsed.epiLotNumber ?? null,
    allItemsPresent: parsed.allItemsPresent ?? null,
    itemsReplaced: parsed.itemsReplaced ?? null,
    temperatureC: parsed.temperatureC ?? null,
    inRange: parsed.inRange ?? null,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
      payload,
    },
    async (tx) =>
      projectAllergyEquipmentCheckLogged(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const DrillInput = z.object({
  conductedAt: z.string().min(1),
  scenario: z.string().min(1).max(2000),
  participantIds: z.array(z.string().min(1)).min(1),
  durationMinutes: z.number().int().min(0).nullable().optional(),
  observations: z.string().max(2000).nullable().optional(),
  correctiveActions: z.string().max(2000).nullable().optional(),
  nextDrillDue: z.string().nullable().optional(),
});

export async function logDrillAction(input: z.infer<typeof DrillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = DrillInput.parse(input);
  const drillId = randomUUID();
  const payload = {
    drillId,
    conductedByUserId: pu.id,
    conductedAt: new Date(parsed.conductedAt).toISOString(),
    scenario: parsed.scenario,
    participantIds: parsed.participantIds,
    durationMinutes: parsed.durationMinutes ?? null,
    observations: parsed.observations ?? null,
    correctiveActions: parsed.correctiveActions ?? null,
    nextDrillDue: parsed.nextDrillDue
      ? new Date(parsed.nextDrillDue).toISOString()
      : null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_DRILL_LOGGED",
      payload,
    },
    async (tx) =>
      projectAllergyDrillLogged(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}
```

- [ ] **Step 2: Implement the CompetencyTab UI**

Replace `CompetencyTab.tsx` with a per-staff matrix:
- One row per active member
- Required-toggle (admin only)
- Quiz status (date if passed this year, "Take quiz" link to `/programs/allergy/quiz` for self)
- Fingertip count (3 of 3 / 1 of 3 — depending on initial vs renewal — with "Attest" button for admins)
- Media fill status with "Attest" button
- Overall isFullyQualified badge

Include modals for "Attest fingertip" and "Attest media fill" calling the respective server actions.

(Skip the full code listing here — refer to `src/app/(dashboard)/programs/allergy/CompetencyTab.tsx` after implementation; the v1 reference at `D:/GuardWell/guardwell/src/app/(dashboard)/allergy/allergy-dashboard.tsx` is the visual blueprint, but use Shadcn `<Dialog>` + `<Button>` per v2 conventions.)

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/programs/allergy/CompetencyTab.tsx src/app/\(dashboard\)/programs/allergy/actions.ts
git commit -m "feat(allergy): competency tab with attestation actions"
```

---

## Task 9: Equipment tab + logger form

**Files:**
- Replace stub at: `src/app/(dashboard)/programs/allergy/EquipmentTab.tsx`

- [ ] **Step 1: Implement the equipment tab**

Render two sub-sections:
- **Emergency kit** — most-recent check at top, "Log a check" form (`epiExpiryDate`, `epiLotNumber`, `allItemsPresent` checkbox, `itemsReplaced` textarea, `notes`). Calls `logEquipmentCheckAction({checkType: "EMERGENCY_KIT", ...})`.
- **Refrigerator temperature** — temp log with "Log a reading" form (`temperatureC`, auto-compute `inRange` (2-8°C), notes). Calls action with `checkType: "REFRIGERATOR_TEMP"`.
- Skip-test supplies — minor surface, can be added later.

Match v1's UX from `D:/GuardWell/guardwell/src/app/(dashboard)/allergy/allergy-dashboard.tsx` — port the visual structure, use v2 Shadcn primitives.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/programs/allergy/EquipmentTab.tsx
git commit -m "feat(allergy): equipment check tab + logger form"
```

---

## Task 10: Drill tab + logger form

**Files:**
- Replace stub at: `src/app/(dashboard)/programs/allergy/DrillTab.tsx`

- [ ] **Step 1: Implement the drill tab**

Render:
- "Log a drill" form (date, scenario textarea, participants multi-select from members, duration, observations, corrective actions, nextDrillDue). Calls `logDrillAction(...)`.
- Drill history list (most recent 20) with expand-to-see-detail toggle per row.
- Banner if no drill within last 365 days.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/programs/allergy/DrillTab.tsx
git commit -m "feat(allergy): drill log tab + logger form"
```

---

## Task 11: Quiz runner — `/programs/allergy/quiz`

**Files:**
- Create: `src/app/(dashboard)/programs/allergy/quiz/page.tsx`
- Create: `src/app/(dashboard)/programs/allergy/QuizRunner.tsx`

- [ ] **Step 1: Implement the quiz page**

The page server-component fetches all active `AllergyQuizQuestion` rows + creates an attempt id (uuid) up-front. The client `<QuizRunner>` walks the user through questions one at a time (or as a single-page form), then calls `submitQuizAttemptAction` with all selected answers and the attempt id. Result panel shows score + pass/fail + which questions to review.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/programs/allergy/quiz/ src/app/\(dashboard\)/programs/allergy/QuizRunner.tsx
git commit -m "feat(allergy): quiz runner at /programs/allergy/quiz"
```

---

## Task 12: Notification generators (3 new generators)

**Files:**
- Create: `src/lib/notifications/generators/allergy.ts`
- Modify: `src/lib/notifications/generators/index.ts` (register the new generators)

- [ ] **Step 1: Implement the 3 generators**

Create `src/lib/notifications/generators/allergy.ts`:

```ts
// src/lib/notifications/generators/allergy.ts
//
// Three notifications for the allergy program:
//   - Anaphylaxis drill due (next drill within N days OR overdue)
//   - Refrigerator temp log overdue (>30 days since last check)
//   - Emergency kit expiring (epi within 60 days)

import type { Prisma } from "@prisma/client";
import type { NotificationProposal } from "./types";

const DRILL_DUE_WINDOW_DAYS = 30;
const FRIDGE_OVERDUE_DAYS = 30;
const KIT_EXPIRY_WINDOW_DAYS = 60;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function generateAllergyNotifications(
  db: Prisma.TransactionClient,
  practiceId: string,
  recipientUserIds: string[],
): Promise<NotificationProposal[]> {
  const enabled = await db.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!enabled) return [];

  const proposals: NotificationProposal[] = [];

  // Drill due
  const lastDrill = await db.allergyDrill.findFirst({
    where: { practiceId },
    orderBy: { conductedAt: "desc" },
  });
  if (lastDrill?.nextDrillDue) {
    const daysUntil = Math.round(
      (lastDrill.nextDrillDue.getTime() - Date.now()) / ONE_DAY_MS,
    );
    if (daysUntil <= DRILL_DUE_WINDOW_DAYS) {
      for (const userId of recipientUserIds) {
        proposals.push({
          practiceId,
          userId,
          type: "ALLERGY_DRILL_DUE",
          severity: daysUntil < 0 ? "HIGH" : "MEDIUM",
          title:
            daysUntil < 0
              ? "Anaphylaxis drill overdue"
              : `Anaphylaxis drill due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
          body: `Schedule the next anaphylaxis drill at /programs/allergy.`,
          href: "/programs/allergy",
          entityKey: `allergy-drill-${lastDrill.id}`,
        });
      }
    }
  } else if (!lastDrill) {
    for (const userId of recipientUserIds) {
      proposals.push({
        practiceId,
        userId,
        type: "ALLERGY_DRILL_DUE",
        severity: "MEDIUM",
        title: "Anaphylaxis drill not yet on file",
        body: "Run your first anaphylaxis drill to satisfy USP §21 §21.6.",
        href: "/programs/allergy",
        entityKey: "allergy-drill-initial",
      });
    }
  }

  // Refrigerator overdue
  const lastFridge = await db.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "REFRIGERATOR_TEMP" },
    orderBy: { checkedAt: "desc" },
  });
  if (
    !lastFridge ||
    Date.now() - lastFridge.checkedAt.getTime() >
      FRIDGE_OVERDUE_DAYS * ONE_DAY_MS
  ) {
    for (const userId of recipientUserIds) {
      proposals.push({
        practiceId,
        userId,
        type: "ALLERGY_FRIDGE_OVERDUE",
        severity: "HIGH",
        title: "Refrigerator temperature log overdue",
        body: "Log a temperature reading at /programs/allergy.",
        href: "/programs/allergy",
        entityKey: lastFridge ? `fridge-${lastFridge.id}` : "fridge-initial",
      });
    }
  }

  // Kit expiring
  const lastKit = await db.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "EMERGENCY_KIT" },
    orderBy: { checkedAt: "desc" },
  });
  if (lastKit?.epiExpiryDate) {
    const daysUntil = Math.round(
      (lastKit.epiExpiryDate.getTime() - Date.now()) / ONE_DAY_MS,
    );
    if (daysUntil <= KIT_EXPIRY_WINDOW_DAYS) {
      for (const userId of recipientUserIds) {
        proposals.push({
          practiceId,
          userId,
          type: "ALLERGY_KIT_EXPIRING",
          severity: daysUntil < 0 ? "HIGH" : "MEDIUM",
          title:
            daysUntil < 0
              ? "Epinephrine in the emergency kit has expired"
              : `Epinephrine expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
          body: "Replace the auto-injector at /programs/allergy.",
          href: "/programs/allergy",
          entityKey: `allergy-kit-${lastKit.id}`,
        });
      }
    }
  }

  return proposals;
}
```

- [ ] **Step 2: Register the generator**

Open `src/lib/notifications/generators/index.ts` and add `generateAllergyNotifications` to the central registry / generator list (`generateAllNotifications` aggregator).

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/generators/
git commit -m "feat(allergy): notification generators for drill, fridge, kit"
```

---

## Task 13: Equipment + drill integration tests

**Files:**
- Create: `tests/integration/allergy-equipment.test.ts`
- Create: `tests/integration/allergy-drill.test.ts`

- [ ] **Step 1: Write the equipment test**

```ts
// tests/integration/allergy-equipment.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { randomUUID } from "node:crypto";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `eq-${Math.random().toString(36).slice(2, 10)}`,
      email: `e-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Equip Test", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, ownerPu, practice };
}

describe("Allergy equipment check projection", () => {
  it("inserts an EMERGENCY_KIT check row", async () => {
    const { owner, ownerPu, practice } = await seed();
    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "EMERGENCY_KIT" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      epiLotNumber: "ABC123",
      allItemsPresent: true,
      itemsReplaced: null,
      temperatureC: null,
      inRange: null,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyEquipmentCheckLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const row = await db.allergyEquipmentCheck.findUniqueOrThrow({
      where: { id },
    });
    expect(row.checkType).toBe("EMERGENCY_KIT");
    expect(row.allItemsPresent).toBe(true);
  });

  it("is idempotent on equipmentCheckId", async () => {
    const { owner, ownerPu, practice } = await seed();
    const id = randomUUID();
    const payload = {
      equipmentCheckId: id,
      checkType: "REFRIGERATOR_TEMP" as const,
      checkedByUserId: ownerPu.id,
      checkedAt: new Date().toISOString(),
      epiExpiryDate: null,
      epiLotNumber: null,
      allItemsPresent: null,
      itemsReplaced: null,
      temperatureC: 5.0,
      inRange: true,
      notes: null,
    };
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
          payload,
        },
        async (tx) =>
          projectAllergyEquipmentCheckLogged(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }
    const rows = await db.allergyEquipmentCheck.findMany({
      where: { id },
    });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write the drill test**

```ts
// tests/integration/allergy-drill.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import { randomUUID } from "node:crypto";

describe("Allergy drill projection", () => {
  it("inserts a drill row with participants", async () => {
    const owner = await db.user.create({
      data: {
        firebaseUid: `dr-${Math.random().toString(36).slice(2, 10)}`,
        email: `d-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "Drill Test", primaryState: "AZ" },
    });
    const ownerPu = await db.practiceUser.create({
      data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
    });
    const drillId = randomUUID();
    const payload = {
      drillId,
      conductedByUserId: ownerPu.id,
      conductedAt: new Date().toISOString(),
      scenario: "Patient develops anaphylaxis 5 minutes after injection",
      participantIds: [ownerPu.id],
      durationMinutes: 12,
      observations: "All staff knew where the kit was",
      correctiveActions: null,
      nextDrillDue: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_DRILL_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyDrillLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const row = await db.allergyDrill.findUniqueOrThrow({
      where: { id: drillId },
    });
    expect(row.scenario).toContain("anaphylaxis");
    expect(row.participantIds).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run all 4 allergy tests**

```bash
npx vitest run tests/integration/allergy- 2>&1 | tail -10
```

Expected: PASS for `allergy-competency`, `allergy-equipment`, `allergy-drill`, `allergy-derivation`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/allergy-equipment.test.ts tests/integration/allergy-drill.test.ts
git commit -m "test(allergy): equipment + drill projection tests"
```

---

## Task 14: Module page section + sidebar conditional

**Files:**
- The `/modules/allergy` page auto-renders from the framework + requirement rows seeded in Task 5 — verify it does, no new code needed unless the module-page-contract requires per-framework Section G Extras.
- Modify: `src/components/gw/AppShell/Sidebar.tsx` (already done in Task 7 Step 3 — verify the sidebar gates correctly)

- [ ] **Step 1: Hit `/modules/allergy` in the dev server**

Make sure the framework auto-renders. If section G ("Extras") is empty and you want a custom card (recent compounding activity, fully-qualified count), add it via the per-framework extras registry (see `docs/specs/module-page-contract.md`).

- [ ] **Step 2: Commit any extras additions**

---

## Task 15: Chrome verify + push branch + PR

- [ ] **Step 1: Run full test suite**

```bash
docker start guardwell-v2-pg
cd /d/GuardWell/guardwell-v2
npm test -- --run
```

Expected: every prior test plus the 4 new allergy test files pass.

- [ ] **Step 2: tsc clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Chrome verify on dev server**

- Sign in (see prior session memory for credentials path)
- Visit `/onboarding/compliance-profile`, toggle "Compounds allergen extracts" on, save
- Verify the ALLERGY framework appears in the sidebar
- Visit `/programs/allergy` → see the 3-tab dashboard
- On the Compounders tab: toggle a staff member's "requires §21 competency" → confirm the row shows in the matrix
- Take the quiz at `/programs/allergy/quiz`, score ≥80%, verify the competency row shows quizPassedAt set
- Attest fingertip 3× → fingertipPassCount = 3
- Attest media fill → isFullyQualified flips
- Visit `/modules/allergy` → ALLERGY_COMPETENCY shows COMPLIANT
- Log an EMERGENCY_KIT check + a REFRIGERATOR_TEMP check → both requirements flip COMPLIANT
- Log an anaphylaxis drill → ALLERGY_ANNUAL_DRILL flips COMPLIANT

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/launch-2-allergy-module
gh pr create --title "feat(launch-2): Allergy / USP 797 §21 module" --body "..."
```

PR body summarizes the 5 schema additions, 5 events, 4 derivations, the program surface, and links the customer ask. List all 9 USP §21 requirements with their derivation status.

- [ ] **Step 5: Stop, await user instruction to merge**
