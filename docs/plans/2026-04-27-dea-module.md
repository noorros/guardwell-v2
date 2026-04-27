# DEA Controlled Substances Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore controlled-substance recordkeeping for DEA-registered practices: 5 new Prisma models + UI for inventory/orders/disposals/theft-loss + 3 federal-form PDFs (Form 41 disposal, Form 106 theft-loss, biennial inventory). Master plan estimates ~5–6 days; this plan splits into **4 mergeable phases** so each phase ships as its own PR and risk stays contained.

**Architecture:** Same v2 patterns: event-sourcing-without-CQRS (every mutation goes through `appendEventAndApply`), polymorphic Evidence subsystem (already shipped) for any future file uploads, `@react-pdf/renderer` for PDFs, vi.mock auth pattern for tests. The DEA framework + 8 requirements are already seeded in `scripts/seed-dea.ts` (PR #60-era, never run on prod). Phase A activates the seed.

**Tech Stack:** Prisma 5.22, Next.js 16, `@react-pdf/renderer`, vitest with the established test pattern.

---

## Pre-existing infrastructure (verified by survey)

- `RegulatoryFramework` row for DEA + 8 `RegulatoryRequirement` rows are READY in `scripts/seed-dea.ts` (lines 1–231). NOT YET RUN on dev or prod.
- DEA derivation rule exists at `src/lib/compliance/derivation/dea.ts` (single rule: `DEA_REGISTRATION` ← credential)
- DEA Section G Extras exists at `src/components/gw/Extras/DeaExtras.tsx` (perpetual inventory calculator + biennial reminder, localStorage-backed) — already wired into `Extras/registry.tsx:47`
- `Incident.type` enum has `DEA_THEFT_LOSS` (used by Phase D)
- `/modules/[code]/page.tsx` already supports DEA dynamically — once the framework is enabled, `/modules/dea` will render

## Phased breakdown

| Phase | Scope | Effort | Phase outputs |
|---|---|---|---|
| **A** (this plan) | Schema (5 models) + event registry (4 types) + projections (4 fns) + framework activation + projection tests | 1.5–2 days, 1 PR | Backend ready; framework live; no user-facing UI yet |
| **B** (next session) | `/programs/dea` shell + Inventory tab + Inventory PDF route + tests | 1.5 days, 1 PR | Inventory tab live, Inventory PDF works |
| **C** (next session) | Orders tab + Disposals tab + Form 41 PDF + tests | 1.5 days, 1 PR | 3 tabs live, Form 41 PDF works |
| **D** (next session) | Theft & Loss tab + Form 106 PDF + tests + sidebar entry + polish | 1 day, 1 PR | Full module live, all 3 PDFs work, tests pass |

**Each phase ships as its own PR.** This document covers Phase A only with task-level detail; Phases B–D get a high-level outline at the bottom for context.

---

## Phase A — Schema + Events + Projections + Framework Activation

### File Structure (Phase A)

**Create:**
- `src/lib/events/projections/dea.ts` — 4 projection functions: `projectDeaInventoryRecorded`, `projectDeaOrderReceived`, `projectDeaDisposalCompleted`, `projectDeaTheftLossReported`
- `tests/integration/dea-projection.test.ts` — happy-path test per projection (4 tests minimum)

**Modify:**
- `prisma/schema.prisma` — add 5 models + 1 enum (`DeaSchedule`)
- `src/lib/events/registry.ts` — add 4 new EventType entries + Zod schemas + add the names to the `EVENT_TYPES` const array
- `tests/setup.ts` — add `deaInventoryItem.deleteMany()`, `deaInventory.deleteMany()`, `deaOrderRecord.deleteMany()`, `deaDisposalRecord.deleteMany()`, `deaTheftLossReport.deleteMany()` to the `afterEach` cleanup, BEFORE `practiceUser.deleteMany()` (FK ordering)

**Run (after schema landing, before merge):**
- `npx tsx scripts/seed-dea.ts` against dev (and against prod via cloud-sql-proxy, before the PR merges)

---

### Task A1: Schema additions

**File:** `prisma/schema.prisma`

- [ ] **Step A1.1: Add `DeaSchedule` enum**

Add near the top of the file, alongside other framework-specific enums:

```prisma
// DEA controlled-substance schedules per 21 CFR §1308. Schedule I is
// almost never relevant for healthcare (research-only) but listed for
// completeness; II–V are the practical tracking surface.
enum DeaSchedule {
  CI
  CII
  CIIN
  CIII
  CIIIN
  CIV
  CV
}
```

- [ ] **Step A1.2: Add 5 new models**

Add this block to the file. Place it just before the `RegulatoryFramework` model (toward the end of the file):

```prisma
// =====================================================================
// DEA Controlled Substances Act recordkeeping (21 CFR Parts 1304, 1311)
// =====================================================================

// A point-in-time inventory snapshot. Required biennially per 21 CFR
// §1304.11; many practices conduct monthly perpetual inventories on top.
// Has many DeaInventoryItem children (one per drug counted).
model DeaInventory {
  id              String              @id @default(cuid())
  practiceId      String
  asOfDate        DateTime
  conductedByUserId String
  witnessUserId   String?
  notes           String?             @db.Text
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  practice        Practice            @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  items           DeaInventoryItem[]

  @@index([practiceId, asOfDate])
}

// One drug counted in an inventory. Multiple per inventory.
model DeaInventoryItem {
  id          String       @id @default(cuid())
  inventoryId String
  drugName    String
  ndc         String?
  schedule    DeaSchedule
  strength    String?
  quantity    Int
  unit        String       @default("tablets")
  createdAt   DateTime     @default(now())
  inventory   DeaInventory @relation(fields: [inventoryId], references: [id], onDelete: Cascade)

  @@index([inventoryId])
}

// Receipt of a controlled-substance order (Form 222 paper trail or CSOS
// electronic order). One row per drug received.
model DeaOrderRecord {
  id                  String      @id @default(cuid())
  practiceId          String
  orderedByUserId     String
  supplierName        String
  supplierDeaNumber   String?
  orderedAt           DateTime
  receivedAt          DateTime?
  form222Number       String?
  drugName            String
  ndc                 String?
  schedule            DeaSchedule
  strength            String?
  quantity            Int
  unit                String      @default("tablets")
  notes               String?     @db.Text
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  practice            Practice    @relation(fields: [practiceId], references: [id], onDelete: Cascade)

  @@index([practiceId, orderedAt])
}

// Disposal of controlled substances to a DEA-registered reverse
// distributor (or other authorized disposal method). One row per drug.
// Form 41 PDF generates from this row's data.
model DeaDisposalRecord {
  id                          String      @id @default(cuid())
  practiceId                  String
  disposedByUserId            String
  witnessUserId               String?
  reverseDistributorName      String
  reverseDistributorDeaNumber String?
  disposalDate                DateTime
  disposalMethod              String      @default("REVERSE_DISTRIBUTOR") // REVERSE_DISTRIBUTOR | DEA_TAKE_BACK | DEA_DESTRUCTION | OTHER
  drugName                    String
  ndc                         String?
  schedule                    DeaSchedule
  strength                    String?
  quantity                    Int
  unit                        String      @default("tablets")
  form41Filed                 Boolean     @default(false)
  notes                       String?     @db.Text
  createdAt                   DateTime    @default(now())
  updatedAt                   DateTime    @updatedAt
  practice                    Practice    @relation(fields: [practiceId], references: [id], onDelete: Cascade)

  @@index([practiceId, disposalDate])
}

// Theft or loss of controlled substances. Federal: Form 106 must be
// filed with DEA Field Division within 1 business day of discovery.
// optional incidentId links to the broader Incident if the loss was
// reported as a DEA_THEFT_LOSS-type incident.
model DeaTheftLossReport {
  id                       String      @id @default(cuid())
  practiceId               String
  incidentId               String?
  reportedByUserId         String
  discoveredAt             DateTime
  reportedAt               DateTime    @default(now())
  lossType                 String      // THEFT | LOSS | IN_TRANSIT_LOSS | DESTRUCTION_DURING_THEFT
  drugName                 String
  ndc                      String?
  schedule                 DeaSchedule
  strength                 String?
  quantityLost             Int
  unit                     String      @default("tablets")
  methodOfDiscovery        String?     @db.Text
  lawEnforcementNotified   Boolean     @default(false)
  lawEnforcementAgency     String?
  lawEnforcementCaseNumber String?
  deaNotifiedAt            DateTime?
  form106SubmittedAt       DateTime?
  notes                    String?     @db.Text
  createdAt                DateTime    @default(now())
  updatedAt                DateTime    @updatedAt
  practice                 Practice    @relation(fields: [practiceId], references: [id], onDelete: Cascade)

  @@index([practiceId, discoveredAt])
  @@index([incidentId])
}
```

- [ ] **Step A1.3: Add the back-relations on Practice**

Find the `Practice` model. In the relations block at the bottom (where other `model[]` back-relations live), add:

```prisma
  deaInventories       DeaInventory[]
  deaOrders            DeaOrderRecord[]
  deaDisposals         DeaDisposalRecord[]
  deaTheftLossReports  DeaTheftLossReport[]
```

- [ ] **Step A1.4: Generate + push to dev**

```bash
cd D:/GuardWell/guardwell-v2 && npx prisma generate && npx prisma db push --skip-generate
```

If `prisma generate` fails due to Windows DLL lock (dev server holding the file), the TS client still regenerates and `db push --skip-generate` is the recovery path used in chunks 2 + 3. Verify by:
```bash
grep -c "DeaInventory" node_modules/.prisma/client/index.d.ts
```
Expected: ≥10 (each model adds many type entries).

- [ ] **Step A1.5: Verify tsc clean**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit 2>&1 | tail -5
```
Expected: clean.

- [ ] **Step A1.6: Commit**

```bash
git add prisma/schema.prisma && git commit -m "schema(dea): add 5 controlled-substance models + DeaSchedule enum"
```

---

### Task A2: Event registry — 4 new event types

**File:** `src/lib/events/registry.ts`

- [ ] **Step A2.1: Add the type names to `EVENT_TYPES`**

Find the `EVENT_TYPES` array. Add these 4 new names alongside the existing incident events (group them at the end of the incident block before `INVITATION_ACCEPTED` to keep the file grouped by domain):

```ts
  "DEA_INVENTORY_RECORDED",
  "DEA_ORDER_RECEIVED",
  "DEA_DISPOSAL_COMPLETED",
  "DEA_THEFT_LOSS_REPORTED",
```

- [ ] **Step A2.2: Add the 4 Zod schemas**

In the `EVENT_SCHEMAS` block, add these entries. Place them grouped with other domain blocks (e.g., near the AUDIT_PREP_PACKET_GENERATED block):

```ts
  // 21 CFR §1304.11 biennial inventory snapshot. Items list is the
  // count at the moment of inventory; subsequent dispense/order/disposal
  // events evolve the on-hand count as a derivation, not as a mutation
  // of inventory items themselves.
  DEA_INVENTORY_RECORDED: {
    1: z.object({
      inventoryId: z.string().min(1),
      asOfDate: z.string().datetime(),
      conductedByUserId: z.string().min(1),
      witnessUserId: z.string().min(1).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      items: z
        .array(
          z.object({
            drugName: z.string().min(1).max(200),
            ndc: z.string().max(50).nullable().optional(),
            schedule: z.enum([
              "CI",
              "CII",
              "CIIN",
              "CIII",
              "CIIIN",
              "CIV",
              "CV",
            ]),
            strength: z.string().max(100).nullable().optional(),
            quantity: z.number().int().min(0),
            unit: z.string().max(50),
          }),
        )
        .min(1),
    }),
  },
  // Form 222 / CSOS receipt of controlled-substance order. One event per
  // line item received (a multi-drug Form 222 fires multiple events).
  DEA_ORDER_RECEIVED: {
    1: z.object({
      orderRecordId: z.string().min(1),
      orderedByUserId: z.string().min(1),
      supplierName: z.string().min(1).max(200),
      supplierDeaNumber: z.string().max(50).nullable().optional(),
      orderedAt: z.string().datetime(),
      receivedAt: z.string().datetime().nullable().optional(),
      form222Number: z.string().max(50).nullable().optional(),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantity: z.number().int().min(1),
      unit: z.string().max(50),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Surrender to reverse distributor / DEA take-back / on-site
  // destruction. One event per drug disposed. Generates Form 41.
  DEA_DISPOSAL_COMPLETED: {
    1: z.object({
      disposalRecordId: z.string().min(1),
      disposedByUserId: z.string().min(1),
      witnessUserId: z.string().min(1).nullable().optional(),
      reverseDistributorName: z.string().min(1).max(200),
      reverseDistributorDeaNumber: z.string().max(50).nullable().optional(),
      disposalDate: z.string().datetime(),
      disposalMethod: z.enum([
        "REVERSE_DISTRIBUTOR",
        "DEA_TAKE_BACK",
        "DEA_DESTRUCTION",
        "OTHER",
      ]),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantity: z.number().int().min(1),
      unit: z.string().max(50),
      form41Filed: z.boolean(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  // Theft or loss event. Federal Form 106 must be filed within 1
  // business day of discovery. Optional incidentId links to a broader
  // Incident if the practice already opened a DEA_THEFT_LOSS incident.
  DEA_THEFT_LOSS_REPORTED: {
    1: z.object({
      reportId: z.string().min(1),
      incidentId: z.string().min(1).nullable().optional(),
      reportedByUserId: z.string().min(1),
      discoveredAt: z.string().datetime(),
      lossType: z.enum([
        "THEFT",
        "LOSS",
        "IN_TRANSIT_LOSS",
        "DESTRUCTION_DURING_THEFT",
      ]),
      drugName: z.string().min(1).max(200),
      ndc: z.string().max(50).nullable().optional(),
      schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
      strength: z.string().max(100).nullable().optional(),
      quantityLost: z.number().int().min(1),
      unit: z.string().max(50),
      methodOfDiscovery: z.string().max(2000).nullable().optional(),
      lawEnforcementNotified: z.boolean(),
      lawEnforcementAgency: z.string().max(200).nullable().optional(),
      lawEnforcementCaseNumber: z.string().max(100).nullable().optional(),
      deaNotifiedAt: z.string().datetime().nullable().optional(),
      form106SubmittedAt: z.string().datetime().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
```

- [ ] **Step A2.3: Verify tsc clean (transient errors expected — fix in A3)**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit 2>&1 | tail -5
```

Possible: tsc passes already since no callers exist yet.

- [ ] **Step A2.4: Commit**

```bash
git add src/lib/events/registry.ts && git commit -m "events: add DEA_INVENTORY_RECORDED + ORDER_RECEIVED + DISPOSAL_COMPLETED + THEFT_LOSS_REPORTED v1"
```

---

### Task A3: Projections — `src/lib/events/projections/dea.ts`

**File:** `src/lib/events/projections/dea.ts` (NEW)

The 4 projections each persist their respective row. `projectDeaInventoryRecorded` writes both the parent + child rows in one transaction.

- [ ] **Step A3.1: Create the file**

```ts
// src/lib/events/projections/dea.ts
//
// Projections for DEA controlled-substance events. Each projection runs
// inside the appendEventAndApply transaction; failure rolls back the
// EventLog write per ADR-0001.

import type { Prisma } from "@prisma/client";

interface InventoryItemPayload {
  drugName: string;
  ndc?: string | null;
  schedule: "CI" | "CII" | "CIIN" | "CIII" | "CIIIN" | "CIV" | "CV";
  strength?: string | null;
  quantity: number;
  unit: string;
}

interface InventoryRecordedPayload {
  inventoryId: string;
  asOfDate: string;
  conductedByUserId: string;
  witnessUserId?: string | null;
  notes?: string | null;
  items: InventoryItemPayload[];
}

export async function projectDeaInventoryRecorded(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: InventoryRecordedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaInventory.create({
    data: {
      id: payload.inventoryId,
      practiceId,
      asOfDate: new Date(payload.asOfDate),
      conductedByUserId: payload.conductedByUserId,
      witnessUserId: payload.witnessUserId ?? null,
      notes: payload.notes ?? null,
      items: {
        create: payload.items.map((it) => ({
          drugName: it.drugName,
          ndc: it.ndc ?? null,
          schedule: it.schedule,
          strength: it.strength ?? null,
          quantity: it.quantity,
          unit: it.unit,
        })),
      },
    },
  });
}

interface OrderReceivedPayload {
  orderRecordId: string;
  orderedByUserId: string;
  supplierName: string;
  supplierDeaNumber?: string | null;
  orderedAt: string;
  receivedAt?: string | null;
  form222Number?: string | null;
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantity: number;
  unit: string;
  notes?: string | null;
}

export async function projectDeaOrderReceived(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: OrderReceivedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaOrderRecord.create({
    data: {
      id: payload.orderRecordId,
      practiceId,
      orderedByUserId: payload.orderedByUserId,
      supplierName: payload.supplierName,
      supplierDeaNumber: payload.supplierDeaNumber ?? null,
      orderedAt: new Date(payload.orderedAt),
      receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : null,
      form222Number: payload.form222Number ?? null,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantity: payload.quantity,
      unit: payload.unit,
      notes: payload.notes ?? null,
    },
  });
}

interface DisposalCompletedPayload {
  disposalRecordId: string;
  disposedByUserId: string;
  witnessUserId?: string | null;
  reverseDistributorName: string;
  reverseDistributorDeaNumber?: string | null;
  disposalDate: string;
  disposalMethod:
    | "REVERSE_DISTRIBUTOR"
    | "DEA_TAKE_BACK"
    | "DEA_DESTRUCTION"
    | "OTHER";
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantity: number;
  unit: string;
  form41Filed: boolean;
  notes?: string | null;
}

export async function projectDeaDisposalCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DisposalCompletedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaDisposalRecord.create({
    data: {
      id: payload.disposalRecordId,
      practiceId,
      disposedByUserId: payload.disposedByUserId,
      witnessUserId: payload.witnessUserId ?? null,
      reverseDistributorName: payload.reverseDistributorName,
      reverseDistributorDeaNumber: payload.reverseDistributorDeaNumber ?? null,
      disposalDate: new Date(payload.disposalDate),
      disposalMethod: payload.disposalMethod,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantity: payload.quantity,
      unit: payload.unit,
      form41Filed: payload.form41Filed,
      notes: payload.notes ?? null,
    },
  });
}

interface TheftLossReportedPayload {
  reportId: string;
  incidentId?: string | null;
  reportedByUserId: string;
  discoveredAt: string;
  lossType: "THEFT" | "LOSS" | "IN_TRANSIT_LOSS" | "DESTRUCTION_DURING_THEFT";
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantityLost: number;
  unit: string;
  methodOfDiscovery?: string | null;
  lawEnforcementNotified: boolean;
  lawEnforcementAgency?: string | null;
  lawEnforcementCaseNumber?: string | null;
  deaNotifiedAt?: string | null;
  form106SubmittedAt?: string | null;
  notes?: string | null;
}

export async function projectDeaTheftLossReported(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TheftLossReportedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaTheftLossReport.create({
    data: {
      id: payload.reportId,
      practiceId,
      incidentId: payload.incidentId ?? null,
      reportedByUserId: payload.reportedByUserId,
      discoveredAt: new Date(payload.discoveredAt),
      lossType: payload.lossType,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantityLost: payload.quantityLost,
      unit: payload.unit,
      methodOfDiscovery: payload.methodOfDiscovery ?? null,
      lawEnforcementNotified: payload.lawEnforcementNotified,
      lawEnforcementAgency: payload.lawEnforcementAgency ?? null,
      lawEnforcementCaseNumber: payload.lawEnforcementCaseNumber ?? null,
      deaNotifiedAt: payload.deaNotifiedAt
        ? new Date(payload.deaNotifiedAt)
        : null,
      form106SubmittedAt: payload.form106SubmittedAt
        ? new Date(payload.form106SubmittedAt)
        : null,
      notes: payload.notes ?? null,
    },
  });
}
```

- [ ] **Step A3.2: Verify tsc + commit**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit 2>&1 | tail -5
git add src/lib/events/projections/dea.ts && git commit -m "events(dea): 4 projection functions for inventory/order/disposal/theft-loss"
```

---

### Task A4: Test setup cleanup

**File:** `tests/setup.ts`

- [ ] **Step A4.1: Add DEA cleanup lines**

In the `afterEach` block, add the new cleanup BEFORE `practiceUser.deleteMany()` (FK ordering matters — Practice cascades to Dea*, but explicit deletes are safer when tests skip the cascade):

```ts
  // DEA models reference Practice (via FK) and PracticeUser (no FK; just
  // userId scalars). Cascade-on-Practice handles cleanup, but explicit
  // deletes here keep test setup deterministic.
  await db.deaInventoryItem.deleteMany();
  await db.deaInventory.deleteMany();
  await db.deaOrderRecord.deleteMany();
  await db.deaDisposalRecord.deleteMany();
  await db.deaTheftLossReport.deleteMany();
```

Place these BEFORE the existing `await db.practiceUser.deleteMany();` line.

- [ ] **Step A4.2: Commit**

```bash
git add tests/setup.ts && git commit -m "test(setup): add DEA model cleanup to afterEach"
```

---

### Task A5: Run framework seed against dev

The seed script already exists at `scripts/seed-dea.ts`. Run it.

- [ ] **Step A5.1: Run the seed**

```bash
cd D:/GuardWell/guardwell-v2 && npx tsx scripts/seed-dea.ts 2>&1 | tail -10
```

Expected output: framework upsert OK + 8 requirements upsert OK + N practices activated. The script is idempotent — safe to run repeatedly.

- [ ] **Step A5.2: Verify the framework + requirements landed**

```bash
cd D:/GuardWell/guardwell-v2 && npx prisma db execute --stdin <<'SQL'
SELECT code, name FROM "RegulatoryFramework" WHERE code = 'DEA';
SELECT code, severity FROM "RegulatoryRequirement" WHERE "frameworkId" = (SELECT id FROM "RegulatoryFramework" WHERE code = 'DEA') ORDER BY "sortOrder";
SQL
```

Expected: 1 framework row + 8 requirement rows.

- [ ] **Step A5.3: No commit needed** — the seed script writes data, not code. The seed script itself is unchanged.

---

### Task A6: Projection tests

**File:** `tests/integration/dea-projection.test.ts` (NEW)

Four tests, one per projection. Pattern: seed practice + user, call `appendEventAndApply` directly with a payload, verify the row(s) appear in the DB.

- [ ] **Step A6.1: Create the test file**

```ts
// tests/integration/dea-projection.test.ts
//
// Projection tests for the 4 DEA event types — verify the create-side
// of the schema lands correct rows.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectDeaInventoryRecorded,
  projectDeaOrderReceived,
  projectDeaDisposalCompleted,
  projectDeaTheftLossReported,
} from "@/lib/events/projections/dea";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: { name: "DEA Projection Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("DEA projections", () => {
  it("DEA_INVENTORY_RECORDED creates parent inventory + items", async () => {
    const { user, practice } = await seed();
    const inventoryId = randomUUID();
    const payload = {
      inventoryId,
      asOfDate: new Date("2026-04-15T10:00:00Z").toISOString(),
      conductedByUserId: user.id,
      witnessUserId: null,
      notes: "Q2 biennial inventory",
      items: [
        {
          drugName: "Hydrocodone/APAP",
          ndc: "0093-3358-01",
          schedule: "CII" as const,
          strength: "5mg/325mg",
          quantity: 100,
          unit: "tablets",
        },
        {
          drugName: "Lorazepam",
          ndc: null,
          schedule: "CIV" as const,
          strength: "1mg",
          quantity: 30,
          unit: "tablets",
        },
      ],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_INVENTORY_RECORDED",
        payload,
      },
      async (tx) =>
        projectDeaInventoryRecorded(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const inv = await db.deaInventory.findUnique({
      where: { id: inventoryId },
      include: { items: true },
    });
    expect(inv).not.toBeNull();
    expect(inv?.items).toHaveLength(2);
    expect(inv?.items.map((i) => i.drugName).sort()).toEqual([
      "Hydrocodone/APAP",
      "Lorazepam",
    ]);
  });

  it("DEA_ORDER_RECEIVED creates an order record", async () => {
    const { user, practice } = await seed();
    const orderRecordId = randomUUID();
    const payload = {
      orderRecordId,
      orderedByUserId: user.id,
      supplierName: "Cardinal Health",
      supplierDeaNumber: "PC1234567",
      orderedAt: new Date("2026-04-10T09:00:00Z").toISOString(),
      receivedAt: new Date("2026-04-12T14:00:00Z").toISOString(),
      form222Number: "0012345-A",
      drugName: "Oxycodone",
      ndc: "0228-2879-50",
      schedule: "CII" as const,
      strength: "5mg",
      quantity: 50,
      unit: "tablets",
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_ORDER_RECEIVED",
        payload,
      },
      async (tx) =>
        projectDeaOrderReceived(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const ord = await db.deaOrderRecord.findUnique({
      where: { id: orderRecordId },
    });
    expect(ord?.supplierName).toBe("Cardinal Health");
    expect(ord?.form222Number).toBe("0012345-A");
    expect(ord?.schedule).toBe("CII");
  });

  it("DEA_DISPOSAL_COMPLETED creates a disposal record", async () => {
    const { user, practice } = await seed();
    const disposalRecordId = randomUUID();
    const payload = {
      disposalRecordId,
      disposedByUserId: user.id,
      witnessUserId: null,
      reverseDistributorName: "Stericycle",
      reverseDistributorDeaNumber: "RC7654321",
      disposalDate: new Date("2026-04-20T15:00:00Z").toISOString(),
      disposalMethod: "REVERSE_DISTRIBUTOR" as const,
      drugName: "Expired Hydrocodone",
      ndc: "0093-3358-01",
      schedule: "CII" as const,
      strength: "5mg/325mg",
      quantity: 12,
      unit: "tablets",
      form41Filed: true,
      notes: "Expired stock from Q1",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_DISPOSAL_COMPLETED",
        payload,
      },
      async (tx) =>
        projectDeaDisposalCompleted(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const disp = await db.deaDisposalRecord.findUnique({
      where: { id: disposalRecordId },
    });
    expect(disp?.reverseDistributorName).toBe("Stericycle");
    expect(disp?.form41Filed).toBe(true);
    expect(disp?.disposalMethod).toBe("REVERSE_DISTRIBUTOR");
  });

  it("DEA_THEFT_LOSS_REPORTED creates a theft/loss report", async () => {
    const { user, practice } = await seed();
    const reportId = randomUUID();
    const payload = {
      reportId,
      incidentId: null,
      reportedByUserId: user.id,
      discoveredAt: new Date("2026-04-18T08:00:00Z").toISOString(),
      lossType: "THEFT" as const,
      drugName: "Oxycodone",
      ndc: "0228-2879-50",
      schedule: "CII" as const,
      strength: "5mg",
      quantityLost: 60,
      unit: "tablets",
      methodOfDiscovery: "Daily count discrepancy",
      lawEnforcementNotified: true,
      lawEnforcementAgency: "Phoenix PD",
      lawEnforcementCaseNumber: "2026-04-18-447",
      deaNotifiedAt: new Date("2026-04-18T11:00:00Z").toISOString(),
      form106SubmittedAt: new Date("2026-04-18T16:00:00Z").toISOString(),
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_THEFT_LOSS_REPORTED",
        payload,
      },
      async (tx) =>
        projectDeaTheftLossReported(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const rpt = await db.deaTheftLossReport.findUnique({
      where: { id: reportId },
    });
    expect(rpt?.lossType).toBe("THEFT");
    expect(rpt?.quantityLost).toBe(60);
    expect(rpt?.lawEnforcementAgency).toBe("Phoenix PD");
    expect(rpt?.form106SubmittedAt).not.toBeNull();
  });
});
```

- [ ] **Step A6.2: Run + commit**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/dea-projection.test.ts 2>&1 | tail -10
```

Expected: 4 passing.

```bash
git add tests/integration/dea-projection.test.ts && git commit -m "test(dea): projection tests for inventory/order/disposal/theft-loss"
```

- [ ] **Step A6.3: Run full suite to confirm no regressions**

```bash
cd D:/GuardWell/guardwell-v2 && npx vitest run 2>&1 | tail -5
```

Expected: 465 passing (was 461 + 4 new). 0 failing.

---

### Task A7: Verification + push + prod migration + PR + merge

Same flow as chunks 2 + 3. Use the validated end-to-end pattern from `launch-readiness-2026-04-27.md`.

- [ ] **Step A7.1: tsc + lint clean**
- [ ] **Step A7.2: Push branch `feat/launch-4a-dea-foundation`**
- [ ] **Step A7.3: Migrate prod schema** (5 new tables — purely additive, no risk to existing data)
- [ ] **Step A7.4: Run seed-dea.ts against prod (after schema is migrated)**
- [ ] **Step A7.5: Open PR + spec review + code review + must-fix application + merge**
- [ ] **Step A7.6: Update memory** — Phase A done; Phase B queued.

---

## Phase B (next session) — Inventory tab + Inventory PDF

High-level outline (full plan written next session):
- Create `/programs/dea/page.tsx` shell (RSC, framework gate, tab nav)
- Create `DeaDashboard.tsx` client component with 4 tabs (3 stubbed, 1 active)
- Build `InventoryTab.tsx` — table of `DeaInventory[]` + drill-in to items + "New inventory" form
- Server action: `recordInventoryAction` → emits `DEA_INVENTORY_RECORDED`
- Inventory PDF: `src/lib/audit/dea-inventory-pdf.tsx` + `src/app/api/audit/dea-inventory/route.tsx?asOfDate=YYYY-MM-DD`
- Add to `/audit/reports` REPORTS array
- Tests: 1 happy-path PDF integration test
- Audit-trail event: `INCIDENT_OSHA_LOG_GENERATED`-style for DEA inventory PDF? **Defer to Phase D polish — discuss the convention.**

## Phase C (next session) — Orders + Disposals + Form 41

- `OrdersTab.tsx` + `recordOrderAction` server action
- `DisposalsTab.tsx` + `recordDisposalAction` server action
- Form 41 PDF: `src/lib/audit/dea-form-41-pdf.tsx` + `src/app/api/audit/dea-form-41/[id]/route.tsx`
- Tests: 2-3 integration tests

## Phase D (next session) — Theft & Loss + Form 106 + polish + sidebar

- `TheftLossTab.tsx` + `recordTheftLossAction` server action + optional link from Incident detail page
- Form 106 PDF: `src/lib/audit/dea-form-106-pdf.tsx` + route
- Add DEA entry to sidebar `PROGRAMS` array (conditional on framework enablement)
- Audit-trail events for all DEA PDFs (matching chunks 2 + 3 convention)
- Final tests + spec review + code review + merge

---

## Self-Review (Phase A)

- ✅ Spec coverage: 5 models + 4 events + 4 projections + framework activation + cleanup + tests all addressed
- ✅ No placeholders — every task has complete code
- ✅ Type consistency: schedule enum spelling (CI/CII/...) matches across schema, registry, projection, tests
- ⚠️ Phase A is BACKEND-ONLY. No `/programs/dea` page yet. The framework will activate on `/modules/dea` (which uses the dynamic `/modules/[code]` page) and show 8 requirements all in GAP state until Phases B-D ship the data-entry UI.
- ⚠️ The seed-dea.ts run is technically a "data write" not captured by git; document in the PR description that the seed must be run on every environment.

## Execution Handoff

Subagent-driven execution per project standard. Tasks A1-A4 + A6 dispatch as one or two implementer subagents. Tasks A5 + A7 are operator/orchestrator actions.
