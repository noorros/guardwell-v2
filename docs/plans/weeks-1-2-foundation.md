# V2 Weeks 1–2 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the event-sourcing foundation, multi-tenant scaffolding, provisioned Cloud SQL, Firebase Auth wiring, and one end-to-end flow (sign-in → create practice → emit `PRACTICE_CREATED` event → render practice on a stub dashboard) — plus the CI/CD pipeline that auto-deploys it to `v2.app.gwcomp.com`.

**Architecture:** Event-sourced compliance state ([ADR-0001](../adr/0001-event-sourcing.md)) on Postgres/Cloud SQL with multi-tenant `practiceId` row scoping. Firebase Auth for identity. Next.js 16 App Router + Server Actions. The `appendEventAndApply()` helper is the only path for projection mutations; an ESLint rule enforces this.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma 5.22, PostgreSQL on Cloud SQL, Firebase Auth, Zod validation, Vitest for tests, Cloud Build → Cloud Run for deploy.

**Working directory throughout:** `D:/GuardWell/guardwell-v2`. Always `cd` explicitly per `memory/bash-gotchas.md`.

**Done state at end of week 2:**
- `npm install`, `npm run dev`, `npm run build`, `npm test` all clean.
- Cloud SQL `guardwell-v2-db` instance running with the foundational schema.
- Pushing to `main` deploys to `v2.app.gwcomp.com`.
- A signed-in user can create a practice and see its name on `/dashboard`.
- The `EventLog` table contains the corresponding `PRACTICE_CREATED` event.
- 100% of projection mutations go through `appendEventAndApply()` (lint-enforced).

---

## File Structure (locked at start of plan)

```
guardwell-v2/
├── .env                                      # CREATE locally, never commit
├── cloudbuild.yaml                           # CREATE  (Task F2)
├── Dockerfile                                # CREATE  (Task F2)
├── prisma/
│   └── schema.prisma                         # EXISTS — small additions in Task C2
├── src/
│   ├── app/
│   │   ├── layout.tsx                        # EXISTS
│   │   ├── page.tsx                          # MODIFY (Task E4 — link to /dashboard)
│   │   ├── globals.css                       # EXISTS
│   │   ├── (auth)/
│   │   │   └── sign-in/
│   │   │       └── page.tsx                  # CREATE (Task E1)
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                    # CREATE (Task E4)
│   │   │   └── dashboard/
│   │   │       └── page.tsx                  # CREATE (Task E4)
│   │   ├── onboarding/
│   │   │   └── create-practice/
│   │   │       ├── page.tsx                  # CREATE (Task E3)
│   │   │       └── actions.ts                # CREATE (Task E3)
│   │   └── api/
│   │       └── auth/
│   │           └── sync/
│   │               └── route.ts              # CREATE (Task E2)
│   ├── proxy.ts                              # CREATE (Task D5 — Next.js 16 middleware)
│   ├── lib/
│   │   ├── db.ts                             # EXISTS
│   │   ├── utils.ts                          # EXISTS
│   │   ├── auth.ts                           # CREATE (Task D3)
│   │   ├── rbac.ts                           # CREATE (Task D4)
│   │   ├── firebase-admin.ts                 # CREATE (Task D1)
│   │   ├── firebase.ts                       # CREATE (Task D2)
│   │   └── events/
│   │       ├── append.ts                     # EXISTS — REWRITE in Task C3
│   │       ├── registry.ts                   # CREATE (Task C2)
│   │       ├── replay.ts                     # CREATE (Task C4)
│   │       └── index.ts                      # CREATE (Task C2 — barrel export)
│   ├── components/
│   │   └── (left empty in weeks 1-2; design-system sprint is weeks 3-4)
│   └── providers/
│       └── firebase-provider.tsx             # CREATE (Task D2)
├── eslint-rules/
│   └── no-direct-projection-mutation.js      # CREATE (Task F1)
├── tests/
│   ├── setup.ts                              # CREATE (Task C1)
│   └── integration/
│       └── events.test.ts                    # CREATE (Task C5)
└── vitest.config.ts                          # CREATE (Task C1)
```

---

## Chunk A — Local environment + repo init (Day 1, ~2 hours)

### Task A1: `npm install`

**Files:** none modified. Side effect: creates `node_modules/`, updates `package-lock.json`.

- [ ] **Step 1: Install dependencies**

```bash
cd "D:/GuardWell/guardwell-v2" && npm install
```

Expected: completes without errors. `package-lock.json` is created. `node_modules/` populates.

- [ ] **Step 2: Sanity check Prisma is installed**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma --version
```

Expected: `prisma : 5.22.x` or higher.

### Task A2: Prisma generate (without DB connection yet)

**Files:** generates `node_modules/.prisma/client/`.

- [ ] **Step 1: Generate Prisma client from schema**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma generate
```

Expected: `✔ Generated Prisma Client (vX.X.X)`. The schema parses cleanly even though no DB exists yet.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. The Prisma client types are now available so `src/lib/db.ts` and `src/lib/events/append.ts` resolve.

### Task A3: Git init + initial commit + GitHub remote

**Files:** creates `.git/`. No source files change.

- [ ] **Step 1: Initialize repo + add all scaffolding**

```bash
cd "D:/GuardWell/guardwell-v2" && git init && git branch -M main && git add -A
```

- [ ] **Step 2: First commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git commit -m "$(cat <<'EOF'
chore: initial v2 scaffolding (foundation pre-event-sourcing)

Project layout, Next.js 16 + Prisma 5.22 + Tailwind 4 config, 5 ADRs
documenting the architectural commitments (event sourcing, regulations
x operations matrix, LLM ops, modules-as-data, design system),
foundational Prisma schema (User, Practice, EventLog,
RegulatoryFramework, RegulatoryRequirement, EvidenceType,
ComplianceItem, ComplianceScoreSnapshot, LlmCall, Waitlist), minimal
src/app skeleton, src/lib/{db,utils} + appendEventAndApply stub.

See README.md and docs/plans/weeks-1-2-foundation.md for what ships
next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Create GitHub repo (manual — `gh` CLI not installed locally per memory)**

Open https://github.com/new and create `noorros/guardwell-v2` (private). Do NOT add a README or `.gitignore` from the GitHub UI — they would conflict with the existing files.

- [ ] **Step 4: Add remote + push**

```bash
cd "D:/GuardWell/guardwell-v2" && git remote add origin https://github.com/noorros/guardwell-v2.git && git push -u origin main
```

Expected: branch `main` pushed.

---

## Chunk B — Cloud infrastructure (Day 1–2, ~3 hours)

### Task B1: Provision Cloud SQL `guardwell-v2-db` instance

**Files:** none. Creates GCP resources.

- [ ] **Step 1: Authenticate gcloud (if needed)**

```bash
gcloud auth login
gcloud config set project guardwell-prod
```

- [ ] **Step 2: Create the instance**

```bash
gcloud sql instances create guardwell-v2-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-1-3840 \
  --region=us-central1 \
  --storage-size=20GB \
  --storage-auto-increase \
  --backup-start-time=08:00 \
  --availability-type=zonal
```

Expected: `Created [https://sqladmin.googleapis.com/sql/v1beta4/projects/guardwell-prod/instances/guardwell-v2-db].`

This takes ~5 minutes. While it provisions, continue with the next step.

- [ ] **Step 3: Set the postgres root password**

```bash
gcloud sql users set-password postgres --instance=guardwell-v2-db --password="<generate-and-store-securely>"
```

Save the password to your password manager. It is also needed for `.env` later.

- [ ] **Step 4: Create the application database**

```bash
gcloud sql databases create guardwell_v2 --instance=guardwell-v2-db
```

- [ ] **Step 5: Create an application user (not postgres root)**

```bash
gcloud sql users create gwapp --instance=guardwell-v2-db --password="<generate-and-store-securely>"
```

Save this password too — it's what goes into `DATABASE_URL`.

- [ ] **Step 6: Verify**

```bash
gcloud sql instances list | grep guardwell-v2-db
```

Expected: shows the instance with status `RUNNABLE`.

### Task B2: Cloud SQL Proxy local setup

**Files:** none committed (proxy binary already exists at `D:/GuardWell/cloud-sql-proxy.exe` per audit).

- [ ] **Step 1: Get the connection name**

```bash
gcloud sql instances describe guardwell-v2-db --format="value(connectionName)"
```

Expected output (something like): `guardwell-prod:us-central1:guardwell-v2-db`

- [ ] **Step 2: Start the proxy in a separate terminal**

```bash
cd "D:/GuardWell" && ./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5433
```

Expected: `Listening on 127.0.0.1:5433 for guardwell-prod:us-central1:guardwell-v2-db`. Leave running for the rest of the session.

- [ ] **Step 3: Create local `.env`**

Copy `.env.example` → `.env` and fill in:

```
DATABASE_URL="postgresql://gwapp:<gwapp-password>@127.0.0.1:5433/guardwell_v2?schema=public"
```

(Other env vars stay empty for now — filled in as later tasks need them.)

- [ ] **Step 4: Verify connection**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma db execute --stdin <<< "SELECT 1;"
```

Expected: connects without error.

### Task B3: Push the foundational Prisma schema

**Files:** none modified — only Cloud SQL state changes.

- [ ] **Step 1: Push schema**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma db push
```

Expected: `🚀  Your database is now in sync with your Prisma schema.`

- [ ] **Step 2: Verify with Prisma Studio (optional but recommended)**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma studio
```

Open http://localhost:5555 and confirm all tables exist: User, LegalAcceptance, Practice, PracticeUser, EventLog, RegulatoryFramework, PracticeFramework, RegulatoryRequirement, EvidenceType, ComplianceItem, ComplianceScoreSnapshot, LlmCall, Waitlist.

- [ ] **Step 3: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git commit --allow-empty -m "infra: provisioned Cloud SQL guardwell-v2-db + initial schema push"
```

(Empty commit captures the milestone in history; no source change to commit.)

---

## Chunk C — Event sourcing core (Day 2–4, ~6 hours)

### Task C1: Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Modify: `package.json` (already has test scripts — verify they work)

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Create `tests/setup.ts`**

```ts
// Test setup. Loads .env and exposes a typed Prisma client wrapped in a
// transaction-rollback helper so integration tests don't pollute each other.
import { config } from "dotenv";
config({ path: ".env" });

import { afterEach, beforeAll } from "vitest";
import { db } from "@/lib/db";

beforeAll(async () => {
  // Single shared connection in tests
  await db.$connect();
});

afterEach(async () => {
  // Clean up between tests — delete in dependency order.
  await db.eventLog.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
});
```

- [ ] **Step 3: Add `dotenv` dependency**

```bash
cd "D:/GuardWell/guardwell-v2" && npm install --save-dev dotenv
```

- [ ] **Step 4: Sanity-check vitest runs**

Create temporary `tests/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";

describe("sanity", () => {
  it("connects to db", async () => {
    const result = await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(result[0]?.ok).toBe(1);
  });
});
```

Run:

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run tests/sanity.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Delete the sanity file + commit**

```bash
cd "D:/GuardWell/guardwell-v2" && rm tests/sanity.test.ts && git add -A && git commit -m "test: vitest configured with db cleanup between tests"
```

### Task C2: EventType registry with Zod schemas

**Files:**
- Create: `src/lib/events/registry.ts`
- Create: `src/lib/events/index.ts`

- [ ] **Step 1: Write the registry**

```ts
// src/lib/events/registry.ts
//
// THE SOURCE OF TRUTH for what events exist. Adding a new event type is a
// 3-step pattern:
//   1. Add the literal to `EventType` union below
//   2. Add the Zod schema to `EVENT_SCHEMAS` keyed by (type, version)
//   3. (Optional) Register a projection handler in src/lib/events/projections.ts

import { z } from "zod";

// --- Event types (TypeScript literal union, mirrored as strings in DB) -----

export const EVENT_TYPES = [
  "PRACTICE_CREATED",
  "USER_INVITED",
  // Future: POLICY_ACKNOWLEDGED, TRAINING_COMPLETED, INCIDENT_CREATED,
  // BREACH_DETERMINED, SRA_ANSWER_RECORDED, CREDENTIAL_RENEWED, ...
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// --- Per-event payload schemas (Zod), keyed by (type, schemaVersion) -------

export const EVENT_SCHEMAS = {
  PRACTICE_CREATED: {
    1: z.object({
      practiceName: z.string().min(1).max(200),
      primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
      ownerUserId: z.string().min(1),
    }),
  },
  USER_INVITED: {
    1: z.object({
      invitedEmail: z.string().email(),
      role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
    }),
  },
} as const;

// --- Type-level helper: payload type for a given event type + version ------

export type PayloadFor<
  T extends EventType,
  V extends keyof (typeof EVENT_SCHEMAS)[T] = 1,
> = z.infer<(typeof EVENT_SCHEMAS)[T][V]>;

export function getEventSchema<T extends EventType>(
  type: T,
  version: number = 1,
) {
  const schemas = EVENT_SCHEMAS[type] as Record<number, z.ZodTypeAny>;
  const schema = schemas[version];
  if (!schema) {
    throw new Error(
      `No schema registered for event type=${type} version=${version}`,
    );
  }
  return schema;
}
```

- [ ] **Step 2: Write the barrel export**

```ts
// src/lib/events/index.ts
export { appendEventAndApply } from "./append";
export type { EventInput, ProjectionFn } from "./append";
export {
  EVENT_TYPES,
  EVENT_SCHEMAS,
  getEventSchema,
  type EventType,
  type PayloadFor,
} from "./registry";
export { replayPracticeEvents } from "./replay";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. (`replay.ts` doesn't exist yet, so this will fail until Task C4 — temporarily comment out the `replayPracticeEvents` line in `index.ts`, OR proceed straight to Task C3 + C4 before re-running tsc.)

### Task C3: Complete `appendEventAndApply` with idempotency + Zod validation

**Files:**
- Rewrite: `src/lib/events/append.ts`

- [ ] **Step 1: Replace `append.ts` with the production version**

```ts
// src/lib/events/append.ts
//
// THE ONLY WAY projection tables get mutated (per ADR-0001). Server actions
// MUST go through this helper. The lint rule `no-direct-projection-mutation`
// (Task F1) blocks any other code path under src/app/(dashboard)/.

import { db } from "@/lib/db";
import { getEventSchema, type EventType, type PayloadFor } from "./registry";
import type { EventLog, Prisma } from "@prisma/client";

export type EventInput<T extends EventType, V extends number = 1> = {
  practiceId: string;
  actorUserId?: string | null;
  type: T;
  schemaVersion?: V;
  payload: PayloadFor<T, V & keyof (typeof import("./registry").EVENT_SCHEMAS)[T]>;
  /** Pass to dedupe retried writes — identical idempotencyKey returns the
   *  existing row instead of inserting a duplicate. */
  idempotencyKey?: string;
};

export type ProjectionFn = (
  tx: Prisma.TransactionClient,
  event: EventLog,
) => Promise<void>;

/** Append a typed event AND apply its projection inside one transaction.
 *  Validates payload via the registered Zod schema. */
export async function appendEventAndApply<T extends EventType>(
  input: EventInput<T>,
  projection: ProjectionFn,
): Promise<EventLog> {
  const version = input.schemaVersion ?? 1;
  const schema = getEventSchema(input.type, version);
  const validated = schema.parse(input.payload);

  // Idempotency short-circuit: if we already wrote this key, return the
  // existing row without re-running the projection.
  if (input.idempotencyKey) {
    const existing = await db.eventLog.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
  }

  return db.$transaction(async (tx) => {
    const event = await tx.eventLog.create({
      data: {
        practiceId: input.practiceId,
        actorUserId: input.actorUserId ?? null,
        type: input.type,
        schemaVersion: version,
        payload: validated as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await projection(tx, event);
    return event;
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task C4: Replay helper

**Files:**
- Create: `src/lib/events/replay.ts`

- [ ] **Step 1: Write the replay function**

```ts
// src/lib/events/replay.ts
//
// Replays events for a practice through pure reducer functions. Used to
// rebuild projections after a schema change, to recompute the compliance
// score, and to answer "show me everything that happened with X" queries.

import { db } from "@/lib/db";
import { getEventSchema, type EventType } from "./registry";
import type { EventLog } from "@prisma/client";

export type ReplayCallback = (event: EventLog, parsedPayload: unknown) => void | Promise<void>;

/** Stream all events for a practice in chronological order, validated and
 *  parsed. Caller supplies the reducer/handler. */
export async function replayPracticeEvents(
  practiceId: string,
  callback: ReplayCallback,
  options: { since?: Date; until?: Date; types?: EventType[] } = {},
): Promise<{ processed: number; lastEventAt: Date | null }> {
  const events = await db.eventLog.findMany({
    where: {
      practiceId,
      ...(options.since && { createdAt: { gte: options.since } }),
      ...(options.until && { createdAt: { lte: options.until } }),
      ...(options.types && { type: { in: options.types } }),
    },
    orderBy: { createdAt: "asc" },
  });

  let processed = 0;
  let lastEventAt: Date | null = null;

  for (const event of events) {
    const schema = getEventSchema(event.type as EventType, event.schemaVersion);
    const parsed = schema.parse(event.payload);
    await callback(event, parsed);
    processed += 1;
    lastEventAt = event.createdAt;
  }

  return { processed, lastEventAt };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task C5: Integration tests for events

**Files:**
- Create: `tests/integration/events.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/events.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply, replayPracticeEvents } from "@/lib/events";

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  return { user, practice };
}

describe("appendEventAndApply", () => {
  it("appends an event AND runs the projection in one transaction", async () => {
    const { user, practice } = await seedPractice();

    const event = await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
      },
      async (tx, evt) => {
        await tx.practiceUser.create({
          data: {
            userId: user.id,
            practiceId: practice.id,
            role: "OWNER",
            isPrivacyOfficer: true,
            isComplianceOfficer: true,
          },
        });
      },
    );

    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("PRACTICE_CREATED");

    const pus = await db.practiceUser.findMany({ where: { practiceId: practice.id } });
    expect(pus).toHaveLength(1);
    expect(pus[0]?.role).toBe("OWNER");
  });

  it("rejects payloads that fail Zod validation", async () => {
    const { user, practice } = await seedPractice();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "PRACTICE_CREATED",
          payload: {
            practiceName: "",         // fails .min(1)
            primaryState: "Arizona",  // fails .length(2)
            ownerUserId: user.id,
          } as never,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });

  it("respects idempotencyKey", async () => {
    const { user, practice } = await seedPractice();
    const key = `idem-${Math.random()}`;

    let projectionRuns = 0;
    const project = async () => {
      projectionRuns += 1;
    };

    const a = await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
        idempotencyKey: key,
      },
      project,
    );
    const b = await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
        idempotencyKey: key,
      },
      project,
    );

    expect(a.id).toBe(b.id);
    expect(projectionRuns).toBe(1); // projection runs ONLY on first call
    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(1);
  });

  it("rolls back the event when the projection throws", async () => {
    const { user, practice } = await seedPractice();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "PRACTICE_CREATED",
          payload: {
            practiceName: practice.name,
            primaryState: practice.primaryState,
            ownerUserId: user.id,
          },
        },
        async () => {
          throw new Error("simulated projection failure");
        },
      ),
    ).rejects.toThrow("simulated projection failure");

    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(0); // rolled back
  });
});

describe("replayPracticeEvents", () => {
  it("replays in chronological order with parsed payloads", async () => {
    const { user, practice } = await seedPractice();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
      },
      async () => {},
    );

    const seen: Array<{ type: string; payload: unknown }> = [];
    const result = await replayPracticeEvents(practice.id, (evt, payload) => {
      seen.push({ type: evt.type, payload });
    });

    expect(result.processed).toBe(1);
    expect(seen[0]?.type).toBe("PRACTICE_CREATED");
    expect((seen[0]?.payload as { practiceName: string }).practiceName).toBe(
      practice.name,
    );
  });
});
```

- [ ] **Step 2: Run tests — expect all to pass**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run tests/integration/events.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit chunk C**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(events): event-sourcing core (registry + append + replay) with idempotency + Zod validation + integration tests"
```

---

## Chunk D — Firebase Auth wiring (Day 4–6, ~5 hours)

### Task D1: Firebase Admin SDK init

**Files:**
- Create: `src/lib/firebase-admin.ts`

Prereq: get Firebase service account JSON from GCP console (Project Settings → Service accounts → Generate new private key). Store as `firebase-admin.json` LOCALLY ONLY. Add to `.env`:

```
FIREBASE_PROJECT_ID=guardwell-prod
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@guardwell-prod.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
```

(Note the `\n`s in `FIREBASE_PRIVATE_KEY` — Cloud Run env-var convention. The init code unescapes them.)

- [ ] **Step 1: Write firebase-admin.ts**

```ts
// src/lib/firebase-admin.ts
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let app: App;

if (getApps().length === 0) {
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
} else {
  app = getApps()[0]!;
}

export const adminAuth = getAuth(app);

/** Verify a Firebase ID token from a request. Throws if invalid. */
export async function verifyFirebaseToken(idToken: string) {
  return adminAuth.verifyIdToken(idToken);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task D2: Firebase client SDK init + provider

**Files:**
- Create: `src/lib/firebase.ts`
- Create: `src/providers/firebase-provider.tsx`

Add public env vars to `.env`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=guardwell-prod.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=guardwell-prod
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=guardwell-prod.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

- [ ] **Step 1: Write firebase.ts**

```ts
// src/lib/firebase.ts (client-side)
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0]!;
}

export const firebaseAuth: Auth = getAuth(app);
```

- [ ] **Step 2: Write firebase-provider.tsx**

```tsx
// src/providers/firebase-provider.tsx
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";

interface AuthCtx {
  user: User | null;
  loading: boolean;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function useFirebaseUser() {
  return useContext(Ctx);
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return <Ctx.Provider value={{ user, loading }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 3: Add `firebase` and re-verify**

`firebase` is already in package.json. Just confirm:

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task D3: Server-side `auth.ts`

**Files:**
- Create: `src/lib/auth.ts`

- [ ] **Step 1: Write auth.ts**

```ts
// src/lib/auth.ts
//
// Server-side auth helpers. Reads the Firebase ID-token cookie set by the
// /api/auth/sync route, verifies via Firebase Admin, and resolves to our
// User row.

import { cookies } from "next/headers";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import { db } from "@/lib/db";

const TOKEN_COOKIE = "fb-token";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) return null;

  let decoded;
  try {
    decoded = await verifyFirebaseToken(token);
  } catch {
    return null;
  }

  // Match by firebaseUid (primary) — email match is fallback only because
  // emails can change.
  return db.user.findUnique({ where: { firebaseUid: decoded.uid } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task D4: Multi-tenant `rbac.ts`

**Files:**
- Create: `src/lib/rbac.ts`

- [ ] **Step 1: Write rbac.ts**

```ts
// src/lib/rbac.ts
//
// Per-practice authorization. Pattern ported from v1: every dashboard
// page/action that touches a practice's data MUST resolve a PracticeUser
// before doing anything, then assert role >= minimum.
//
// Multi-tenant rule: every Prisma query MUST scope by practiceId. The
// helpers below are NOT a substitute for that — they assert the user
// CAN act within a practice; query-level scoping still required.

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PracticeRole } from "@prisma/client";

const ROLE_HIERARCHY: Record<PracticeRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  STAFF: 2,
  VIEWER: 1,
};

export async function getPracticeUser(practiceId?: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  const where = practiceId
    ? { userId: user.id, practiceId, removedAt: null }
    : { userId: user.id, removedAt: null };

  const pu = await db.practiceUser.findFirst({
    where,
    include: { practice: true },
    orderBy: { joinedAt: "asc" },
  });

  return pu ? { ...pu, dbUser: user } : null;
}

export async function requireRole(minRole: PracticeRole, practiceId?: string) {
  const pu = await getPracticeUser(practiceId);
  if (!pu) throw new Error("Unauthorized");
  if (ROLE_HIERARCHY[pu.role] < ROLE_HIERARCHY[minRole]) {
    throw new Error(`Requires ${minRole} role or higher`);
  }
  return pu;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task D5: Next.js 16 middleware (`src/proxy.ts`)

**Files:**
- Create: `src/proxy.ts`

Note: Next.js 16 renamed `middleware.ts` → `proxy.ts` per project memory.

- [ ] **Step 1: Write proxy.ts**

```ts
// src/proxy.ts (Next.js 16 middleware)
//
// Lightweight cookie check ONLY. Full token verification happens in route
// handlers via verifyFirebaseToken(). This middleware just gates which
// routes require a session cookie at all.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/",
  "/sign-in",
  "/api/auth/sync",
  "/api/health",
];

const TOKEN_COOKIE = "fb-token";

function isValidRedirect(url: string): boolean {
  // Open-redirect guard: only allow same-origin paths.
  return url.startsWith("/") && !url.startsWith("//");
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip Next.js internals and static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (token) return NextResponse.next();

  // Not authenticated — bounce to /sign-in with redirect param
  const redirectTo = isValidRedirect(`${pathname}${search}`) ? `${pathname}${search}` : "/";
  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set("redirect", redirectTo);

  // API routes get 401 instead of redirect
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit chunk D**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(auth): Firebase Admin + client init, multi-tenant rbac, Next.js 16 proxy.ts middleware"
```

---

## Chunk E — First end-to-end flow (Day 6–8, ~6 hours)

### Task E1: `/sign-in` page

**Files:**
- Create: `src/app/(auth)/sign-in/page.tsx`

- [ ] **Step 1: Write the sign-in page**

```tsx
// src/app/(auth)/sign-in/page.tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";

export default function SignInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const token = await cred.user.getIdToken();
      const res = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Sign-in sync failed");
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        {error && (
          <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
```

### Task E2: `/api/auth/sync` route

**Files:**
- Create: `src/app/api/auth/sync/route.ts`

- [ ] **Step 1: Write the sync route**

```ts
// src/app/api/auth/sync/route.ts
//
// Called immediately after sign-in. Verifies the Firebase ID token, upserts
// the local User row keyed by firebaseUid, and sets the fb-token cookie.

import { NextResponse, type NextRequest } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = auth.slice("Bearer ".length);

  let decoded;
  try {
    decoded = await verifyFirebaseToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const user = await db.user.upsert({
    where: { firebaseUid: decoded.uid },
    update: { emailVerified: !!decoded.email_verified },
    create: {
      firebaseUid: decoded.uid,
      email: decoded.email ?? "",
      emailVerified: !!decoded.email_verified,
    },
  });

  // Find any practice the user belongs to (used to skip onboarding)
  const pu = await db.practiceUser.findFirst({
    where: { userId: user.id, removedAt: null },
  });

  const res = NextResponse.json({ userId: user.id, hasPractice: !!pu });
  res.cookies.set("fb-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60, // Firebase tokens are 1h; client refreshes via the SDK
  });
  return res;
}
```

### Task E3: `/onboarding/create-practice` page + action

**Files:**
- Create: `src/app/onboarding/create-practice/page.tsx`
- Create: `src/app/onboarding/create-practice/actions.ts`

- [ ] **Step 1: Write the server action**

```ts
// src/app/onboarding/create-practice/actions.ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";

const Schema = z.object({
  name: z.string().min(1).max(200),
  primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
});

export async function createPracticeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = Schema.parse({
    name: String(formData.get("name") ?? ""),
    primaryState: String(formData.get("primaryState") ?? "").toUpperCase(),
  });

  // Pre-create the Practice row (it needs an id for the EventLog FK).
  const practice = await db.practice.create({
    data: { name: parsed.name, primaryState: parsed.primaryState },
  });

  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "PRACTICE_CREATED",
      payload: {
        practiceName: parsed.name,
        primaryState: parsed.primaryState,
        ownerUserId: user.id,
      },
    },
    async (tx) => {
      await tx.practiceUser.create({
        data: {
          userId: user.id,
          practiceId: practice.id,
          role: "OWNER",
          isPrivacyOfficer: true,
          isComplianceOfficer: true,
        },
      });
    },
  );

  redirect("/dashboard");
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/onboarding/create-practice/page.tsx
import { createPracticeAction } from "./actions";

export default function CreatePracticePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        action={createPracticeAction}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold text-slate-900">Create your practice</h1>
        <p className="text-sm text-slate-500">
          Tell us the basics. You can refine details later.
        </p>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Practice name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="primaryState" className="block text-sm font-medium text-slate-700">
            Primary state
          </label>
          <input
            id="primaryState"
            name="primaryState"
            required
            maxLength={2}
            placeholder="AZ"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Create practice
        </button>
      </form>
    </div>
  );
}
```

### Task E4: Stub `/dashboard`

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/dashboard/page.tsx`
- Modify: `src/app/page.tsx` (add a link to /sign-in)

- [ ] **Step 1: Write the dashboard layout**

```tsx
// src/app/(dashboard)/layout.tsx
import { redirect } from "next/navigation";
import { getPracticeUser } from "@/lib/rbac";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900">{pu.practice.name}</span>
          <span className="text-sm text-slate-500">{pu.dbUser.email}</span>
        </div>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write the dashboard page**

```tsx
// src/app/(dashboard)/dashboard/page.tsx
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function DashboardPage() {
  const pu = await getPracticeUser();
  if (!pu) return null; // layout already redirected

  const eventCount = await db.eventLog.count({
    where: { practiceId: pu.practiceId },
  });

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">
        Welcome to {pu.practice.name}
      </h1>
      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-slate-600">Practice ID: {pu.practiceId}</p>
        <p className="text-sm text-slate-600">Primary state: {pu.practice.primaryState}</p>
        <p className="text-sm text-slate-600">Your role: {pu.role}</p>
        <p className="mt-4 text-xs text-slate-400">
          Events recorded for this practice: {eventCount}
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Update `src/app/page.tsx` to link to /sign-in**

Replace the body's primary CTA with:

```tsx
<a href="/sign-in" className="text-primary underline underline-offset-4">
  Sign in
</a>
```

(Inserted before or in place of the gwcomp.com link, depending on layout taste.)

- [ ] **Step 4: End-to-end smoke test (manual)**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run dev
```

In a browser:
1. Visit http://localhost:3000 → see landing page
2. Visit http://localhost:3000/dashboard → middleware bounces to /sign-in
3. Sign in with a test Firebase Auth user (create one in Firebase console)
4. Get redirected to /onboarding/create-practice
5. Submit name + state
6. Land on /dashboard showing the practice name + event count = 1

- [ ] **Step 5: Verify the event was written**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma studio
```

Open `EventLog` table — confirm 1 row with `type=PRACTICE_CREATED`, payload matches.

- [ ] **Step 6: Commit chunk E**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(e2e): sign-in -> create-practice -> dashboard, with PRACTICE_CREATED event"
```

---

## Chunk F — Lint rule + CI/CD (Day 8–10, ~5 hours)

### Task F1: ESLint rule `no-direct-projection-mutation`

**Files:**
- Create: `eslint-rules/no-direct-projection-mutation.js`
- Modify: `eslint.config.mjs`

This rule blocks `db.<projectionTable>.create/update/upsert/delete` calls outside `src/lib/events/`. It's the lint-side enforcement of [ADR-0001](../adr/0001-event-sourcing.md).

- [ ] **Step 1: Write the rule**

```js
// eslint-rules/no-direct-projection-mutation.js
//
// Blocks db.<projectionTable>.create/update/upsert/delete outside the
// events module. Per ADR-0001, all projection mutations must go through
// appendEventAndApply().

const PROJECTION_TABLES = new Set([
  "complianceItem",
  "practiceFramework",
  "complianceScoreSnapshot",
  // Add more here as new projection tables get created.
]);

const MUTATING_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

const ALLOWED_PATHS = [
  "src/lib/events/",
  "tests/", // tests bypass for setup/teardown
];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct Prisma mutations of projection tables. Use appendEventAndApply() instead (ADR-0001).",
    },
    schema: [],
    messages: {
      direct:
        "Projection table '{{table}}' must only be mutated via appendEventAndApply() per ADR-0001. Move this into a projection callback in src/lib/events/, or add a new event type if appropriate.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    if (ALLOWED_PATHS.some((p) => filename.replace(/\\/g, "/").includes(p))) {
      return {};
    }
    return {
      CallExpression(node) {
        // Match: <something>.<table>.<method>(...)
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        const method = callee.property?.name;
        if (!MUTATING_METHODS.has(method)) return;

        const tableExpr = callee.object;
        if (tableExpr.type !== "MemberExpression") return;
        const tableName = tableExpr.property?.name;
        if (!PROJECTION_TABLES.has(tableName)) return;

        context.report({
          node,
          messageId: "direct",
          data: { table: tableName },
        });
      },
    };
  },
};
```

- [ ] **Step 2: Wire into eslint.config.mjs**

```mjs
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noDirectProjectionMutation from "./eslint-rules/no-direct-projection-mutation.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { gw: { rules: { "no-direct-projection-mutation": noDirectProjectionMutation } } },
    rules: { "gw/no-direct-projection-mutation": "error" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
```

- [ ] **Step 3: Test the rule fires**

Temporarily add to a non-events file (e.g., bottom of `src/app/page.tsx`):

```ts
// @ts-expect-error testing lint rule
import { db } from "@/lib/db";
db.complianceItem.create({ data: {} as any });
```

Run:

```bash
cd "D:/GuardWell/guardwell-v2" && npm run lint
```

Expected: lint error referring to "Projection table 'complianceItem' must only be mutated…"

- [ ] **Step 4: Remove the test code, commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git checkout -- src/app/page.tsx && git add -A && git commit -m "lint: enforce no-direct-projection-mutation rule (ADR-0001)"
```

### Task F2: Dockerfile + cloudbuild.yaml

**Files:**
- Create: `Dockerfile`
- Create: `cloudbuild.yaml`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# Multi-stage build for Next.js standalone output
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Write cloudbuild.yaml**

```yaml
# cloudbuild.yaml — Cloud Build pipeline for v2.app.gwcomp.com
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/guardwell/guardwell-v2:$COMMIT_SHA
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/guardwell/guardwell-v2:latest
      - .
  - name: gcr.io/cloud-builders/docker
    args:
      - push
      - --all-tags
      - us-central1-docker.pkg.dev/$PROJECT_ID/guardwell/guardwell-v2
  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args:
      - run
      - deploy
      - guardwell-v2
      - --image=us-central1-docker.pkg.dev/$PROJECT_ID/guardwell/guardwell-v2:$COMMIT_SHA
      - --region=us-central1
      - --platform=managed
      - --allow-unauthenticated
      - --add-cloudsql-instances=$PROJECT_ID:us-central1:guardwell-v2-db
      - --service-account=guardwell-v2-runtime@$PROJECT_ID.iam.gserviceaccount.com
options:
  machineType: E2_HIGHCPU_8
  logging: CLOUD_LOGGING_ONLY
timeout: 1200s
```

- [ ] **Step 3: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add Dockerfile cloudbuild.yaml && git commit -m "infra: Dockerfile + cloudbuild.yaml for v2.app.gwcomp.com deploy"
```

### Task F3: Cloud Build trigger setup

**Files:** none. Creates GCP resources.

- [ ] **Step 1: Create the runtime service account**

```bash
gcloud iam service-accounts create guardwell-v2-runtime \
  --display-name="GuardWell v2 Cloud Run runtime"

# Grant Cloud SQL access
gcloud projects add-iam-policy-binding guardwell-prod \
  --member="serviceAccount:guardwell-v2-runtime@guardwell-prod.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

- [ ] **Step 2: Create the Artifact Registry repo (if not exists)**

```bash
gcloud artifacts repositories create guardwell \
  --repository-format=docker \
  --location=us-central1 \
  --description="GuardWell container images" || echo "Already exists"
```

- [ ] **Step 3: Connect GitHub repo to Cloud Build (UI step)**

Open https://console.cloud.google.com/cloud-build/triggers and:
1. Connect repository → GitHub → `noorros/guardwell-v2`
2. Create trigger:
   - Name: `guardwell-v2-main`
   - Event: Push to branch
   - Branch: `^main$`
   - Configuration: Cloud Build configuration file (`cloudbuild.yaml`)
   - Service account: `guardwell-v2-runtime@guardwell-prod.iam.gserviceaccount.com` (or default Cloud Build SA with `roles/run.admin` + `roles/iam.serviceAccountUser`)
3. Save.

- [ ] **Step 4: Set Cloud Run env vars (one-time)**

```bash
gcloud run services update guardwell-v2 \
  --region=us-central1 \
  --set-env-vars="DATABASE_URL=postgresql://gwapp:<password>@//cloudsql/guardwell-prod:us-central1:guardwell-v2-db/guardwell_v2?schema=public" \
  --set-env-vars="FIREBASE_PROJECT_ID=guardwell-prod" \
  --set-env-vars="FIREBASE_CLIENT_EMAIL=..." \
  --set-secrets="FIREBASE_PRIVATE_KEY=firebase-private-key:latest" \
  --set-env-vars="NEXT_PUBLIC_APP_URL=https://v2.app.gwcomp.com"
  # ...add the rest of .env.example, using --set-secrets for sensitive ones
```

(Initial service won't exist until the first build deploys. After the first build runs, this command updates env vars on the now-existing service.)

### Task F4: First deploy + DNS

- [ ] **Step 1: Push to main to trigger build**

```bash
cd "D:/GuardWell/guardwell-v2" && git push origin main
```

Expected: Cloud Build trigger fires. Watch in console: https://console.cloud.google.com/cloud-build/builds

- [ ] **Step 2: Wait for build completion**

```bash
gcloud builds list --limit=5
gcloud builds log <BUILD_ID> | tail -30
```

Expected: STATUS=SUCCESS in ~5–8 minutes.

- [ ] **Step 3: Set env vars (after the service exists)**

Run the `gcloud run services update` from Task F3 Step 4.

- [ ] **Step 4: Map custom domain**

```bash
gcloud beta run domain-mappings create \
  --service=guardwell-v2 \
  --domain=v2.app.gwcomp.com \
  --region=us-central1
```

Add the returned DNS records to your Squarespace/Cloudflare DNS for `gwcomp.com`. Wait for SSL provisioning (~15 min).

- [ ] **Step 5: Smoke test**

Visit https://v2.app.gwcomp.com — should show the landing page. Visit /sign-in — sign in form renders.

- [ ] **Step 6: Final commit (CI/CD documentation)**

```bash
cd "D:/GuardWell/guardwell-v2" && git commit --allow-empty -m "infra: v2.app.gwcomp.com live, auto-deploy from main"
```

---

## Self-review checklist

- [ ] All 6 chunks have committed checkpoints — yes
- [ ] Every task that creates code shows the actual code — yes
- [ ] Tests for the foundational helper (`appendEventAndApply` + replay) exist before they're depended on — yes (Task C5 before Chunks D/E use them)
- [ ] Idempotency, transaction rollback, and validation are tested — yes (Task C5)
- [ ] No `db.<projection>.create/update` outside `src/lib/events/` — enforced by Task F1
- [ ] Multi-tenant `practiceId` scoping is established by Task D4 and exercised by Task E4
- [ ] Cloud SQL provisioning happens before any DB-dependent code is run — yes (Chunk B before Chunk C)
- [ ] Firebase service-account JSON handling: stored locally, secret-managed in prod — covered in Task D1 prereq + Task F3 Step 4

## What's intentionally NOT in weeks 1–2

- Design system primitives (`<ComplianceCard>`, `<ScoreRing>`, etc.) — weeks 3–4 sprint per [ADR-0005](../adr/0005-design-system.md)
- LLM ops layer (`src/lib/ai/`) — weeks 5–6 per [ADR-0003](../adr/0003-llm-ops.md)
- Regulation seed data + module pages — weeks 5–6 onward per [ADR-0004](../adr/0004-modules-as-data.md)
- Notifications, audit prep, reports — weeks 12–14
- Cron jobs (no daily reminders yet — they'll be event-subscribers, see [ADR-0001](../adr/0001-event-sourcing.md))

## Execution handoff

Plan complete and saved to `docs/plans/weeks-1-2-foundation.md`. Two execution options:

**1. Subagent-driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because chunks B (Cloud SQL) and F (Cloud Build) involve out-of-band UI clicks the subagent can pause for.

**2. Inline execution** — execute tasks in this session using `superpowers:executing-plans`, with checkpoints for review. Faster for the pure-code chunks (A, C, D, E).

Recommendation: **Hybrid** — execute Chunks A + C + D + E inline (they're pure code), pause and dispatch Chunks B + F as separate subagent runs (they involve gcloud + console clicks that benefit from a focused agent).
