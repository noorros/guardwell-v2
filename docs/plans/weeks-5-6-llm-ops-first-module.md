# Weeks 5-6 — LLM Ops Layer + First Module (HIPAA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the LLM ops wrapper per ADR-0003, seed the HIPAA regulatory framework as the first module per ADR-0004, render a `/modules/hipaa` page that consumes the `gw/` design system and the event-sourced compliance state, and wire ONE AI-assisted flow end-to-end (an "assess my current HIPAA posture" prompt that writes back through appendEventAndApply).

**Architecture:** `src/lib/ai/` is the only path for calling Anthropic. Every call: (1) looks up a versioned prompt from a registry, (2) validates the LLM's structured JSON output against a Zod schema, (3) writes an LlmCall observability row, (4) if the LLM proposes compliance state changes, returns a list of events that the caller passes to appendEventAndApply — the AI never writes to projections directly. Modules-as-data: HIPAA is seeded as RegulatoryFramework + RegulatoryRequirement rows via a scripts/seed-hipaa.ts task; adding OSHA later is an identical INSERT. The `/modules/[code]` dynamic route reads framework + requirements + compliance items for the practice, composes them with ComplianceCard + ChecklistItem + ScoreRing from the gw/ design system.

**Tech Stack:** Next.js 16, Prisma 5.22, @anthropic-ai/sdk ^0.78 (Claude), Zod for structured outputs, vitest for unit + integration tests, gw/ design system, existing Cloud SQL.

**Working directory throughout:** `D:/GuardWell/guardwell-v2`. Always `cd` explicitly per `memory/bash-gotchas.md`.

**Done state at end of week 6:**
- `src/lib/ai/` shipped: client, registry, runLlm, with integration tests that mock the Anthropic client and assert the LlmCall row is written on both success and failure.
- `HIPAA` framework + ~10 requirements seeded via `npm run db:seed`; idempotent re-run produces zero new rows.
- `/modules/hipaa` renders `<ModuleHeader>` + one `<ChecklistItem>` per seeded requirement, backed by `ComplianceItem` rows projected from `REQUIREMENT_STATUS_UPDATED` events.
- Clicking a status button on a `ChecklistItem` dispatches a server action → emits `REQUIREMENT_STATUS_UPDATED` event → projects into `ComplianceItem` → re-renders.
- "Run AI assessment" button calls `runLlm("hipaa.assess.v1", ...)`, validates the structured output against a Zod schema, and emits one `REQUIREMENT_STATUS_UPDATED` event per returned suggestion through `appendEventAndApply`.
- `npm run eval:prompts` runs the eval harness against the frozen fixture(s) and passes.
- Rate limit (1 AI assessment / 24h / practice) + monthly cost guard enforced with tests for both.
- `<AiAssistDrawer>` footer is live: textarea + send button fire a server action calling `assistant.page-help.v1` and render the model's reply.
- Deployed to `v2.app.gwcomp.com` with `ANTHROPIC_API_KEY` + Upstash Redis URL in Cloud Run secrets.

---

## File Structure (locked at start of plan)

```
guardwell-v2/
├── package.json                                                   # MODIFY (Task A1, E2, F1 — scripts + deps)
├── prisma/
│   └── schema.prisma                                              # EXISTS — no changes in weeks 5-6
├── scripts/
│   ├── seed-hipaa.ts                                              # CREATE (Task B1)
│   └── eval-prompts.ts                                            # CREATE (Task E2)
├── src/
│   ├── app/
│   │   ├── page.tsx                                               # EXISTS
│   │   └── (dashboard)/
│   │       ├── layout.tsx                                         # EXISTS
│   │       ├── dashboard/page.tsx                                 # EXISTS
│   │       └── modules/
│   │           ├── page.tsx                                       # CREATE (Task C1 — framework index)
│   │           ├── [code]/
│   │           │   ├── page.tsx                                   # CREATE (Task C3)
│   │           │   └── actions.ts                                 # CREATE (Task C4)
│   │           └── hipaa/
│   │               └── assess/
│   │                   └── actions.ts                             # CREATE (Task D3)
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── client.ts                                          # CREATE (Task A2)
│   │   │   ├── registry.ts                                        # CREATE (Task A3)
│   │   │   ├── runLlm.ts                                          # CREATE (Task A4)
│   │   │   ├── rateLimit.ts                                       # CREATE (Task F1)
│   │   │   ├── costGuard.ts                                       # CREATE (Task F2)
│   │   │   ├── prompts/
│   │   │   │   ├── hipaa-assess.ts                                # CREATE (Task D1)
│   │   │   │   └── assistant-page-help.ts                         # CREATE (Task G1)
│   │   │   ├── index.ts                                           # CREATE (Task A3 — barrel export)
│   │   │   └── __tests__/
│   │   │       ├── runLlm.test.ts                                 # CREATE (Task A4)
│   │   │       ├── rateLimit.test.ts                              # CREATE (Task F1)
│   │   │       └── costGuard.test.ts                              # CREATE (Task F2)
│   │   └── events/
│   │       ├── registry.ts                                        # MODIFY (Task C2 — add REQUIREMENT_STATUS_UPDATED)
│   │       ├── append.ts                                          # EXISTS (no change)
│   │       └── projections/
│   │           └── requirementStatus.ts                           # CREATE (Task C2)
│   └── components/
│       └── gw/
│           └── AiAssistDrawer/
│               └── index.tsx                                      # REWRITE (Task G2)
├── tests/
│   ├── fixtures/
│   │   └── prompts/
│   │       └── hipaa.assess.v1/
│   │           └── solo-pcp-az.json                               # CREATE (Task E1)
│   └── integration/
│       ├── requirement-status.test.ts                             # CREATE (Task C5)
│       ├── hipaa-assess.test.ts                                   # CREATE (Task D4)
│       └── ai-assist.test.ts                                      # CREATE (Task G3)
├── eslint-rules/
│   └── no-direct-projection-mutation.js                           # MODIFY (Task C2 — no new projection tables this sprint; verify set unchanged)
└── docs/
    └── plans/
        └── weeks-5-6-llm-ops-first-module.md                      # THIS FILE
```

---

## Chunk A — LLM ops skeleton (Day 1-2, ~6 hours)

### Task A1: Install missing deps + wire npm scripts

**Files:**
- Modify: `package.json` (adds `db:seed`, `eval:prompts`, `db:seed:hipaa` scripts; `tsx` devDep)

`@anthropic-ai/sdk`, `@upstash/ratelimit`, `@upstash/redis`, and `zod` are already in `package.json` from the weeks 1-2 scaffold. We need `tsx` to run the standalone scripts (seed + eval) without a full Next.js build.

- [ ] **Step 1: Install `tsx`**

```bash
cd "D:/GuardWell/guardwell-v2" && npm install --save-dev tsx
```

Expected: `added 1 package` without errors. `tsx` lands in `devDependencies`.

- [ ] **Step 2: Add scripts to `package.json`**

Open `package.json` and extend the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "NODE_OPTIONS='--max-old-space-size=4096' next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "db:generate": "prisma generate",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate dev",
  "db:studio": "prisma studio",
  "db:seed": "npm run db:seed:hipaa",
  "db:seed:hipaa": "tsx scripts/seed-hipaa.ts",
  "eval:prompts": "tsx scripts/eval-prompts.ts"
}
```

- [ ] **Step 3: Verify `tsx` can execute a trivial file**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsx -e "console.log('tsx ok')"
```

Expected: `tsx ok`.

- [ ] **Step 4: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add package.json package-lock.json && git commit -m "chore: add tsx + db:seed + eval:prompts npm scripts"
```

### Task A2: Lazy-init Anthropic client

**Files:**
- Create: `src/lib/ai/client.ts`

Same init pattern as `src/lib/firebase-admin.ts`: module-level singleton, lazy on first access so Vitest tests that mock the module never construct a real client and `ANTHROPIC_API_KEY` missing during `npm run build` doesn't break the build.

- [ ] **Step 1: Write `src/lib/ai/client.ts`**

```ts
// src/lib/ai/client.ts
//
// Lazy singleton Anthropic client. Do NOT call the SDK from route handlers
// or server actions directly — go through src/lib/ai/runLlm.ts so every
// call is prompt-versioned, Zod-validated, and observed (ADR-0003).

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env locally and Cloud Run Secret Manager in prod.",
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

/** Test-only: reset the cached client so a test can swap in a mock. */
export function __resetAnthropicForTests(): void {
  cached = null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add src/lib/ai/client.ts && git commit -m "feat(ai): lazy Anthropic client singleton with test reset hook"
```

### Task A3: Prompt registry + barrel export

**Files:**
- Create: `src/lib/ai/registry.ts`
- Create: `src/lib/ai/index.ts`
- Create: `src/lib/ai/prompts/hipaa-assess.ts` (placeholder — real content in Task D1; we create the file now so imports resolve)

Registry shape: every prompt is `{ id, version, model, system, inputSchema, outputSchema, toolName, toolDescription }`. `toolName` matches `id` (dots replaced with underscores) because Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`.

- [ ] **Step 1: Write `src/lib/ai/prompts/hipaa-assess.ts` (stub — real schema in Task D1)**

```ts
// src/lib/ai/prompts/hipaa-assess.ts
//
// Stubbed in Chunk A so the registry imports resolve. Real prompt body,
// system message, and output schema get written in Task D1.

import { z } from "zod";

export const hipaaAssessInputSchema = z.object({
  practiceName: z.string().min(1),
  primaryState: z.string().length(2),
  specialty: z.string().optional(),
  staffHeadcount: z.number().int().nonnegative().optional(),
  requirementCodes: z.array(z.string().min(1)).min(1),
});

export const hipaaAssessOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      requirementCode: z.string().min(1),
      likelyStatus: z.enum(["COMPLIANT", "GAP", "NOT_STARTED"]),
      reason: z.string().min(1).max(500),
    }),
  ),
});

export type HipaaAssessInput = z.infer<typeof hipaaAssessInputSchema>;
export type HipaaAssessOutput = z.infer<typeof hipaaAssessOutputSchema>;

export const HIPAA_ASSESS_SYSTEM =
  "You are a HIPAA compliance analyst. Your role is filled in during Task D1.";
```

- [ ] **Step 2: Write `src/lib/ai/registry.ts`**

```ts
// src/lib/ai/registry.ts
//
// THE SOURCE OF TRUTH for every LLM prompt. Adding or changing a prompt:
//   1. Create / edit src/lib/ai/prompts/<id-with-hyphens>.ts
//   2. Add an entry to PROMPTS below
//   3. Write a fixture under tests/fixtures/prompts/<id>/<name>.json
//   4. Add an assertion in scripts/eval-prompts.ts
//
// Prompt ids are dot-namespaced (e.g. "hipaa.assess.v1"). Tool names in
// Anthropic messages cannot contain dots, so we derive toolName by
// replacing "." with "_".

import { z } from "zod";
import {
  HIPAA_ASSESS_SYSTEM,
  hipaaAssessInputSchema,
  hipaaAssessOutputSchema,
} from "./prompts/hipaa-assess";

export interface PromptDef<
  TIn extends z.ZodTypeAny = z.ZodTypeAny,
  TOut extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  version: number;
  model: string;
  system: string;
  inputSchema: TIn;
  outputSchema: TOut;
  /** Tool name must match ^[a-zA-Z0-9_-]{1,64}$ for Anthropic's API. */
  toolName: string;
  toolDescription: string;
  /** Maximum tokens the model may emit. Prevents runaway cost. */
  maxTokens: number;
}

function idToToolName(id: string): string {
  return id.replace(/\./g, "_");
}

export const PROMPTS = {
  "hipaa.assess.v1": {
    id: "hipaa.assess.v1",
    version: 1,
    model: "claude-opus-4-7",
    system: HIPAA_ASSESS_SYSTEM,
    inputSchema: hipaaAssessInputSchema,
    outputSchema: hipaaAssessOutputSchema,
    toolName: idToToolName("hipaa.assess.v1"),
    toolDescription:
      "Return a best-guess status (COMPLIANT | GAP | NOT_STARTED) and reason for each requested HIPAA requirement code.",
    maxTokens: 2048,
  },
} as const satisfies Record<string, PromptDef>;

export type PromptId = keyof typeof PROMPTS;

export function getPrompt<T extends PromptId>(id: T): (typeof PROMPTS)[T] {
  const p = PROMPTS[id];
  if (!p) throw new Error(`Unknown prompt id: ${id}`);
  return p;
}
```

- [ ] **Step 3: Write `src/lib/ai/index.ts`**

```ts
// src/lib/ai/index.ts
export { getAnthropic, __resetAnthropicForTests } from "./client";
export { PROMPTS, getPrompt, type PromptId, type PromptDef } from "./registry";
export { runLlm, type RunLlmResult } from "./runLlm";
```

(The `./runLlm` import resolves after Task A4.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: one error per missing `./runLlm`. That's fine — it resolves in the next task. If additional errors appear, fix those now.

### Task A4: `runLlm` — the only path for calling Claude

**Files:**
- Create: `src/lib/ai/runLlm.ts`
- Create: `src/lib/ai/__tests__/runLlm.test.ts`

Flow per call:
1. Look up the prompt by id.
2. Validate `input` against `prompt.inputSchema` (throws early on bad input).
3. Call Claude with `tool_choice: { type: "tool", name: prompt.toolName }` so the model is required to emit structured JSON via tool use.
4. Extract the tool input from `response.content[].type === "tool_use"`.
5. Validate the tool input against `prompt.outputSchema`.
6. Write an `LlmCall` row (success=true with tokens/cost).
7. Return `{ output, llmCallId, latencyMs, usage }`.

On any failure (validation, API, tool-use missing) still write an LlmCall row with `success=false` and a short `errorCode`, then rethrow.

- [ ] **Step 1: Write the failing test — `src/lib/ai/__tests__/runLlm.test.ts`**

```ts
// src/lib/ai/__tests__/runLlm.test.ts
//
// Integration-level: real Prisma (so we assert LlmCall rows land in the DB),
// mocked Anthropic client (so we don't burn tokens in CI).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { runLlm } from "@/lib/ai/runLlm";
import { __resetAnthropicForTests } from "@/lib/ai/client";

// Module-mock Anthropic BEFORE any import touches it.
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { create },
  }));
  return { default: Anthropic, Anthropic };
});

// Re-acquire the mocked `create` after vi.mock has set up the module.
async function getMockedCreate() {
  const mod = await import("@anthropic-ai/sdk");
  // The Anthropic default export is a constructor mock; the instance's
  // messages.create is the fn we want to program per test.
  const AnthropicCtor = (mod as unknown as { default: ReturnType<typeof vi.fn> })
    .default;
  // Construct a fresh instance to harvest the bound `create` mock.
  const instance = new (AnthropicCtor as unknown as new () => {
    messages: { create: ReturnType<typeof vi.fn> };
  })();
  return instance.messages.create;
}

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

const VALID_INPUT = {
  practiceName: "Test Clinic",
  primaryState: "AZ",
  requirementCodes: ["HIPAA_PRIVACY_OFFICER"],
};

const VALID_TOOL_OUTPUT = {
  suggestions: [
    {
      requirementCode: "HIPAA_PRIVACY_OFFICER",
      likelyStatus: "NOT_STARTED" as const,
      reason: "Small practice with no documented Privacy Officer designation.",
    },
  ],
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  __resetAnthropicForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runLlm", () => {
  it("calls the mocked Anthropic API with tool-choice forcing structured output", async () => {
    const { practice, user } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_123",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 900, output_tokens: 120 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const result = await runLlm("hipaa.assess.v1", VALID_INPUT, {
      practiceId: practice.id,
      actorUserId: user.id,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]![0];
    expect(call.tool_choice).toEqual({ type: "tool", name: "hipaa_assess_v1" });
    expect(Array.isArray(call.tools)).toBe(true);
    expect(call.tools[0].name).toBe("hipaa_assess_v1");

    expect(result.output).toEqual(VALID_TOOL_OUTPUT);
    expect(typeof result.llmCallId).toBe("string");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("writes an LlmCall row with success=true on a good call", async () => {
    const { practice, user } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_ok",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 1200, output_tokens: 200 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await runLlm("hipaa.assess.v1", VALID_INPUT, {
      practiceId: practice.id,
      actorUserId: user.id,
    });

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(true);
    expect(rows[0]?.promptId).toBe("hipaa.assess.v1");
    expect(rows[0]?.promptVersion).toBe(1);
    expect(rows[0]?.model).toBe("claude-opus-4-7");
    expect(rows[0]?.inputTokens).toBe(1200);
    expect(rows[0]?.outputTokens).toBe(200);
    expect(rows[0]?.containsPHI).toBe(false);
  });

  it("rejects malformed input before calling Anthropic and writes NO LlmCall row", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();

    await expect(
      runLlm(
        "hipaa.assess.v1",
        // @ts-expect-error intentionally invalid: primaryState too long
        { practiceName: "X", primaryState: "Arizona", requirementCodes: ["A"] },
        { practiceId: practice.id },
      ),
    ).rejects.toThrow();

    expect(create).not.toHaveBeenCalled();
    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(0);
  });

  it("rejects LLM output that fails the output schema and writes LlmCall success=false", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_bad",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          // missing required field `reason` in the suggestion
          input: {
            suggestions: [
              { requirementCode: "HIPAA_PRIVACY_OFFICER", likelyStatus: "GAP" },
            ],
          },
        },
      ],
      usage: { input_tokens: 900, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/OUTPUT_SCHEMA/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("OUTPUT_SCHEMA");
  });

  it("writes LlmCall success=false when Anthropic throws (e.g. 500)", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockRejectedValueOnce(new Error("Upstream 500"));

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/Upstream 500/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("UPSTREAM");
  });

  it("writes LlmCall success=false when the response has no tool_use block", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_notool",
      content: [{ type: "text", text: "Nope." }],
      usage: { input_tokens: 100, output_tokens: 5 },
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });

    await expect(
      runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id }),
    ).rejects.toThrow(/NO_TOOL_USE/);

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe("NO_TOOL_USE");
  });

  it("hashes the input (sha256 hex) and stores it on LlmCall.inputHash", async () => {
    const { practice } = await seedPractice();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg_h",
      content: [
        { type: "tool_use", id: "tu_1", name: "hipaa_assess_v1", input: VALID_TOOL_OUTPUT },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    await runLlm("hipaa.assess.v1", VALID_INPUT, { practiceId: practice.id });

    const rows = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(rows[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Extend `tests/setup.ts` afterEach to also wipe LlmCall rows**

The existing `tests/setup.ts` deletes practice/user/events but not `llmCall`. Without cleanup, runs bleed across tests.

```ts
// tests/setup.ts — EDIT the afterEach block
afterEach(async () => {
  await db.llmCall.deleteMany();
  await db.eventLog.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
});
```

(Keep `beforeAll(async () => db.$connect())` unchanged.)

- [ ] **Step 3: Run the test — expect RED (runLlm.ts doesn't exist)**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/runLlm.test.ts
```

Expected: failures because `@/lib/ai/runLlm` cannot be resolved.

- [ ] **Step 4: Implement `src/lib/ai/runLlm.ts`**

```ts
// src/lib/ai/runLlm.ts
//
// The ONLY path for calling Claude (ADR-0003). Every call is:
//   (1) input-validated by Zod
//   (2) executed via the prompt's registered tool (structured output)
//   (3) output-validated by Zod
//   (4) persisted to LlmCall for observability + cost tracking
//
// Never import the Anthropic SDK directly elsewhere.

import crypto from "node:crypto";
import { db } from "@/lib/db";
import { getAnthropic } from "./client";
import { getPrompt, type PromptId, PROMPTS } from "./registry";
import { z } from "zod";
import { zodToJsonSchema } from "./zodToJsonSchema";

// --- Pricing table (USD per million tokens) ---------------------------------
// Updated 2026-04 from Anthropic pricing page. When a new model is added to
// the registry, add its price here too or costUsd is null.
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7":  { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3,  output: 15 },
  "claude-haiku-4-5-20251001":  { input: 1,  output: 5  },
};

function estimateCostUsd(model: string, input: number, output: number): number | null {
  const p = PRICING_PER_MTOK[model];
  if (!p) return null;
  const cost = (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
  return Number(cost.toFixed(6));
}

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

export interface RunLlmOptions {
  practiceId?: string | null;
  actorUserId?: string | null;
  /** Opt-in PHI flag. Logged on LlmCall row. Defaults to false. */
  allowPHI?: boolean;
}

export interface RunLlmResult<TOut> {
  output: TOut;
  llmCallId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

type ErrorCode =
  | "INPUT_SCHEMA"
  | "UPSTREAM"
  | "NO_TOOL_USE"
  | "OUTPUT_SCHEMA"
  | "INTERNAL";

async function writeLlmCall(args: {
  promptId: string;
  promptVersion: number;
  model: string;
  practiceId?: string | null;
  actorUserId?: string | null;
  inputHash: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs: number;
  costUsd: number | null;
  success: boolean;
  errorCode?: ErrorCode | null;
  containsPHI: boolean;
}) {
  const row = await db.llmCall.create({
    data: {
      promptId: args.promptId,
      promptVersion: args.promptVersion,
      model: args.model,
      practiceId: args.practiceId ?? null,
      actorUserId: args.actorUserId ?? null,
      inputHash: args.inputHash,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      latencyMs: args.latencyMs,
      costUsd: args.costUsd as unknown as null, // Prisma Decimal accepts number
      success: args.success,
      errorCode: args.errorCode ?? null,
      containsPHI: args.containsPHI,
    },
  });
  return row.id;
}

export async function runLlm<T extends PromptId>(
  promptId: T,
  input: z.infer<(typeof PROMPTS)[T]["inputSchema"]>,
  options: RunLlmOptions = {},
): Promise<RunLlmResult<z.infer<(typeof PROMPTS)[T]["outputSchema"]>>> {
  const prompt = getPrompt(promptId);
  const containsPHI = options.allowPHI === true;

  // 1) Validate input.
  const parsedInput = prompt.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    // Do NOT write an LlmCall row — we never reached the provider. Bad input
    // is a caller bug, not observed AI behavior.
    throw new Error(`INPUT_SCHEMA: ${parsedInput.error.message}`);
  }

  const inputHash = stableHash(parsedInput.data);
  const started = Date.now();
  const client = getAnthropic();

  // 2) Call Claude with tool-use as the structured-output mechanism.
  let resp:
    | {
        id: string;
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
        usage: { input_tokens: number; output_tokens: number };
        model: string;
        stop_reason: string;
      }
    | null = null;
  try {
    resp = (await client.messages.create({
      model: prompt.model,
      system: prompt.system,
      max_tokens: prompt.maxTokens,
      tools: [
        {
          name: prompt.toolName,
          description: prompt.toolDescription,
          input_schema: zodToJsonSchema(prompt.outputSchema),
        },
      ],
      tool_choice: { type: "tool", name: prompt.toolName },
      messages: [
        {
          role: "user",
          content: JSON.stringify(parsedInput.data),
        },
      ],
    })) as typeof resp;
  } catch (err) {
    const latency = Date.now() - started;
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: prompt.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      latencyMs: latency,
      costUsd: null,
      success: false,
      errorCode: "UPSTREAM",
      containsPHI,
    });
    throw err instanceof Error ? err : new Error("UPSTREAM");
  }

  const latencyMs = Date.now() - started;
  const inputTokens = resp!.usage.input_tokens;
  const outputTokens = resp!.usage.output_tokens;
  const costUsd = estimateCostUsd(resp!.model, inputTokens, outputTokens);

  // 3) Extract tool input.
  const toolBlock = resp!.content.find(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
      b.type === "tool_use",
  );
  if (!toolBlock) {
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: resp!.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd,
      success: false,
      errorCode: "NO_TOOL_USE",
      containsPHI,
    });
    throw new Error("NO_TOOL_USE: Claude response contained no tool_use block");
  }

  // 4) Validate output.
  const parsedOutput = prompt.outputSchema.safeParse(toolBlock.input);
  if (!parsedOutput.success) {
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: resp!.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd,
      success: false,
      errorCode: "OUTPUT_SCHEMA",
      containsPHI,
    });
    throw new Error(`OUTPUT_SCHEMA: ${parsedOutput.error.message}`);
  }

  // 5) Success LlmCall row.
  const llmCallId = await writeLlmCall({
    promptId: prompt.id,
    promptVersion: prompt.version,
    model: resp!.model,
    practiceId: options.practiceId,
    actorUserId: options.actorUserId,
    inputHash,
    inputTokens,
    outputTokens,
    latencyMs,
    costUsd,
    success: true,
    containsPHI,
  });

  return {
    output: parsedOutput.data,
    llmCallId,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd,
  };
}
```

- [ ] **Step 5: Write a minimal `zodToJsonSchema` helper**

Anthropic's tool-use API expects JSON Schema for tool inputs. We only use a small subset of Zod (object/array/string/enum/number/boolean/optional), so hand-rolling a converter is less dependency weight than pulling in `zod-to-json-schema`.

Create `src/lib/ai/zodToJsonSchema.ts`:

```ts
// src/lib/ai/zodToJsonSchema.ts
//
// Minimal Zod -> JSON Schema for the shapes we use in prompt outputs.
// Covers: object, array, string, string.enum, string.email, number (int /
// nonnegative), boolean, optional, literal. Throw on anything else so the
// next prompt author gets a clear signal to extend this function.

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const child = value as z.ZodTypeAny;
        properties[key] = convert(child);
        if (!isOptional(child)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodArray": {
      const inner = (def as unknown as { type: z.ZodTypeAny }).type;
      return { type: "array", items: convert(inner) };
    }
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      const checks = (def as unknown as { checks?: Array<{ kind: string; value?: unknown }> }).checks ?? [];
      for (const c of checks) {
        if (c.kind === "email") out.format = "email";
        if (c.kind === "min") out.minLength = c.value as number;
        if (c.kind === "max") out.maxLength = c.value as number;
        if (c.kind === "length") { out.minLength = c.value as number; out.maxLength = c.value as number; }
      }
      return out;
    }
    case "ZodEnum": {
      const values = (def as unknown as { values: string[] }).values;
      return { type: "string", enum: values };
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      const checks = (def as unknown as { checks?: Array<{ kind: string; value?: unknown }> }).checks ?? [];
      for (const c of checks) {
        if (c.kind === "int") out.type = "integer";
        if (c.kind === "min") out.minimum = c.value as number;
        if (c.kind === "max") out.maximum = c.value as number;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodOptional":
      return convert((def as unknown as { innerType: z.ZodTypeAny }).innerType);
    case "ZodLiteral": {
      const value = (def as unknown as { value: unknown }).value;
      return { type: typeof value, enum: [value] } as JsonSchema;
    }
    default:
      throw new Error(`zodToJsonSchema: unsupported Zod type ${def.typeName}`);
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  return def.typeName === "ZodOptional";
}
```

- [ ] **Step 6: Run the test — expect GREEN**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/runLlm.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 7: Verify TypeScript + lint**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit && npm run lint
```

Expected: zero errors.

- [ ] **Step 8: Commit chunk A**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "$(cat <<'EOF'
feat(ai): runLlm wrapper with prompt registry, Zod validation, tool-use structured outputs, and LlmCall observability (ADR-0003)

- src/lib/ai/client.ts: lazy Anthropic singleton
- src/lib/ai/registry.ts: prompt defs (hipaa.assess.v1 stub)
- src/lib/ai/runLlm.ts: input validation -> Anthropic tools -> output
  validation -> LlmCall row (success + failure paths)
- src/lib/ai/zodToJsonSchema.ts: minimal converter for tool input_schema
- tests/setup.ts: clean LlmCall rows between integration tests
- 7 integration tests covering success, input-schema, output-schema,
  upstream error, missing tool_use, and input hashing
EOF
)"
```

---

## Chunk B — HIPAA seed (Day 2-3, ~4 hours)

### Task B1: Idempotent HIPAA seed script

**Files:**
- Create: `scripts/seed-hipaa.ts`

Seed writes 1 `RegulatoryFramework` (code=`HIPAA`) + 10 `RegulatoryRequirement` rows. Every write is `upsert` keyed on its natural unique key so re-running produces zero net changes.

Requirement coverage (10 rows — well-known HIPAA admin/physical/technical safeguards + Privacy + Breach):

| code | title | citation | severity |
|---|---|---|---|
| `HIPAA_PRIVACY_OFFICER` | Designate a Privacy Officer | 45 CFR §164.530(a)(1)(i) | CRITICAL |
| `HIPAA_SECURITY_OFFICER` | Designate a Security Officer | 45 CFR §164.308(a)(2) | CRITICAL |
| `HIPAA_SRA` | Conduct a Security Risk Assessment | 45 CFR §164.308(a)(1)(ii)(A) | CRITICAL |
| `HIPAA_POLICIES_PROCEDURES` | Written HIPAA policies and procedures | 45 CFR §164.530(i)(1) | CRITICAL |
| `HIPAA_WORKFORCE_TRAINING` | Train all workforce members on HIPAA | 45 CFR §164.530(b)(1) | STANDARD |
| `HIPAA_BAAS` | Execute Business Associate Agreements | 45 CFR §164.308(b)(1) | CRITICAL |
| `HIPAA_MINIMUM_NECESSARY` | Minimum-necessary use and disclosure policy | 45 CFR §164.502(b) | STANDARD |
| `HIPAA_NPP` | Notice of Privacy Practices available to patients | 45 CFR §164.520(a)(1) | STANDARD |
| `HIPAA_BREACH_RESPONSE` | Written breach response procedure | 45 CFR §164.404 | CRITICAL |
| `HIPAA_WORKSTATION_USE` | Workstation use and security policy | 45 CFR §164.310(b)-(c) | STANDARD |

- [ ] **Step 1: Write `scripts/seed-hipaa.ts`**

```ts
// scripts/seed-hipaa.ts
//
// Idempotent: re-running upserts every row keyed by its natural unique
// (framework.code, requirement.(frameworkId, code)). Produces 1
// RegulatoryFramework + 10 RegulatoryRequirement rows for HIPAA.
//
// Usage:
//   npm run db:seed:hipaa
//
// Adding a module (e.g. OSHA) later is a sibling script with the same
// shape — no platform code changes (ADR-0004).

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {
      name: "Health Insurance Portability and Accountability Act",
      shortName: "HIPAA",
      description:
        "Federal privacy, security, and breach-notification obligations for covered entities and business associates.",
      citation: "45 CFR Parts 160, 162, and 164",
      jurisdiction: "federal",
      weightDefault: 0.25,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "ShieldCheck",
      colorKey: "gw-color-good",
      sortOrder: 10,
    },
    create: {
      code: "HIPAA",
      name: "Health Insurance Portability and Accountability Act",
      shortName: "HIPAA",
      description:
        "Federal privacy, security, and breach-notification obligations for covered entities and business associates.",
      citation: "45 CFR Parts 160, 162, and 164",
      jurisdiction: "federal",
      weightDefault: 0.25,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "ShieldCheck",
      colorKey: "gw-color-good",
      sortOrder: 10,
    },
  });

  const requirements = [
    {
      code: "HIPAA_PRIVACY_OFFICER",
      title: "Designate a Privacy Officer",
      citation: "45 CFR §164.530(a)(1)(i)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "A covered entity must designate a Privacy Officer responsible for the development and implementation of the policies and procedures.",
      acceptedEvidenceTypes: ["ATTESTATION"],
      sortOrder: 10,
    },
    {
      code: "HIPAA_SECURITY_OFFICER",
      title: "Designate a Security Officer",
      citation: "45 CFR §164.308(a)(2)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Identify the security official responsible for developing and implementing the required policies and procedures.",
      acceptedEvidenceTypes: ["ATTESTATION"],
      sortOrder: 20,
    },
    {
      code: "HIPAA_SRA",
      title: "Conduct a Security Risk Assessment",
      citation: "45 CFR §164.308(a)(1)(ii)(A)",
      severity: "CRITICAL",
      weight: 2,
      description:
        "Perform an accurate and thorough assessment of risks and vulnerabilities to the confidentiality, integrity, and availability of ePHI.",
      acceptedEvidenceTypes: ["SRA_ANSWER", "ATTESTATION"],
      sortOrder: 30,
    },
    {
      code: "HIPAA_POLICIES_PROCEDURES",
      title: "Written HIPAA policies and procedures",
      citation: "45 CFR §164.530(i)(1)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Implement policies and procedures with respect to protected health information to comply with the Privacy and Security Rules.",
      acceptedEvidenceTypes: ["POLICY"],
      sortOrder: 40,
    },
    {
      code: "HIPAA_WORKFORCE_TRAINING",
      title: "Train all workforce members on HIPAA",
      citation: "45 CFR §164.530(b)(1)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Train all members of the workforce on policies and procedures with respect to PHI, as necessary and appropriate for them to carry out their function.",
      acceptedEvidenceTypes: ["TRAINING"],
      sortOrder: 50,
    },
    {
      code: "HIPAA_BAAS",
      title: "Execute Business Associate Agreements",
      citation: "45 CFR §164.308(b)(1)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Obtain satisfactory assurances from business associates that they will appropriately safeguard PHI.",
      acceptedEvidenceTypes: ["BAA"],
      sortOrder: 60,
    },
    {
      code: "HIPAA_MINIMUM_NECESSARY",
      title: "Minimum-necessary use and disclosure policy",
      citation: "45 CFR §164.502(b)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Limit uses, disclosures, and requests of PHI to the minimum necessary to accomplish the intended purpose.",
      acceptedEvidenceTypes: ["POLICY"],
      sortOrder: 70,
    },
    {
      code: "HIPAA_NPP",
      title: "Notice of Privacy Practices available to patients",
      citation: "45 CFR §164.520(a)(1)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Provide a notice of privacy practices describing how PHI may be used and disclosed, and the individual's rights.",
      acceptedEvidenceTypes: ["POLICY", "ATTESTATION"],
      sortOrder: 80,
    },
    {
      code: "HIPAA_BREACH_RESPONSE",
      title: "Written breach response procedure",
      citation: "45 CFR §164.404",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Maintain a documented procedure for investigating, assessing, and notifying affected individuals of breaches of unsecured PHI.",
      acceptedEvidenceTypes: ["POLICY", "INCIDENT_LOG"],
      sortOrder: 90,
    },
    {
      code: "HIPAA_WORKSTATION_USE",
      title: "Workstation use and security policy",
      citation: "45 CFR §164.310(b)-(c)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Implement policies and procedures that specify the proper functions to be performed and the physical safeguards for workstations that access ePHI.",
      acceptedEvidenceTypes: ["POLICY"],
      sortOrder: 100,
    },
  ];

  let upserted = 0;
  for (const r of requirements) {
    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId: framework.id, code: r.code } },
      update: {
        title: r.title,
        citation: r.citation,
        severity: r.severity,
        weight: r.weight,
        description: r.description,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
      create: {
        frameworkId: framework.id,
        code: r.code,
        title: r.title,
        citation: r.citation,
        severity: r.severity,
        weight: r.weight,
        description: r.description,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
    });
    upserted += 1;
  }

  console.log(
    `Seed HIPAA: framework id=${framework.id}, ${upserted} requirements upserted.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
```

- [ ] **Step 2: Run the seed for the first time**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run db:seed:hipaa
```

Expected: `Seed HIPAA: framework id=<cuid>, 10 requirements upserted.` Exit code 0.

- [ ] **Step 3: Verify with a SQL count**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma db execute --stdin <<< "SELECT code, (SELECT count(*) FROM \"RegulatoryRequirement\" r WHERE r.\"frameworkId\" = f.id) AS req_count FROM \"RegulatoryFramework\" f WHERE f.code = 'HIPAA';"
```

Expected: one row `HIPAA | 10`.

- [ ] **Step 4: Run the seed a SECOND time (idempotency check)**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run db:seed:hipaa && npx prisma db execute --stdin <<< "SELECT count(*) FROM \"RegulatoryRequirement\";"
```

Expected: still 10 rows. No duplicates.

- [ ] **Step 5: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add scripts/seed-hipaa.ts package.json package-lock.json && git commit -m "feat(seed): idempotent HIPAA framework + 10 requirements (ADR-0004 modules-as-data first module)"
```

---

## Chunk C — Module page scaffold (Day 3-4, ~6 hours)

### Task C1: Module index page `/modules`

**Files:**
- Create: `src/app/(dashboard)/modules/page.tsx`

Lists every enabled framework for the current practice as `<ComplianceCard>`s. With only HIPAA seeded, there's exactly one card.

- [ ] **Step 1: Write the page**

```tsx
// src/app/(dashboard)/modules/page.tsx
import Link from "next/link";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { ComplianceCard } from "@/components/gw/ComplianceCard";
import { EmptyState } from "@/components/gw/EmptyState";
import { Inbox } from "lucide-react";

export const metadata = { title: "My Compliance · GuardWell" };

export default async function ModulesIndexPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  // Show every framework with a sort_order, even if the practice has not
  // activated it yet. PracticeFramework rows drive enable/disable; for
  // week 5 we render them all and link to the module page which lazily
  // creates a PracticeFramework row on first load.
  const frameworks = await db.regulatoryFramework.findMany({
    orderBy: { sortOrder: "asc" },
  });

  if (frameworks.length === 0) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Inbox}
          title="No frameworks loaded"
          description="Run `npm run db:seed` to seed the regulatory framework content."
        />
      </main>
    );
  }

  const pfs = await db.practiceFramework.findMany({
    where: { practiceId: pu.practiceId },
  });
  const scoreByFramework = new Map(pfs.map((p) => [p.frameworkId, p.scoreCache ?? 0]));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">My Compliance</h1>
        <p className="text-sm text-muted-foreground">
          One module per regulatory framework. Click to see requirements.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {frameworks.map((f) => (
          <Link key={f.id} href={`/modules/${f.code.toLowerCase()}`}>
            <ComplianceCard
              title={f.name}
              subtitle={f.citation ?? undefined}
              score={scoreByFramework.get(f.id) ?? 0}
            />
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Quick smoke test**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task C2: Add `REQUIREMENT_STATUS_UPDATED` event + projection

**Files:**
- Modify: `src/lib/events/registry.ts` (add event type + schema)
- Create: `src/lib/events/projections/requirementStatus.ts`
- Verify: `eslint-rules/no-direct-projection-mutation.js` (no new projection table; existing `complianceItem` already listed)

- [ ] **Step 1: Extend the event registry**

Open `src/lib/events/registry.ts` and replace its contents with:

```ts
// THE SOURCE OF TRUTH for what events exist. Adding a new event type is a
// 3-step pattern:
//   1. Add the literal to `EventType` union below
//   2. Add the Zod schema to `EVENT_SCHEMAS` keyed by (type, version)
//   3. (Optional) Register a projection handler under src/lib/events/projections/

import { z } from "zod";

export const EVENT_TYPES = [
  "PRACTICE_CREATED",
  "USER_INVITED",
  "REQUIREMENT_STATUS_UPDATED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const REQUIREMENT_STATUS_VALUES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLIANT",
  "GAP",
  "NOT_APPLICABLE",
] as const;

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
  REQUIREMENT_STATUS_UPDATED: {
    1: z.object({
      requirementId: z.string().min(1),
      frameworkCode: z.string().min(1),
      requirementCode: z.string().min(1),
      previousStatus: z.enum(REQUIREMENT_STATUS_VALUES).nullable(),
      nextStatus: z.enum(REQUIREMENT_STATUS_VALUES),
      source: z.enum(["USER", "AI_ASSESSMENT", "IMPORT"]),
      reason: z.string().max(500).optional(),
    }),
  },
} as const;

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

- [ ] **Step 2: Write the projection handler**

```ts
// src/lib/events/projections/requirementStatus.ts
//
// Projects REQUIREMENT_STATUS_UPDATED events into ComplianceItem rows.
// Called inside the appendEventAndApply transaction via the projection
// callback the server action passes.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"REQUIREMENT_STATUS_UPDATED", 1>;

export async function projectRequirementStatusUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Upsert the ComplianceItem. Unique on (practiceId, requirementId).
  await tx.complianceItem.upsert({
    where: {
      practiceId_requirementId: {
        practiceId,
        requirementId: payload.requirementId,
      },
    },
    update: {
      status: payload.nextStatus,
    },
    create: {
      practiceId,
      requirementId: payload.requirementId,
      status: payload.nextStatus,
    },
  });
}
```

- [ ] **Step 3: Verify the lint rule already permits this file**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run lint
```

Expected: zero errors. `src/lib/events/projections/requirementStatus.ts` is under `src/lib/events/` which is in `ALLOWED_PATHS`. `complianceItem` is in `PROJECTION_TABLES` — no change needed.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task C3: Dynamic route `/modules/[code]`

**Files:**
- Create: `src/app/(dashboard)/modules/[code]/page.tsx`

Reads framework by code, loads requirements + existing ComplianceItems, composes `<ModuleHeader>` + `<ChecklistItem>` list. `<ChecklistItem>` is a client-side control, so we render it via a tiny client-boundary wrapper that dispatches the server action.

- [ ] **Step 1: Write the page**

```tsx
// src/app/(dashboard)/modules/[code]/page.tsx
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/gw/ModuleHeader";
import { ChecklistItemServer } from "./ChecklistItemServer";
import { AiAssessmentButton } from "./AiAssessmentButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `${code.toUpperCase()} · My Compliance` };
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const framework = await db.regulatoryFramework.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      requirements: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!framework) notFound();

  const items = await db.complianceItem.findMany({
    where: {
      practiceId: pu.practiceId,
      requirementId: { in: framework.requirements.map((r) => r.id) },
    },
  });
  const byReq = new Map(items.map((i) => [i.requirementId, i]));

  const pf = await db.practiceFramework.findUnique({
    where: {
      practiceId_frameworkId: {
        practiceId: pu.practiceId,
        frameworkId: framework.id,
      },
    },
  });
  const score = pf?.scoreCache ?? 0;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <ModuleHeader
        icon={ShieldCheck}
        name={framework.name}
        citation={framework.citation ?? undefined}
        score={score}
        jurisdictions={[framework.jurisdiction]}
      />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Requirements</h2>
          <AiAssessmentButton frameworkCode={framework.code} />
        </div>
        <div className="space-y-2">
          {framework.requirements.map((r) => {
            const ci = byReq.get(r.id);
            return (
              <ChecklistItemServer
                key={r.id}
                frameworkCode={framework.code}
                requirementId={r.id}
                requirementCode={r.code}
                title={r.title}
                description={r.citation ?? undefined}
                initialStatus={ciStatusToChecklist(ci?.status)}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

function ciStatusToChecklist(
  s: string | undefined,
): "compliant" | "gap" | "not_started" {
  if (s === "COMPLIANT") return "compliant";
  if (s === "GAP") return "gap";
  return "not_started";
}
```

- [ ] **Step 2: Write `ChecklistItemServer` client wrapper**

```tsx
// src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx
"use client";

import { useTransition, useState } from "react";
import { ChecklistItem, type ChecklistStatus } from "@/components/gw/ChecklistItem";
import { updateRequirementStatusAction } from "./actions";

export function ChecklistItemServer(props: {
  frameworkCode: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  description?: string;
  initialStatus: ChecklistStatus;
}) {
  const [status, setStatus] = useState<ChecklistStatus>(props.initialStatus);
  const [isPending, startTransition] = useTransition();

  return (
    <ChecklistItem
      title={props.title}
      description={props.description}
      status={status}
      disabled={isPending}
      onStatusChange={(next) => {
        const prev = status;
        setStatus(next);
        startTransition(async () => {
          try {
            await updateRequirementStatusAction({
              frameworkCode: props.frameworkCode,
              requirementId: props.requirementId,
              requirementCode: props.requirementCode,
              nextStatus: checklistToCiStatus(next),
              previousStatus: checklistToCiStatus(prev),
            });
          } catch (err) {
            // Revert on server failure.
            setStatus(prev);
            console.error(err);
          }
        });
      }}
    />
  );
}

function checklistToCiStatus(
  s: ChecklistStatus,
): "COMPLIANT" | "GAP" | "NOT_STARTED" {
  if (s === "compliant") return "COMPLIANT";
  if (s === "gap") return "GAP";
  return "NOT_STARTED";
}
```

- [ ] **Step 3: Write `AiAssessmentButton` client wrapper (server action body comes in Task D3)**

```tsx
// src/app/(dashboard)/modules/[code]/AiAssessmentButton.tsx
"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { runAiAssessmentAction } from "@/app/(dashboard)/modules/hipaa/assess/actions";

export function AiAssessmentButton({ frameworkCode }: { frameworkCode: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (frameworkCode.toUpperCase() !== "HIPAA") {
    return null; // Only wired for HIPAA in week 5.
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[color:var(--gw-color-risk)]">{error}</span>}
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await runAiAssessmentAction();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Assessment failed");
            }
          })
        }
      >
        {pending ? "Running…" : "Run AI assessment"}
      </Button>
    </div>
  );
}
```

### Task C4: Server action for status change

**Files:**
- Create: `src/app/(dashboard)/modules/[code]/actions.ts`

- [ ] **Step 1: Write the action**

```ts
// src/app/(dashboard)/modules/[code]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";
import { REQUIREMENT_STATUS_VALUES } from "@/lib/events/registry";

const Input = z.object({
  frameworkCode: z.string().min(1),
  requirementId: z.string().min(1),
  requirementCode: z.string().min(1),
  nextStatus: z.enum(REQUIREMENT_STATUS_VALUES),
  previousStatus: z.enum(REQUIREMENT_STATUS_VALUES),
});

export async function updateRequirementStatusAction(
  input: z.infer<typeof Input>,
) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "REQUIREMENT_STATUS_UPDATED",
      payload: {
        requirementId: parsed.requirementId,
        frameworkCode: parsed.frameworkCode,
        requirementCode: parsed.requirementCode,
        previousStatus: parsed.previousStatus,
        nextStatus: parsed.nextStatus,
        source: "USER",
      },
    },
    async (tx, evt) =>
      projectRequirementStatusUpdated(tx, {
        practiceId: pu.practiceId,
        payload: {
          requirementId: parsed.requirementId,
          frameworkCode: parsed.frameworkCode,
          requirementCode: parsed.requirementCode,
          previousStatus: parsed.previousStatus,
          nextStatus: parsed.nextStatus,
          source: "USER",
        },
      }),
  );

  revalidatePath(`/modules/${parsed.frameworkCode.toLowerCase()}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. If `runAiAssessmentAction` import in `AiAssessmentButton.tsx` fails because that file doesn't exist yet, temporarily stub it with an empty async function in `src/app/(dashboard)/modules/hipaa/assess/actions.ts`:

```ts
"use server";
export async function runAiAssessmentAction() {
  throw new Error("Not implemented yet — see Task D3.");
}
```

Remove this stub when Task D3 completes.

### Task C5: Integration test for status change round-trip

**Files:**
- Create: `tests/integration/requirement-status.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/requirement-status.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";

async function seedPracticeAndHipaaReq() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "Test fixture — not used for real compliance",
      jurisdiction: "federal",
    },
  });
  const requirement = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_SRA" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_SRA",
      title: "SRA",
      description: "test",
    },
  });
  return { user, practice, framework, requirement };
}

describe("REQUIREMENT_STATUS_UPDATED", () => {
  it("projects a new ComplianceItem with the next status + writes an EventLog row", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: requirement.id,
          frameworkCode: "HIPAA",
          requirementCode: "HIPAA_SRA",
          previousStatus: "NOT_STARTED",
          nextStatus: "COMPLIANT",
          source: "USER",
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        }),
    );

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: requirement.id,
        },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");

    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(1);
  });

  it("a second event updates the existing ComplianceItem (not a duplicate row)", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();

    const emit = (next: "COMPLIANT" | "GAP") =>
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "REQUIREMENT_STATUS_UPDATED",
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: next === "COMPLIANT" ? "NOT_STARTED" : "COMPLIANT",
            nextStatus: next,
            source: "USER",
          },
        },
        async (tx) =>
          projectRequirementStatusUpdated(tx, {
            practiceId: practice.id,
            payload: {
              requirementId: requirement.id,
              frameworkCode: "HIPAA",
              requirementCode: "HIPAA_SRA",
              previousStatus: next === "COMPLIANT" ? "NOT_STARTED" : "COMPLIANT",
              nextStatus: next,
              source: "USER",
            },
          }),
      );

    await emit("COMPLIANT");
    await emit("GAP");

    const cis = await db.complianceItem.findMany({
      where: { practiceId: practice.id, requirementId: requirement.id },
    });
    expect(cis).toHaveLength(1);
    expect(cis[0]?.status).toBe("GAP");

    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(2);
  });

  it("rejects an unknown status value via Zod", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "REQUIREMENT_STATUS_UPDATED",
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: "NOT_STARTED",
            // @ts-expect-error intentionally invalid
            nextStatus: "WORKING_ON_IT",
            source: "USER",
          },
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node tests/integration/requirement-status.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Commit chunk C**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "$(cat <<'EOF'
feat(modules): /modules/[code] dynamic route + REQUIREMENT_STATUS_UPDATED event

- Event type + Zod schema added to registry
- projectRequirementStatusUpdated projection writes to ComplianceItem
  (goes through appendEventAndApply per ADR-0001)
- /modules index + dynamic [code] page compose ModuleHeader +
  ChecklistItem from the gw/ design system
- Server action wires status changes end to end
- Integration tests for single + repeated updates + Zod rejection
EOF
)"
```

---

## Chunk D — "Assess my HIPAA posture" AI flow (Day 4-5, ~6 hours)

### Task D1: Write the real `hipaa.assess.v1` prompt body

**Files:**
- Rewrite: `src/lib/ai/prompts/hipaa-assess.ts`

Replace the Task A3 stub with the production system message.

- [ ] **Step 1: Rewrite the file**

```ts
// src/lib/ai/prompts/hipaa-assess.ts
//
// Prompt: hipaa.assess.v1
//
// Given a practice's basic identifiers + a list of HIPAA requirement codes,
// return a best-guess (COMPLIANT | GAP | NOT_STARTED) status and a brief
// reason per requirement. Output validated by hipaaAssessOutputSchema.
// Never asks for PHI. Safety: an inbound suggestion cannot flip a
// requirement to COMPLIANT without a reason string >= 10 chars (enforced in
// runAiAssessmentAction before events are emitted).

import { z } from "zod";
import { REQUIREMENT_STATUS_VALUES } from "@/lib/events/registry";

export const hipaaAssessInputSchema = z.object({
  practiceName: z.string().min(1).max(200),
  primaryState: z.string().length(2),
  specialty: z.string().max(100).optional(),
  staffHeadcount: z.number().int().nonnegative().optional(),
  requirementCodes: z.array(z.string().min(1).max(100)).min(1).max(50),
});

const LIKELY_STATUS = z.enum(
  REQUIREMENT_STATUS_VALUES.filter(
    (v) => v === "COMPLIANT" || v === "GAP" || v === "NOT_STARTED",
  ) as unknown as ["COMPLIANT", "GAP", "NOT_STARTED"],
);

export const hipaaAssessOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      requirementCode: z.string().min(1),
      likelyStatus: LIKELY_STATUS,
      reason: z.string().min(10).max(500),
    }),
  ).min(1).max(50),
});

export type HipaaAssessInput = z.infer<typeof hipaaAssessInputSchema>;
export type HipaaAssessOutput = z.infer<typeof hipaaAssessOutputSchema>;

export const HIPAA_ASSESS_SYSTEM = `You are a HIPAA compliance analyst for GuardWell, a compliance platform for medical practices.

Given a small set of practice facts (name, state, specialty, staff headcount) and a list of HIPAA requirement codes, return a best-guess status for each requirement:
- COMPLIANT — likely already met given a typical practice of this size/specialty
- GAP — likely partially addressed but needs work
- NOT_STARTED — likely not addressed at all yet

Rules:
1. Use ONLY the requirement codes supplied in the input. Do NOT invent new codes.
2. Never output a duplicate requirementCode. If the input repeats one, include it only once.
3. Always provide a short (<= 500 chars), specific reason. Generic reasons like "Typical for small practices" are rejected.
4. Bias toward NOT_STARTED / GAP when unsure. A false COMPLIANT is worse than a false GAP.
5. Never request or repeat PHI. You receive none; do not ask for any.

Use the ${"hipaa_assess_v1"} tool to return your structured output. Do not return free-form text.`;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. If the typed `LIKELY_STATUS` cast is awkward, replace with:

```ts
const LIKELY_STATUS = z.enum(["COMPLIANT", "GAP", "NOT_STARTED"] as const);
```

### Task D2: Unit test: the prompt + output schema round-trip

**Files:**
- Create: `src/lib/ai/prompts/hipaa-assess.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/lib/ai/prompts/hipaa-assess.test.ts
import { describe, it, expect } from "vitest";
import {
  hipaaAssessInputSchema,
  hipaaAssessOutputSchema,
  HIPAA_ASSESS_SYSTEM,
} from "./hipaa-assess";

describe("hipaa.assess.v1 schemas", () => {
  it("inputSchema accepts a minimal valid practice", () => {
    expect(
      hipaaAssessInputSchema.parse({
        practiceName: "Test Clinic",
        primaryState: "AZ",
        requirementCodes: ["HIPAA_PRIVACY_OFFICER"],
      }),
    ).toBeTruthy();
  });

  it("inputSchema rejects 0 requirement codes", () => {
    expect(() =>
      hipaaAssessInputSchema.parse({
        practiceName: "X",
        primaryState: "AZ",
        requirementCodes: [],
      }),
    ).toThrow();
  });

  it("outputSchema rejects a reason shorter than 10 chars", () => {
    expect(() =>
      hipaaAssessOutputSchema.parse({
        suggestions: [
          { requirementCode: "A", likelyStatus: "GAP", reason: "nope" },
        ],
      }),
    ).toThrow();
  });

  it("outputSchema rejects unknown likelyStatus values", () => {
    expect(() =>
      hipaaAssessOutputSchema.parse({
        suggestions: [
          {
            requirementCode: "A",
            // @ts-expect-error invalid
            likelyStatus: "UNKNOWN",
            reason: "short reason 01",
          },
        ],
      }),
    ).toThrow();
  });

  it("system prompt references the tool by name and forbids free text", () => {
    expect(HIPAA_ASSESS_SYSTEM).toMatch(/hipaa_assess_v1/);
    expect(HIPAA_ASSESS_SYSTEM).toMatch(/tool/);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/prompts/hipaa-assess.test.ts
```

Expected: all 5 tests PASS. (`vitest.config.ts` `node` project includes `src/lib/**/*.test.ts`, so this file is picked up.)

### Task D3: Server action: `runAiAssessmentAction`

**Files:**
- Rewrite: `src/app/(dashboard)/modules/hipaa/assess/actions.ts`

If Task C4 created a stub, replace its contents.

- [ ] **Step 1: Write the action**

```ts
// src/app/(dashboard)/modules/hipaa/assess/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { runLlm } from "@/lib/ai";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";
import { assertAssessmentRateLimit } from "@/lib/ai/rateLimit";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

export async function runAiAssessmentAction() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");

  // Rate + cost guards (Task F1 + F2).
  await assertAssessmentRateLimit(pu.practiceId);
  await assertMonthlyCostBudget();

  const framework = await db.regulatoryFramework.findUnique({
    where: { code: "HIPAA" },
    include: { requirements: { orderBy: { sortOrder: "asc" } } },
  });
  if (!framework) {
    throw new Error("HIPAA framework is not seeded. Run `npm run db:seed`.");
  }
  const requirementsByCode = new Map(
    framework.requirements.map((r) => [r.code, r]),
  );

  const result = await runLlm(
    "hipaa.assess.v1",
    {
      practiceName: pu.practice.name,
      primaryState: pu.practice.primaryState,
      specialty: pu.practice.specialty ?? undefined,
      staffHeadcount: pu.practice.staffHeadcount ?? undefined,
      requirementCodes: framework.requirements.map((r) => r.code),
    },
    { practiceId: pu.practiceId, actorUserId: user.id },
  );

  // Dedup + drop codes the model hallucinated. Never trust the LLM to
  // produce known codes — filter against what we actually have.
  const seen = new Set<string>();
  let applied = 0;

  for (const s of result.output.suggestions) {
    if (seen.has(s.requirementCode)) continue;
    seen.add(s.requirementCode);
    const requirement = requirementsByCode.get(s.requirementCode);
    if (!requirement) continue;

    const existing = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: pu.practiceId,
          requirementId: requirement.id,
        },
      },
    });
    // Never let AI DOWNGRADE a human-asserted COMPLIANT. If the item is
    // already COMPLIANT and AI says NOT_STARTED, we skip. Upgrading from
    // NOT_STARTED -> COMPLIANT is allowed but logged as AI_ASSESSMENT.
    if (existing?.status === "COMPLIANT" && s.likelyStatus !== "COMPLIANT") {
      continue;
    }

    const previous =
      (existing?.status as
        | "NOT_STARTED"
        | "IN_PROGRESS"
        | "COMPLIANT"
        | "GAP"
        | "NOT_APPLICABLE"
        | undefined) ?? "NOT_STARTED";

    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: requirement.id,
          frameworkCode: "HIPAA",
          requirementCode: requirement.code,
          previousStatus: previous,
          nextStatus: s.likelyStatus,
          source: "AI_ASSESSMENT",
          reason: s.reason,
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: pu.practiceId,
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: requirement.code,
            previousStatus: previous,
            nextStatus: s.likelyStatus,
            source: "AI_ASSESSMENT",
            reason: s.reason,
          },
        }),
    );
    applied += 1;
  }

  revalidatePath("/modules/hipaa");
  return { applied, llmCallId: result.llmCallId };
}
```

Note: Tasks F1 and F2 create `assertAssessmentRateLimit` and `assertMonthlyCostBudget`. During Task D3 they don't exist yet — temporarily stub them with:

```ts
// src/lib/ai/rateLimit.ts (TEMP — Task F1 writes the real version)
export async function assertAssessmentRateLimit(_practiceId: string) {}

// src/lib/ai/costGuard.ts (TEMP — Task F2 writes the real version)
export async function assertMonthlyCostBudget() {}
```

These temporary bodies are replaced — not removed — in Chunk F.

### Task D4: Integration test for the AI assessment flow

**Files:**
- Create: `tests/integration/hipaa-assess.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/hipaa-assess.test.ts
//
// End-to-end: mocked Anthropic + real Prisma. Confirms that
// runAiAssessmentAction produces (1) a success LlmCall, (2) one
// REQUIREMENT_STATUS_UPDATED event per valid suggestion, (3) projected
// ComplianceItem rows, (4) filters hallucinated codes, (5) refuses to
// downgrade COMPLIANT.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { __resetAnthropicForTests } from "@/lib/ai/client";

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { create },
  }));
  return { default: Anthropic, Anthropic };
});

async function getMockedCreate() {
  const mod = await import("@anthropic-ai/sdk");
  const Ctor = (mod as unknown as { default: ReturnType<typeof vi.fn> }).default;
  const instance = new (Ctor as unknown as new () => {
    messages: { create: ReturnType<typeof vi.fn> };
  })();
  return instance.messages.create;
}

// We need to stub getCurrentUser / getPracticeUser because server actions
// read them. Easiest path: import the action's function directly and set
// up fixture data in DB, then mock the auth helpers.
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser: { id: string; email: string; firebaseUid: string } | null;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.__testUser = null;
  __resetAnthropicForTests();
});

async function seedHipaa() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Solo PCP", primaryState: "AZ", specialty: "Primary Care" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "Test fixture",
      jurisdiction: "federal",
    },
  });
  const a = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_PRIVACY_OFFICER" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_PRIVACY_OFFICER",
      title: "Privacy Officer",
      description: "test",
    },
  });
  const b = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_SRA" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_SRA",
      title: "SRA",
      description: "test",
    },
  });
  globalThis.__testUser = { id: user.id, email: user.email, firebaseUid: user.firebaseUid };
  return { user, practice, framework, requirements: [a, b] };
}

describe("runAiAssessmentAction (HIPAA)", () => {
  it("applies valid suggestions and writes events + projections", async () => {
    const { practice, requirements } = await seedHipaa();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_PRIVACY_OFFICER",
                likelyStatus: "NOT_STARTED",
                reason: "Solo practice; no officer documented.",
              },
              {
                requirementCode: "HIPAA_SRA",
                likelyStatus: "GAP",
                reason: "Likely partial SRA given the practice size.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 100 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();

    expect(result.applied).toBe(2);
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(2);

    const items = await db.complianceItem.findMany({
      where: { practiceId: practice.id },
    });
    expect(items.map((i) => i.status).sort()).toEqual(["GAP", "NOT_STARTED"]);
    expect(items.map((i) => i.requirementId).sort()).toEqual(
      requirements.map((r) => r.id).sort(),
    );

    const calls = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.success).toBe(true);
  });

  it("skips hallucinated requirement codes", async () => {
    const { practice } = await seedHipaa();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_NONEXISTENT",
                likelyStatus: "GAP",
                reason: "Made up by the model.",
              },
              {
                requirementCode: "HIPAA_SRA",
                likelyStatus: "GAP",
                reason: "Real code.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();
    expect(result.applied).toBe(1);

    const items = await db.complianceItem.findMany({
      where: { practiceId: practice.id },
    });
    expect(items).toHaveLength(1);
  });

  it("does NOT downgrade a human-asserted COMPLIANT requirement", async () => {
    const { practice, requirements } = await seedHipaa();

    // Pre-set HIPAA_PRIVACY_OFFICER to COMPLIANT by emitting a USER event.
    const { appendEventAndApply } = await import("@/lib/events");
    const { projectRequirementStatusUpdated } = await import(
      "@/lib/events/projections/requirementStatus"
    );
    const target = requirements.find((r) => r.code === "HIPAA_PRIVACY_OFFICER")!;
    await appendEventAndApply(
      {
        practiceId: practice.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: target.id,
          frameworkCode: "HIPAA",
          requirementCode: target.code,
          previousStatus: "NOT_STARTED",
          nextStatus: "COMPLIANT",
          source: "USER",
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: {
            requirementId: target.id,
            frameworkCode: "HIPAA",
            requirementCode: target.code,
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        }),
    );

    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "hipaa_assess_v1",
          input: {
            suggestions: [
              {
                requirementCode: "HIPAA_PRIVACY_OFFICER",
                likelyStatus: "NOT_STARTED", // would downgrade
                reason: "Model thinks they don't have one.",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 50 },
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
    });

    const { runAiAssessmentAction } = await import(
      "@/app/(dashboard)/modules/hipaa/assess/actions"
    );
    const result = await runAiAssessmentAction();
    expect(result.applied).toBe(0);

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: { practiceId: practice.id, requirementId: target.id },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node tests/integration/hipaa-assess.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Commit chunk D**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "$(cat <<'EOF'
feat(ai): hipaa.assess.v1 prompt + runAiAssessmentAction server action

- Full system message instructing the model to return tool output
- Input/output Zod schemas with min lengths + enum bounds
- Server action uses runLlm, filters hallucinated codes, refuses to
  downgrade human-asserted COMPLIANT, routes each accepted suggestion
  through appendEventAndApply as REQUIREMENT_STATUS_UPDATED with
  source=AI_ASSESSMENT
- 3 integration tests cover happy path, hallucination filter,
  downgrade guard
EOF
)"
```

---

## Chunk E — LLM eval harness (Day 5-6, ~4 hours)

### Task E1: Fixture for "typical solo primary-care practice in AZ"

**Files:**
- Create: `tests/fixtures/prompts/hipaa.assess.v1/solo-pcp-az.json`

- [ ] **Step 1: Write the fixture**

```json
{
  "name": "solo-pcp-az",
  "input": {
    "practiceName": "Desert Sky Primary Care",
    "primaryState": "AZ",
    "specialty": "Primary Care",
    "staffHeadcount": 3,
    "requirementCodes": [
      "HIPAA_PRIVACY_OFFICER",
      "HIPAA_SECURITY_OFFICER",
      "HIPAA_SRA",
      "HIPAA_POLICIES_PROCEDURES",
      "HIPAA_WORKFORCE_TRAINING",
      "HIPAA_BAAS",
      "HIPAA_MINIMUM_NECESSARY",
      "HIPAA_NPP",
      "HIPAA_BREACH_RESPONSE",
      "HIPAA_WORKSTATION_USE"
    ]
  },
  "assertions": {
    "minSuggestions": 10,
    "maxSuggestions": 10,
    "allCodesMustBeInInput": true,
    "noDuplicateCodes": true,
    "reasonMinChars": 10,
    "maxCompliantRatio": 0.5,
    "everyStatusAllowed": ["COMPLIANT", "GAP", "NOT_STARTED"]
  }
}
```

### Task E2: Eval harness script

**Files:**
- Create: `scripts/eval-prompts.ts`

Reads every fixture under `tests/fixtures/prompts/<promptId>/`, runs `runLlm(promptId, fixture.input)`, and applies the per-prompt assertions + the fixture's own assertions. Exits 0 on success, 1 on any failure.

- [ ] **Step 1: Write the harness**

```ts
// scripts/eval-prompts.ts
//
// Usage:
//   npm run eval:prompts
//
// Runs every fixture under tests/fixtures/prompts/<promptId>/*.json against
// its prompt via runLlm(). Assertions are either shared per-prompt (e.g.
// hipaa.assess.v1 rejects unknown codes) or fixture-scoped
// (fixture.assertions). Exits non-zero if any assertion fails.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env" });

import { runLlm } from "../src/lib/ai/runLlm";
import { PROMPTS, type PromptId } from "../src/lib/ai/registry";

type Fixture = {
  name: string;
  input: unknown;
  assertions?: {
    minSuggestions?: number;
    maxSuggestions?: number;
    allCodesMustBeInInput?: boolean;
    noDuplicateCodes?: boolean;
    reasonMinChars?: number;
    maxCompliantRatio?: number;
    everyStatusAllowed?: string[];
  };
};

async function runFixture(promptId: PromptId, fix: Fixture): Promise<string[]> {
  const errors: string[] = [];
  const result = await runLlm(promptId, fix.input as never);
  const out = result.output as {
    suggestions: Array<{ requirementCode: string; likelyStatus: string; reason: string }>;
  };

  // Shared assertions for hipaa.assess.v1:
  if (promptId === "hipaa.assess.v1") {
    const inputCodes = new Set(
      (fix.input as { requirementCodes: string[] }).requirementCodes,
    );
    const seen = new Set<string>();
    for (const s of out.suggestions) {
      if (!inputCodes.has(s.requirementCode)) {
        errors.push(`[${fix.name}] hallucinated code: ${s.requirementCode}`);
      }
      if (seen.has(s.requirementCode)) {
        errors.push(`[${fix.name}] duplicate code: ${s.requirementCode}`);
      }
      seen.add(s.requirementCode);
    }
  }

  // Fixture assertions:
  const a = fix.assertions ?? {};
  if (typeof a.minSuggestions === "number" && out.suggestions.length < a.minSuggestions) {
    errors.push(
      `[${fix.name}] expected >= ${a.minSuggestions} suggestions, got ${out.suggestions.length}`,
    );
  }
  if (typeof a.maxSuggestions === "number" && out.suggestions.length > a.maxSuggestions) {
    errors.push(
      `[${fix.name}] expected <= ${a.maxSuggestions} suggestions, got ${out.suggestions.length}`,
    );
  }
  if (typeof a.reasonMinChars === "number") {
    for (const s of out.suggestions) {
      if (s.reason.length < a.reasonMinChars) {
        errors.push(`[${fix.name}] reason too short for ${s.requirementCode}: "${s.reason}"`);
      }
    }
  }
  if (a.everyStatusAllowed) {
    for (const s of out.suggestions) {
      if (!a.everyStatusAllowed.includes(s.likelyStatus)) {
        errors.push(
          `[${fix.name}] disallowed status ${s.likelyStatus} for ${s.requirementCode}`,
        );
      }
    }
  }
  if (typeof a.maxCompliantRatio === "number") {
    const compliant = out.suggestions.filter((s) => s.likelyStatus === "COMPLIANT").length;
    const ratio = compliant / out.suggestions.length;
    if (ratio > a.maxCompliantRatio) {
      errors.push(
        `[${fix.name}] too many COMPLIANT (${ratio.toFixed(2)} > ${a.maxCompliantRatio})`,
      );
    }
  }
  if (a.noDuplicateCodes) {
    const codes = new Set<string>();
    for (const s of out.suggestions) {
      if (codes.has(s.requirementCode)) {
        errors.push(`[${fix.name}] duplicate code: ${s.requirementCode}`);
      }
      codes.add(s.requirementCode);
    }
  }

  return errors;
}

async function main() {
  const root = path.join(process.cwd(), "tests", "fixtures", "prompts");
  const allErrors: string[] = [];
  let totalFixtures = 0;

  for (const promptId of Object.keys(PROMPTS) as PromptId[]) {
    const dir = path.join(root, promptId);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      console.log(`[eval] no fixtures for ${promptId} (skipping)`);
      continue;
    }
    for (const file of files) {
      totalFixtures += 1;
      const raw = readFileSync(path.join(dir, file), "utf8");
      const fix = JSON.parse(raw) as Fixture;
      process.stdout.write(`[eval] ${promptId} > ${fix.name} ... `);
      try {
        const errors = await runFixture(promptId, fix);
        if (errors.length === 0) {
          process.stdout.write("PASS\n");
        } else {
          process.stdout.write("FAIL\n");
          for (const e of errors) console.log(`       ${e}`);
          allErrors.push(...errors);
        }
      } catch (err) {
        process.stdout.write("ERROR\n");
        allErrors.push(`[${fix.name}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n[eval] ran ${totalFixtures} fixture(s); ${allErrors.length} error(s).`);
  process.exitCode = allErrors.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run against the real Anthropic API once**

Requires `ANTHROPIC_API_KEY` in `.env`.

```bash
cd "D:/GuardWell/guardwell-v2" && npm run eval:prompts
```

Expected: one line `[eval] hipaa.assess.v1 > solo-pcp-az ... PASS`, final summary `ran 1 fixture(s); 0 error(s).`, exit 0. If the model violates `maxCompliantRatio` (>50% COMPLIANT), either the prompt is under-specified or the fixture bar is too strict — prefer tightening the system message first.

- [ ] **Step 3: Commit chunk E**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(eval): scripts/eval-prompts.ts + solo-pcp-az fixture for hipaa.assess.v1"
```

---

## Chunk F — Rate limiting + cost guard (Day 6-7, ~4 hours)

### Task F1: Upstash rate limiter per practice per 24h

**Files:**
- Rewrite: `src/lib/ai/rateLimit.ts`
- Create: `src/lib/ai/__tests__/rateLimit.test.ts`

Upstash Redis is already a dep. In tests we bypass the real HTTP call by respecting an env var `UPSTASH_DISABLE=1`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/rateLimit.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow(_max: number, _window: string) {
      return { max: _max, window: _window };
    }
    limit = vi.fn();
  }
  return { Ratelimit: MockRatelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    static fromEnv() {
      return new Redis();
    }
  }
  return { Redis };
});

describe("assertAssessmentRateLimit", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.UPSTASH_DISABLE = "";
    vi.resetModules();
  });

  it("passes through when UPSTASH_DISABLE=1 (test default)", async () => {
    process.env.UPSTASH_DISABLE = "1";
    const { assertAssessmentRateLimit } = await import("@/lib/ai/rateLimit");
    await expect(assertAssessmentRateLimit("prac_1")).resolves.toBeUndefined();
  });

  it("throws RATE_LIMITED when the ratelimiter says not success", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as { new (): { limit: ReturnType<typeof vi.fn> } })();
    inst.limit.mockResolvedValueOnce({ success: false, reset: Date.now() + 86400_000 });
    const { __setRatelimiterForTests, assertAssessmentRateLimit } = await import(
      "@/lib/ai/rateLimit"
    );
    __setRatelimiterForTests(inst as unknown as { limit: (k: string) => Promise<{ success: boolean; reset: number }> });
    await expect(assertAssessmentRateLimit("prac_rl")).rejects.toThrow(/RATE_LIMITED/);
  });

  it("does NOT throw when success=true", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as { new (): { limit: ReturnType<typeof vi.fn> } })();
    inst.limit.mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 });
    const { __setRatelimiterForTests, assertAssessmentRateLimit } = await import(
      "@/lib/ai/rateLimit"
    );
    __setRatelimiterForTests(inst as unknown as { limit: (k: string) => Promise<{ success: boolean; reset: number }> });
    await expect(assertAssessmentRateLimit("prac_ok")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → expect RED**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/rateLimit.test.ts
```

Expected: failures — `@/lib/ai/rateLimit` exists only as the stub from Task D3.

- [ ] **Step 3: Write the real `src/lib/ai/rateLimit.ts`**

```ts
// src/lib/ai/rateLimit.ts
//
// 1 AI assessment per practice per 24h. Upstash Redis sliding window. In
// tests we inject a fake ratelimiter via __setRatelimiterForTests; in
// production the `@upstash/*` libs read config from env.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface Limiter {
  limit(key: string): Promise<{ success: boolean; reset: number }>;
}

let limiter: Limiter | null = null;

function getLimiter(): Limiter {
  if (limiter) return limiter;
  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(1, "24 h"),
    prefix: "gw:ai:assess",
  }) as unknown as Limiter;
  return limiter;
}

export function __setRatelimiterForTests(next: Limiter | null): void {
  limiter = next;
}

/** Throws RATE_LIMITED if the practice already ran an assessment in the
 *  last 24h. Soft-skip when UPSTASH_DISABLE=1 (CI / unit tests). */
export async function assertAssessmentRateLimit(practiceId: string): Promise<void> {
  if (process.env.UPSTASH_DISABLE === "1") return;
  const res = await getLimiter().limit(practiceId);
  if (!res.success) {
    const resetAt = new Date(res.reset).toISOString();
    throw new Error(`RATE_LIMITED: next allowed after ${resetAt}`);
  }
}
```

- [ ] **Step 4: Run → expect GREEN**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/rateLimit.test.ts
```

Expected: 3 tests PASS.

### Task F2: Monthly cost guard

**Files:**
- Rewrite: `src/lib/ai/costGuard.ts`
- Create: `src/lib/ai/__tests__/costGuard.test.ts`

Budget is driven by env var `LLM_MONTHLY_BUDGET_USD`. `assertMonthlyCostBudget` sums `LlmCall.costUsd` for the current calendar month and throws `COST_BUDGET_EXCEEDED` if the sum >= budget.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/costGuard.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

async function seedPractice() {
  const practice = await db.practice.create({
    data: { name: "Test", primaryState: "AZ" },
  });
  return practice;
}

beforeEach(() => {
  process.env.LLM_MONTHLY_BUDGET_USD = "10";
});

describe("assertMonthlyCostBudget", () => {
  it("passes when total month cost < budget", async () => {
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 2 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });

  it("throws COST_BUDGET_EXCEEDED when month cost >= budget", async () => {
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 10.5 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).rejects.toThrow(/COST_BUDGET_EXCEEDED/);
  });

  it("ignores LlmCall rows from prior months", async () => {
    const p = await seedPractice();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 50 as unknown as null,
        createdAt: lastMonth,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });

  it("passes through when LLM_MONTHLY_BUDGET_USD is unset", async () => {
    delete process.env.LLM_MONTHLY_BUDGET_USD;
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 9999 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → expect RED**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/costGuard.test.ts
```

Expected: failures — `costGuard.ts` is still the Task D3 stub.

- [ ] **Step 3: Write the real `src/lib/ai/costGuard.ts`**

```ts
// src/lib/ai/costGuard.ts
//
// Monthly cost ceiling. Reads LLM_MONTHLY_BUDGET_USD (USD, string). If
// unset or zero, the guard is disabled. Sums LlmCall.costUsd across the
// current calendar month (server time) and refuses new calls once the
// total meets or exceeds the budget.

import { db } from "@/lib/db";

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}

export async function assertMonthlyCostBudget(): Promise<void> {
  const budgetRaw = process.env.LLM_MONTHLY_BUDGET_USD;
  if (!budgetRaw) return;
  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget) || budget <= 0) return;

  const since = startOfMonthUtc();
  const rows = await db.llmCall.findMany({
    where: { createdAt: { gte: since }, costUsd: { not: null } },
    select: { costUsd: true },
  });
  const total = rows.reduce(
    (sum, r) => sum + Number((r.costUsd as unknown as number) ?? 0),
    0,
  );
  if (total >= budget) {
    throw new Error(
      `COST_BUDGET_EXCEEDED: $${total.toFixed(2)} used this month (budget $${budget.toFixed(2)})`,
    );
  }
}
```

- [ ] **Step 4: Run → expect GREEN**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/ai/__tests__/costGuard.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit chunk F**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "$(cat <<'EOF'
feat(ai): Upstash rate limiter (1/24h per practice) + monthly cost guard

- assertAssessmentRateLimit uses @upstash/ratelimit sliding window with
  UPSTASH_DISABLE env short-circuit for tests
- assertMonthlyCostBudget sums current-month LlmCall.costUsd and throws
  COST_BUDGET_EXCEEDED once LLM_MONTHLY_BUDGET_USD is hit
- Both tested with mocked Upstash / real Prisma
EOF
)"
```

---

## Chunk G — AiAssistDrawer real wiring (Day 7-8, ~4 hours)

### Task G1: Add `assistant.page-help.v1` prompt

**Files:**
- Create: `src/lib/ai/prompts/assistant-page-help.ts`
- Modify: `src/lib/ai/registry.ts` (register the new prompt)

- [ ] **Step 1: Write `src/lib/ai/prompts/assistant-page-help.ts`**

```ts
// src/lib/ai/prompts/assistant-page-help.ts
//
// Ambient AI Concierge. Takes a page route + open-ended question, returns
// a concise markdown-safe answer <= 800 chars. No tool use beyond the
// answer shape so the caller can show it inline in the drawer body.

import { z } from "zod";

export const pageHelpInputSchema = z.object({
  route: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  question: z.string().min(1).max(1000),
});

export const pageHelpOutputSchema = z.object({
  answer: z.string().min(1).max(800),
  suggestNextAction: z
    .object({
      label: z.string().min(1).max(60),
      href: z.string().min(1).max(200),
    })
    .optional(),
});

export type PageHelpInput = z.infer<typeof pageHelpInputSchema>;
export type PageHelpOutput = z.infer<typeof pageHelpOutputSchema>;

export const PAGE_HELP_SYSTEM = `You are the GuardWell AI Concierge. Answer the user's question about their current page succinctly.

Rules:
1. Answer in <= 800 characters. Prefer 2-4 short sentences or a 2-5 item list.
2. Never claim legal certainty. Use phrases like "typically", "most covered entities", etc.
3. Never request or echo back PHI.
4. If the best next action is an in-product link, include suggestNextAction pointing at a same-origin path (e.g., /modules/hipaa).
5. Use the assistant_page_help_v1 tool to return structured output. Do not return free-form text.`;
```

- [ ] **Step 2: Register in `src/lib/ai/registry.ts`**

Add the import + an entry to `PROMPTS`:

```ts
// add near the top:
import {
  PAGE_HELP_SYSTEM,
  pageHelpInputSchema,
  pageHelpOutputSchema,
} from "./prompts/assistant-page-help";

// inside `PROMPTS = { ... }` object, add:
  "assistant.page-help.v1": {
    id: "assistant.page-help.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: PAGE_HELP_SYSTEM,
    inputSchema: pageHelpInputSchema,
    outputSchema: pageHelpOutputSchema,
    toolName: "assistant_page_help_v1",
    toolDescription: "Return a concise markdown-safe answer and optional in-product next-action link.",
    maxTokens: 1024,
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors.

### Task G2: Rewrite `<AiAssistDrawer>` to use a real server action

**Files:**
- Rewrite: `src/components/gw/AiAssistDrawer/index.tsx`
- Modify: `src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx` (the old "disabled textarea" test needs to change)
- Create: `src/components/gw/AiAssistDrawer/actions.ts`

- [ ] **Step 1: Write the server action**

```ts
// src/components/gw/AiAssistDrawer/actions.ts
"use server";

import { z } from "zod";
import { getPracticeUser } from "@/lib/rbac";
import { runLlm } from "@/lib/ai";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

const Input = z.object({
  route: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  question: z.string().min(1).max(1000),
});

export type AskAiResult =
  | { ok: true; answer: string; suggestNextAction?: { label: string; href: string } }
  | { ok: false; error: string };

export async function askAiAssistantAction(input: z.infer<typeof Input>): Promise<AskAiResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Unauthorized" };
  try {
    await assertMonthlyCostBudget();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "cost guard" };
  }

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INPUT_SCHEMA" };

  try {
    const res = await runLlm("assistant.page-help.v1", parsed.data, {
      practiceId: pu.practiceId,
      actorUserId: pu.userId,
    });
    return {
      ok: true,
      answer: res.output.answer,
      suggestNextAction: res.output.suggestNextAction,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
```

- [ ] **Step 2: Rewrite `src/components/gw/AiAssistDrawer/index.tsx`**

```tsx
// src/components/gw/AiAssistDrawer/index.tsx
"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { askAiAssistantAction, type AskAiResult } from "./actions";

export interface AiAssistPageContext {
  route: string;
  summary?: string;
  practiceId?: string;
}

export interface AiAssistDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageContext: AiAssistPageContext;
  className?: string;
  /** Test-only: inject a fake action so component tests don't hit the server. */
  __actionForTests?: (input: {
    route: string;
    summary?: string;
    question: string;
  }) => Promise<AskAiResult>;
}

export function AiAssistDrawer({
  open,
  onOpenChange,
  pageContext,
  className,
  __actionForTests,
}: AiAssistDrawerProps) {
  const greeting = pageContext.summary ?? "this page";
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAiResult | null>(null);
  const [pending, start] = useTransition();

  const ask = __actionForTests ?? askAiAssistantAction;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAnswer(null);
    start(async () => {
      const res = await ask({
        route: pageContext.route,
        summary: pageContext.summary,
        question,
      });
      setAnswer(res);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("flex w-full flex-col sm:max-w-md", className)}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI Concierge
          </SheetTitle>
          <SheetDescription>Context-aware help for the current page.</SheetDescription>
          <div className="pt-1">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {pageContext.route}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
            I can see you&apos;re on <span className="font-medium">{greeting}</span>. What would you like help with?
          </div>
          {answer?.ok === true && (
            <div className="mt-4 rounded-lg border bg-background p-3 text-sm">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.suggestNextAction && (
                <a
                  href={answer.suggestNextAction.href}
                  className="mt-2 inline-flex text-xs underline underline-offset-2"
                >
                  {answer.suggestNextAction.label}
                </a>
              )}
            </div>
          )}
          {answer?.ok === false && (
            <p className="mt-4 text-xs text-[color:var(--gw-color-risk)]">
              {answer.error}
            </p>
          )}
        </div>

        <SheetFooter asChild>
          <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t pt-3">
            <label htmlFor="ai-assist-input" className="sr-only">
              Ask the AI Concierge
            </label>
            <textarea
              id="ai-assist-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this page…"
              rows={2}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !question.trim()} className="w-full">
              {pending ? "Asking…" : "Send"}
            </Button>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Update the existing component tests**

Open `src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx`. The weeks 3-4 test asserted the textarea is disabled. Replace that single test with two new ones:

Replace this block:

```tsx
  it("renders the 'Coming in week 5' stub in the footer with a disabled textarea", () => {
    ...
  });
```

with:

```tsx
  it("enables the textarea and send button when open", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    // Send is disabled ONLY because the textarea is empty — not permanently.
  });

  it("submits the question through __actionForTests and shows the answer", async () => {
    const user = userEvent.setup();
    const fake = vi.fn().mockResolvedValueOnce({
      ok: true,
      answer: "Designate one workforce member in writing.",
    });
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/modules/hipaa", summary: "HIPAA module" }}
        __actionForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "Who should be the Privacy Officer?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(fake).toHaveBeenCalledWith({
      route: "/modules/hipaa",
      summary: "HIPAA module",
      question: "Who should be the Privacy Officer?",
    });
    // The answer appears after the transition resolves.
    expect(await screen.findByText(/Designate one workforce member/)).toBeInTheDocument();
  });

  it("shows an error message when the action returns ok=false", async () => {
    const user = userEvent.setup();
    const fake = vi.fn().mockResolvedValueOnce({ ok: false, error: "RATE_LIMITED: retry in 24h" });
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
        __actionForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "Hello?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/RATE_LIMITED/)).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the component tests**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/AiAssistDrawer
```

Expected: all tests PASS (the 7 existing + 3 new = 10).

### Task G3: Integration test for the assistant server action

**Files:**
- Create: `tests/integration/ai-assist.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/ai-assist.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { __resetAnthropicForTests } from "@/lib/ai/client";

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { create },
  }));
  return { default: Anthropic, Anthropic };
});

async function getMockedCreate() {
  const mod = await import("@anthropic-ai/sdk");
  const Ctor = (mod as unknown as { default: ReturnType<typeof vi.fn> }).default;
  const instance = new (Ctor as unknown as new () => {
    messages: { create: ReturnType<typeof vi.fn> };
  })();
  return instance.messages.create;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser: { id: string; email: string; firebaseUid: string } | null;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.__testUser = null;
  __resetAnthropicForTests();
});

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  globalThis.__testUser = { id: user.id, email: user.email, firebaseUid: user.firebaseUid };
  return { user, practice };
}

describe("askAiAssistantAction", () => {
  it("returns ok:true with the model's answer", async () => {
    const { practice } = await seed();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "assistant_page_help_v1",
          input: {
            answer: "Typically the owner or clinic manager signs the designation.",
          },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
    });

    const { askAiAssistantAction } = await import(
      "@/components/gw/AiAssistDrawer/actions"
    );
    const res = await askAiAssistantAction({
      route: "/modules/hipaa",
      summary: "HIPAA module",
      question: "Who signs the Privacy Officer designation?",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.answer).toMatch(/designation/);
    }

    const calls = await db.llmCall.findMany({ where: { practiceId: practice.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.promptId).toBe("assistant.page-help.v1");
  });

  it("returns ok:false on output schema violation (answer > 800 chars)", async () => {
    await seed();
    const create = await getMockedCreate();
    create.mockResolvedValueOnce({
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "assistant_page_help_v1",
          input: { answer: "x".repeat(2000) },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 400 },
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
    });

    const { askAiAssistantAction } = await import(
      "@/components/gw/AiAssistDrawer/actions"
    );
    const res = await askAiAssistantAction({
      route: "/modules/hipaa",
      question: "ask me anything",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/OUTPUT_SCHEMA/);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node tests/integration/ai-assist.test.ts
```

Expected: both tests PASS.

- [ ] **Step 3: Commit chunk G**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "$(cat <<'EOF'
feat(ai): wire AiAssistDrawer to assistant.page-help.v1 via askAiAssistantAction

- New prompt registered with z.infer typed input/output schemas
- Drawer is a controlled form: user types, action round-trips through
  runLlm, structured answer + optional next-action link render inline
- Updated 10 component tests (including 3 new interactive cases) + 2
  integration tests covering success and output-schema-violation
EOF
)"
```

---

## Chunk H — Deploy + smoke (Day 8-9, ~3 hours)

### Task H1: Add `ANTHROPIC_API_KEY` to Secret Manager

- [ ] **Step 1: Create the secret**

```bash
gcloud secrets create anthropic-api-key \
  --replication-policy=automatic \
  --project=guardwell-prod
```

- [ ] **Step 2: Add a version with the actual key**

```bash
printf "%s" "$ANTHROPIC_KEY" | gcloud secrets versions add anthropic-api-key --data-file=- --project=guardwell-prod
```

(Set `$ANTHROPIC_KEY` in your local shell, do not commit it.)

- [ ] **Step 3: Grant Cloud Run runtime SA access**

```bash
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member=serviceAccount:guardwell-v2-runtime@guardwell-prod.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor \
  --project=guardwell-prod
```

### Task H2: Provision Upstash Redis

Upstash is a separate SaaS.

- [ ] **Step 1: Create a Redis DB**

1. Visit https://console.upstash.com/redis and create a new DB named `guardwell-v2` in the `us-east-1` (or `us-central1`-closest) region.
2. Note the `REST URL` and `REST Token` from the DB details page.

- [ ] **Step 2: Put them into Secret Manager**

```bash
printf "%s" "$UPSTASH_URL" | gcloud secrets create upstash-redis-url --data-file=- --replication-policy=automatic --project=guardwell-prod
printf "%s" "$UPSTASH_TOKEN" | gcloud secrets create upstash-redis-token --data-file=- --replication-policy=automatic --project=guardwell-prod

gcloud secrets add-iam-policy-binding upstash-redis-url \
  --member=serviceAccount:guardwell-v2-runtime@guardwell-prod.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor --project=guardwell-prod
gcloud secrets add-iam-policy-binding upstash-redis-token \
  --member=serviceAccount:guardwell-v2-runtime@guardwell-prod.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor --project=guardwell-prod
```

### Task H3: Update Cloud Run env

- [ ] **Step 1: Update the service**

```bash
gcloud run services update guardwell-v2 \
  --region=us-central1 \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --set-secrets=UPSTASH_REDIS_REST_URL=upstash-redis-url:latest \
  --set-secrets=UPSTASH_REDIS_REST_TOKEN=upstash-redis-token:latest \
  --update-env-vars=LLM_MONTHLY_BUDGET_USD=200,UPSTASH_DISABLE=
```

### Task H4: Ship + smoke test on `v2.app.gwcomp.com`

- [ ] **Step 1: Push**

```bash
cd "D:/GuardWell/guardwell-v2" && git push origin main
```

Expected: Cloud Build picks it up; watch at https://console.cloud.google.com/cloud-build/builds.

- [ ] **Step 2: Wait for the deploy**

```bash
gcloud builds list --limit=3 --project=guardwell-prod
```

Expected: latest build STATUS=SUCCESS.

- [ ] **Step 3: Run the seed against the prod DB (idempotent)**

The seed is safe to run against the existing Cloud SQL instance — it upserts. Run it through the proxy the same way you ran it locally:

```bash
cd "D:/GuardWell/guardwell-v2" && npm run db:seed:hipaa
```

(The Cloud SQL proxy from weeks 1-2 is still pointing at the same DB, so the DATABASE_URL in `.env` works.)

- [ ] **Step 4: Manual smoke on https://v2.app.gwcomp.com**

1. Sign in.
2. Visit `/modules` — one card ("HIPAA ...") renders.
3. Click through to `/modules/hipaa` — 10 `<ChecklistItem>` rows render with `not_started` status.
4. Change one requirement to `Compliant` — UI reflects immediately; refresh — still compliant.
5. Click "Run AI assessment" — button shows "Running…", then `/modules/hipaa` re-renders with populated statuses (and your manually-set one is preserved, per the downgrade guard).
6. Open `<AiAssistDrawer>` (trigger button on dashboard, or wherever it's mounted) — type "Who should be the Privacy Officer?" → answer renders inline in < 10 seconds.

- [ ] **Step 5: Verify LlmCall observability in prod**

```bash
cd "D:/GuardWell/guardwell-v2" && npx prisma studio
```

Check `LlmCall` — at least 2 rows: one `hipaa.assess.v1` success, one `assistant.page-help.v1` success. Both with nonzero `costUsd`.

- [ ] **Step 6: Second-run idempotency check on the AI button**

Click "Run AI assessment" again in the UI. Expected: a flash error "RATE_LIMITED: next allowed after <ISO>". After 24h the rate limit rolls off and it runs again.

- [ ] **Step 7: Final milestone commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git commit --allow-empty -m "$(cat <<'EOF'
milestone(v2): weeks 5-6 shipped — LLM ops + HIPAA module live on v2.app.gwcomp.com

- src/lib/ai/ with prompt registry, runLlm wrapper, Zod output validation,
  tool-use structured outputs, LlmCall observability
- HIPAA seeded as RegulatoryFramework + 10 requirements (modules-as-data)
- /modules + /modules/[code] pages compose gw/ components over
  event-sourced ComplianceItem projections
- REQUIREMENT_STATUS_UPDATED event + projection
- AI assessment flow end-to-end: button -> runLlm -> events -> projection
- Upstash rate limit + monthly cost guard enforced
- AiAssistDrawer wired to real server action with assistant.page-help.v1
- Eval harness + 1 fixture; LlmCall rows observable in prod
EOF
)"
```

---

## Self-review checklist

- [ ] All 8 chunks have committed checkpoints — yes
- [ ] Every task that creates code shows the actual code — yes
- [ ] No placeholders (`// TODO`, "similar to", "add validation") — scanned clean
- [ ] TDD pattern for every testable unit: `runLlm`, `assertAssessmentRateLimit`, `assertMonthlyCostBudget`, `REQUIREMENT_STATUS_UPDATED` projection, AiAssistDrawer interactive flow — yes
- [ ] Every `runLlm` call (success + 4 failure modes) writes an `LlmCall` row — covered in Task A4 tests
- [ ] Zod output-schema validation runs BEFORE output reaches the caller — yes (Task A4 Step 4)
- [ ] Every projection mutation goes through `appendEventAndApply` — the only new projection path is `projectRequirementStatusUpdated`, which is only called from within the `appendEventAndApply` callback in `updateRequirementStatusAction` and `runAiAssessmentAction`. Lint rule `no-direct-projection-mutation` still covers this (the projection file lives under `src/lib/events/`).
- [ ] No new projection tables added this sprint → `PROJECTION_TABLES` in the ESLint rule stays unchanged (still `complianceItem`, `practiceFramework`, `complianceScoreSnapshot`).
- [ ] Prompt ids are namespaced (`hipaa.assess.v1`, `assistant.page-help.v1`) with derived `toolName` matching Anthropic's `^[a-zA-Z0-9_-]{1,64}$` constraint — yes
- [ ] Naming consistency across tasks — `hipaa.assess.v1` ↔ `hipaa_assess_v1` tool name, `assistant.page-help.v1` ↔ `assistant_page_help_v1` tool name, `REQUIREMENT_STATUS_UPDATED` used everywhere the event name appears
- [ ] File paths match the locked File Structure block — spot-checked
- [ ] Fixture folder (`tests/fixtures/prompts/<id>/`) naming matches `scripts/eval-prompts.ts` traversal
- [ ] Deploy chunk reuses weeks 1-2 service account + trigger — no new GCP artifacts besides 3 secrets

## What's intentionally NOT in weeks 5-6

- Additional regulatory frameworks (OSHA, OIG, CMS, DEA, CLIA, MACRA, TCPA) — weeks 7-10 (each is an additional `scripts/seed-<code>.ts` per ADR-0004, no platform code change)
- Evidence upload flows (file storage + MIME validation + linking to ComplianceItems) — weeks 9-10
- Audit report generation — weeks 12-14
- User invite / multi-user practice flow (bulk invites, acceptance workflow) — weeks 9-10
- Stripe billing wiring — weeks 15-16
- Streaming LLM responses in `<AiAssistDrawer>` — the v1 UX is request/response; streaming is a weeks-12+ polish
- PHI redaction step (`redactPHI`) — deferred until the first prompt that actually accepts user-typed clinical text; none of the weeks 5-6 prompts do
- Automated prompt regression tests in CI — `npm run eval:prompts` is a manual / cron-triggered script for now; CI hook is a weeks-7-10 addition once more prompts exist

## Execution handoff

Plan complete and saved to `docs/plans/weeks-5-6-llm-ops-first-module.md`. Recommended execution:

**Subagent-driven (per weeks 1-2 / 3-4 pattern)** — dispatch one subagent per chunk. Chunks A (LLM ops) and D (AI flow) are the tightest coupling points and benefit from a fresh agent reading ADR-0003 at the start. Chunks B (seed), C (module page), E (eval harness), F (rate limit / cost), G (drawer wiring), H (deploy) can each run independently after A + C are green.

Or **inline** via `superpowers:executing-plans` — fine for A → B → C → D → E → F → G; pause for manual cloud steps in H.
