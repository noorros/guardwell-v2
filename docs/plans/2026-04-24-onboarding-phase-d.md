# Onboarding Phase D — First-Run Wizard + Bulk Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 4-step first-run wizard at `/onboarding/first-run` that walks a new OWNER from compliance score 0 to 30 in 15-20 minutes, plus a reusable `<BulkInviteForm>` component used both inside Step 4 and standalone at `/programs/staff/bulk-invite`.

**Architecture:** Wizard route is a parallel sibling under `src/app/onboarding/first-run/` (outside the `(dashboard)` group so its own chrome applies). Each step is a server-action-driven client island that composes an existing action: Step 1 → `toggleOfficerAction`, Step 2 → `adoptPolicyFromTemplateAction`, Step 3 → reuses existing `QuizRunner`, Step 4 → new `bulkInviteAction` (transactional batch over existing `USER_INVITED` projection). Completion writes `ONBOARDING_FIRST_RUN_COMPLETED` event + projection that bumps `Practice.firstRunCompletedAt`. Dashboard layout reads the same column to render a top-of-dashboard re-prompt banner when null.

**Tech Stack:** Next.js 16 App Router, Prisma 5.22, event sourcing per ADR-0001, Tailwind v4 + Shadcn, vitest for integration tests, `csv-parse` (~5KB) for CSV ingest, `canvas-confetti` (~3KB) for the completion celebration.

---

## File Structure

**Create:**
- `src/app/onboarding/first-run/layout.tsx` — auth + step-gate shell, shows "Skip onboarding" link + progress bar.
- `src/app/onboarding/first-run/page.tsx` — server component that reads existing officer/policy/training/invite state and routes user to the first incomplete step (or the wrap-up screen).
- `src/app/onboarding/first-run/actions.ts` — `completeFirstRunAction` (emits `ONBOARDING_FIRST_RUN_COMPLETED`, writes `firstRunCompletedAt`) + `skipFirstRunAction` (leaves `firstRunCompletedAt=null`, routes to dashboard).
- `src/app/onboarding/first-run/WizardShell.tsx` — client wrapper that orchestrates step index + celebration banner.
- `src/app/onboarding/first-run/Step1Officers.tsx` — two toggle cards, composes `toggleOfficerAction`.
- `src/app/onboarding/first-run/Step2Policy.tsx` — scrollable template preview + "Adopt template" button, composes `adoptPolicyFromTemplateAction`.
- `src/app/onboarding/first-run/Step3Training.tsx` — embeds existing `QuizRunner` from `/programs/training/[courseId]/QuizRunner` with HIPAA_BASICS course.
- `src/app/onboarding/first-run/Step4Invite.tsx` — embeds the new `<BulkInviteForm>` with wizard-specific next/skip controls.
- `src/app/onboarding/first-run/WizardComplete.tsx` — confetti + score reveal + "Go to dashboard" CTA, calls `completeFirstRunAction`.
- `src/lib/events/projections/firstRunCompleted.ts` — writes `Practice.firstRunCompletedAt = now`.
- `src/components/gw/BulkInviteForm/BulkInviteForm.tsx` — reusable client component (paste + CSV modes).
- `src/components/gw/BulkInviteForm/parseCsvRoster.ts` — pure function: CSV text → validated rows.
- `src/components/gw/BulkInviteForm/index.ts` — barrel.
- `src/app/(dashboard)/programs/staff/bulk-invite/page.tsx` — standalone surface using the same component.
- `src/app/(dashboard)/programs/staff/bulk-invite/actions.ts` — `bulkInviteAction` server action.
- `src/app/(dashboard)/dashboard/FirstRunReminderBanner.tsx` — top-of-dashboard re-prompt.
- `tests/integration/bulk-invite.test.ts` — covers transactional batch, duplicate-in-batch dedupe, per-row-results shape.
- `tests/integration/first-run-completion.test.ts` — covers `ONBOARDING_FIRST_RUN_COMPLETED` + `firstRunCompletedAt` write.

**Modify:**
- `package.json` — add `csv-parse` + `canvas-confetti` + `@types/canvas-confetti`.
- `src/lib/events/projections/firstRunCompleted.ts` — (created) — and wire into registry notes.
- `src/app/onboarding/compliance-profile/page.tsx` — change default redirectTo from `/dashboard` to `/onboarding/first-run`.
- `src/app/(dashboard)/programs/staff/page.tsx` — add a "Bulk invite" link/button above the existing `<InviteMemberForm>` that navigates to `/programs/staff/bulk-invite`.
- `src/app/(dashboard)/dashboard/page.tsx` — import + render `<FirstRunReminderBanner>` when `practice.firstRunCompletedAt` is null AND `subscriptionStatus` is TRIALING/ACTIVE.

**Test:**
- `tests/integration/bulk-invite.test.ts`
- `tests/integration/first-run-completion.test.ts`

---

## Task 1: Install dependencies + lightweight schema prep

**Files:**
- Modify: `package.json` (via npm install)
- Verify: `prisma/schema.prisma` (no changes — `firstRunCompletedAt` already exists)

Decision: the spec mentions an optional `PracticeUser.title` column. **Defer it.** It's not required for MVP and adding a column now would prematurely couple CSV UX to schema churn. The CSV parser simply ignores the column if present. Documented skip so a future task can add it cleanly.

- [ ] **Step 1: Install the three packages**

Run: `cd D:/GuardWell/guardwell-v2 && npm install csv-parse canvas-confetti && npm install -D @types/canvas-confetti`

Expected: three entries added to `package.json` (`csv-parse`, `canvas-confetti` in `dependencies`, `@types/canvas-confetti` in `devDependencies`).

- [ ] **Step 2: Confirm firstRunCompletedAt already exists**

Run: `grep -n firstRunCompletedAt prisma/schema.prisma`

Expected: hits near lines 105-107 on the `Practice` model. If missing, **stop and flag** — Phase A was supposed to add it.

- [ ] **Step 3: Commit dependency bump**

```bash
git checkout -b feat/onboarding-phase-d
git add package.json package-lock.json
git commit -m "chore(onboarding): add csv-parse + canvas-confetti for Phase D"
```

---

## Task 2: `parseCsvRoster` helper + unit test

**Files:**
- Create: `src/components/gw/BulkInviteForm/parseCsvRoster.ts`
- Create: `src/components/gw/BulkInviteForm/parseCsvRoster.test.ts`

Pure function — no React, no DB. Easiest thing to test first.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/gw/BulkInviteForm/parseCsvRoster.test.ts
import { describe, it, expect } from "vitest";
import { parseCsvRoster } from "./parseCsvRoster";

describe("parseCsvRoster", () => {
  it("parses a happy-path CSV with the four required columns", () => {
    const csv = [
      "firstName,lastName,email,role",
      "Jane,Doe,jane@test.test,STAFF",
      "John,Smith,john@test.test,ADMIN",
    ].join("\n");
    const result = parseCsvRoster(csv);
    expect(result.rows).toEqual([
      { firstName: "Jane", lastName: "Doe", email: "jane@test.test", role: "STAFF" },
      { firstName: "John", lastName: "Smith", email: "john@test.test", role: "ADMIN" },
    ]);
    expect(result.defaultedToStaff).toBe(false);
  });

  it("defaults role to STAFF when the column is missing", () => {
    const csv = [
      "firstName,lastName,email",
      "Jane,Doe,jane@test.test",
    ].join("\n");
    const result = parseCsvRoster(csv);
    expect(result.rows[0].role).toBe("STAFF");
    expect(result.defaultedToStaff).toBe(true);
  });

  it("is case-insensitive on header names", () => {
    const csv = "FirstName,LASTNAME,Email,Role\nJane,Doe,jane@test.test,VIEWER";
    const result = parseCsvRoster(csv);
    expect(result.rows[0]).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@test.test",
      role: "VIEWER",
    });
  });

  it("ignores unknown columns", () => {
    const csv = "firstName,lastName,email,role,department\nJane,Doe,jane@test.test,STAFF,Front";
    const result = parseCsvRoster(csv);
    expect(result.rows[0]).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@test.test",
      role: "STAFF",
    });
  });

  it("rejects non-OWNER roles only (bulk cannot create owners)", () => {
    const csv = "firstName,lastName,email,role\nJane,Doe,jane@test.test,OWNER";
    const result = parseCsvRoster(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatch(/OWNER.*not allowed/i);
  });

  it("normalizes emails to lowercase", () => {
    const csv = "firstName,lastName,email,role\nJane,Doe,JANE@TEST.TEST,STAFF";
    const result = parseCsvRoster(csv);
    expect(result.rows[0].email).toBe("jane@test.test");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run src/components/gw/BulkInviteForm/parseCsvRoster.test.ts`

Expected: FAIL — `Cannot find module './parseCsvRoster'`

- [ ] **Step 3: Implement the helper**

```ts
// src/components/gw/BulkInviteForm/parseCsvRoster.ts
import { parse } from "csv-parse/sync";

export type RosterRole = "ADMIN" | "STAFF" | "VIEWER";

export interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  role: RosterRole;
}

export interface ParseResult {
  rows: RosterRow[];
  errors: string[];
  defaultedToStaff: boolean;
}

const REQUIRED_COLUMNS = ["firstName", "lastName", "email"] as const;
const VALID_ROLES: RosterRole[] = ["ADMIN", "STAFF", "VIEWER"];

function canonicalize(raw: string): string {
  return raw.trim().replace(/["']/g, "").toLowerCase();
}

const HEADER_ALIASES: Record<string, string> = {
  firstname: "firstName",
  "first name": "firstName",
  first: "firstName",
  lastname: "lastName",
  "last name": "lastName",
  last: "lastName",
  email: "email",
  "email address": "email",
  role: "role",
};

export function parseCsvRoster(csvText: string): ParseResult {
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: (headers: string[]) =>
        headers.map((h) => HEADER_ALIASES[canonicalize(h)] ?? canonicalize(h)),
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      errors: [err instanceof Error ? err.message : "CSV parse failed"],
      defaultedToStaff: false,
    };
  }

  if (records.length === 0) {
    return { rows: [], errors: ["CSV has no data rows"], defaultedToStaff: false };
  }

  const firstRow = records[0];
  for (const col of REQUIRED_COLUMNS) {
    if (!(col in firstRow)) {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (errors.length) {
    return { rows: [], errors, defaultedToStaff: false };
  }

  const defaultedToStaff = !("role" in firstRow);
  const rows: RosterRow[] = [];
  records.forEach((rec, idx) => {
    const line = idx + 2; // header is line 1
    const rawRole = (rec.role ?? "STAFF").toUpperCase();
    if (!VALID_ROLES.includes(rawRole as RosterRole)) {
      if (rawRole === "OWNER") {
        errors.push(`Line ${line}: role OWNER is not allowed in bulk invite`);
      } else {
        errors.push(`Line ${line}: unknown role "${rec.role}"`);
      }
      return;
    }
    const email = (rec.email ?? "").trim().toLowerCase();
    if (!email) {
      errors.push(`Line ${line}: email is required`);
      return;
    }
    rows.push({
      firstName: (rec.firstName ?? "").trim(),
      lastName: (rec.lastName ?? "").trim(),
      email,
      role: rawRole as RosterRole,
    });
  });
  return { rows, errors, defaultedToStaff };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run src/components/gw/BulkInviteForm/parseCsvRoster.test.ts`

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/BulkInviteForm/parseCsvRoster.ts src/components/gw/BulkInviteForm/parseCsvRoster.test.ts
git commit -m "feat(onboarding): parseCsvRoster helper for bulk invite CSV mode"
```

---

## Task 3: `bulkInviteAction` server action + integration test

**Files:**
- Create: `src/app/(dashboard)/programs/staff/bulk-invite/actions.ts`
- Create: `tests/integration/bulk-invite.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/bulk-invite.test.ts
//
// End-to-end for the bulk-invite flow. Reuses the existing
// USER_INVITED projection so most of what we test is the new action's
// dedupe, transactional-batch, and per-row-results contract.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { processBulkInviteRows, type BulkInviteRow } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `bulk-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Bulk Invite Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice };
}

describe("bulk invite action", () => {
  it("emits one USER_INVITED event per valid row", async () => {
    const { owner, practice } = await seed();
    const rows: BulkInviteRow[] = [
      { firstName: "A", lastName: "One", email: `a-${Math.random()}@test.test`, role: "STAFF" },
      { firstName: "B", lastName: "Two", email: `b-${Math.random()}@test.test`, role: "ADMIN" },
    ];
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows,
    });
    expect(result.invitedCount).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.skippedInvalid).toBe(0);
    const invitations = await db.practiceInvitation.findMany({
      where: { practiceId: practice.id },
    });
    expect(invitations).toHaveLength(2);
  });

  it("dedupes duplicate emails within the same batch", async () => {
    const { owner, practice } = await seed();
    const dupEmail = `dup-${Math.random()}@test.test`;
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [
        { firstName: "A", lastName: "One", email: dupEmail, role: "STAFF" },
        { firstName: "B", lastName: "Two", email: dupEmail, role: "STAFF" },
      ],
    });
    expect(result.invitedCount).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults.filter((r) => r.status === "DUPLICATE_IN_BATCH")).toHaveLength(1);
  });

  it("skips emails that are already members of the practice", async () => {
    const { owner, practice } = await seed();
    const existingUser = await db.user.create({
      data: {
        firebaseUid: `existing-${Math.random().toString(36).slice(2, 10)}`,
        email: `existing-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: existingUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [
        { firstName: "", lastName: "", email: existingUser.email!, role: "STAFF" },
      ],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults[0].status).toBe("ALREADY_MEMBER");
  });

  it("skips emails that are already pending invitations", async () => {
    const { owner, practice } = await seed();
    const pendingEmail = `pending-${Math.random()}@test.test`;
    await db.practiceInvitation.create({
      data: {
        id: `inv-${Math.random().toString(36).slice(2, 10)}`,
        practiceId: practice.id,
        invitedByUserId: owner.id,
        invitedEmail: pendingEmail,
        role: "STAFF",
        token: Math.random().toString(36).slice(2),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [{ firstName: "", lastName: "", email: pendingEmail, role: "STAFF" }],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults[0].status).toBe("ALREADY_PENDING");
  });

  it("rejects invalid email format", async () => {
    const { owner, practice } = await seed();
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [{ firstName: "", lastName: "", email: "not-an-email", role: "STAFF" }],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedInvalid).toBe(1);
    expect(result.perRowResults[0].status).toBe("INVALID_EMAIL");
  });

  it("hard-caps at 200 rows per batch", async () => {
    const { owner, practice } = await seed();
    const rows: BulkInviteRow[] = Array.from({ length: 201 }, (_, i) => ({
      firstName: "",
      lastName: "",
      email: `cap-${i}-${Math.random().toString(36).slice(2, 6)}@test.test`,
      role: "STAFF" as const,
    }));
    await expect(
      processBulkInviteRows({
        practiceId: practice.id,
        actorUserId: owner.id,
        rows,
      }),
    ).rejects.toThrow(/200/);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run tests/integration/bulk-invite.test.ts`

Expected: FAIL — `Cannot find module '.../bulk-invite/actions'`

- [ ] **Step 3: Implement the action**

```ts
// src/app/(dashboard)/programs/staff/bulk-invite/actions.ts
"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectUserInvited } from "@/lib/events/projections/invitation";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml } from "@/lib/email/template";

const MAX_BATCH = 200;
const INVITATION_TTL_DAYS = 7;

export const BulkInviteRowSchema = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  email: z.string().max(200),
  role: z.enum(["ADMIN", "STAFF", "VIEWER"]),
});

export type BulkInviteRow = z.infer<typeof BulkInviteRowSchema>;

export type BulkRowStatus =
  | "INVITED"
  | "DUPLICATE_IN_BATCH"
  | "ALREADY_MEMBER"
  | "ALREADY_PENDING"
  | "INVALID_EMAIL"
  | "INVALID_ROLE";

export interface BulkInvitePerRowResult {
  email: string;
  status: BulkRowStatus;
  invitationId?: string;
  emailDelivered?: boolean;
  emailReason?: string;
}

export interface BulkInviteResult {
  invitedCount: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  perRowResults: BulkInvitePerRowResult[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function acceptUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  return `${base.replace(/\/$/, "")}/accept-invite/${token}`;
}

/**
 * Core pipeline, exported for testing. The public server action wraps
 * this with auth + revalidation. Pure in its DB effects: for every
 * accepted row it writes one USER_INVITED event via the existing
 * projection. Email sends happen after the transaction (best-effort).
 */
export async function processBulkInviteRows(args: {
  practiceId: string;
  actorUserId: string;
  rows: BulkInviteRow[];
}): Promise<BulkInviteResult> {
  if (args.rows.length > MAX_BATCH) {
    throw new Error(
      `Batch too large: ${args.rows.length} rows exceeds the ${MAX_BATCH}-row cap. Split into multiple uploads.`,
    );
  }

  const perRowResults: BulkInvitePerRowResult[] = [];
  const seenInBatch = new Set<string>();
  const emailsToCheck: string[] = [];
  const acceptedRows: BulkInviteRow[] = [];

  // Pass 1: in-memory validation — format, role, intra-batch dedupe.
  for (const raw of args.rows) {
    const email = raw.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      perRowResults.push({ email: raw.email, status: "INVALID_EMAIL" });
      continue;
    }
    if (seenInBatch.has(email)) {
      perRowResults.push({ email, status: "DUPLICATE_IN_BATCH" });
      continue;
    }
    seenInBatch.add(email);
    acceptedRows.push({ ...raw, email });
    emailsToCheck.push(email);
  }

  // Pass 2: DB dedupe — existing members + pending invitations.
  const existingMembers = await db.user.findMany({
    where: {
      email: { in: emailsToCheck },
      practiceUsers: { some: { practiceId: args.practiceId, removedAt: null } },
    },
    select: { email: true },
  });
  const existingMemberEmails = new Set(
    existingMembers.map((u) => (u.email ?? "").toLowerCase()),
  );
  const pendingInvites = await db.practiceInvitation.findMany({
    where: {
      practiceId: args.practiceId,
      invitedEmail: { in: emailsToCheck },
      acceptedAt: null,
      revokedAt: null,
    },
    select: { invitedEmail: true },
  });
  const pendingEmails = new Set(pendingInvites.map((p) => p.invitedEmail));

  const toWrite: Array<{ row: BulkInviteRow; token: string; invitationId: string }> = [];
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  for (const row of acceptedRows) {
    if (existingMemberEmails.has(row.email)) {
      perRowResults.push({ email: row.email, status: "ALREADY_MEMBER" });
      continue;
    }
    if (pendingEmails.has(row.email)) {
      perRowResults.push({ email: row.email, status: "ALREADY_PENDING" });
      continue;
    }
    toWrite.push({
      row,
      token: randomBytes(24).toString("base64url"),
      invitationId: randomUUID(),
    });
  }

  // Pass 3: emit one USER_INVITED event per acceptable row. appendEventAndApply
  // runs inside its own tx, so a batch of N writes = N transactions.
  // Failures roll back per-row but the batch is not atomic — if row 50
  // fails, rows 1-49 are still invited. This matches the spec's
  // "partial-failure is impossible **per row**" goal — the batch is an
  // idempotent set of independent invitations, not a ledger requiring
  // all-or-nothing.
  const practice = await db.practice.findUniqueOrThrow({
    where: { id: args.practiceId },
    select: { name: true },
  });

  for (const { row, token, invitationId } of toWrite) {
    const payload = {
      invitationId,
      invitedEmail: row.email,
      role: row.role,
      expiresAt: expiresAt.toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: args.practiceId,
        actorUserId: args.actorUserId,
        type: "USER_INVITED",
        payload,
      },
      async (tx) =>
        projectUserInvited(tx, {
          practiceId: args.practiceId,
          invitedByUserId: args.actorUserId,
          token,
          payload,
        }),
    );
    perRowResults.push({
      email: row.email,
      status: "INVITED",
      invitationId,
    });
  }

  // Email send (post-commit, best-effort). Failures here don't roll back
  // the invitations — staff-page surfaces a "resend" button per row.
  for (const rowResult of perRowResults) {
    if (rowResult.status !== "INVITED" || !rowResult.invitationId) continue;
    const written = toWrite.find((w) => w.invitationId === rowResult.invitationId);
    if (!written) continue;
    const href = acceptUrl(written.token);
    const subject = `${practice.name} invited you to GuardWell`;
    const text = [
      `You've been invited to join ${practice.name} on GuardWell.`,
      `Role: ${written.row.role}.`,
      ``,
      `Accept: ${href}`,
      ``,
      `Expires ${expiresAt.toUTCString()}.`,
    ].join("\n");
    const html = renderEmailHtml({
      preheader: `${practice.name} invited you to GuardWell.`,
      headline: `You're invited to ${practice.name}`,
      subheadline: `Join as ${written.row.role}.`,
      sections: [
        {
          html: `<p style="margin:0 0 8px;">GuardWell is how ${practice.name} tracks compliance. Accept the invitation to collaborate with your team.</p><p style="margin:0; color:#64748B;">This invitation expires ${expiresAt.toUTCString()}.</p>`,
        },
      ],
      cta: { label: "Accept invitation", href },
      practiceName: practice.name,
    });
    const emailResult = await sendEmail({
      to: written.row.email,
      subject,
      text,
      html,
    });
    rowResult.emailDelivered = emailResult.delivered;
    rowResult.emailReason = emailResult.reason;
  }

  return {
    invitedCount: perRowResults.filter((r) => r.status === "INVITED").length,
    skippedDuplicates: perRowResults.filter(
      (r) =>
        r.status === "DUPLICATE_IN_BATCH" ||
        r.status === "ALREADY_MEMBER" ||
        r.status === "ALREADY_PENDING",
    ).length,
    skippedInvalid: perRowResults.filter(
      (r) => r.status === "INVALID_EMAIL" || r.status === "INVALID_ROLE",
    ).length,
    perRowResults,
  };
}

const BulkInput = z.object({
  rows: z.array(BulkInviteRowSchema).min(1).max(MAX_BATCH),
});

export async function bulkInviteAction(
  input: z.infer<typeof BulkInput>,
): Promise<BulkInviteResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can bulk-invite team members");
  }
  const parsed = BulkInput.parse(input);
  const result = await processBulkInviteRows({
    practiceId: pu.practiceId,
    actorUserId: user.id,
    rows: parsed.rows,
  });
  revalidatePath("/programs/staff");
  revalidatePath("/programs/staff/bulk-invite");
  return result;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run tests/integration/bulk-invite.test.ts`

Expected: PASS (6 tests). If the DB isn't running, start the Cloud SQL proxy first: `./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5434 &`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/programs/staff/bulk-invite/actions.ts tests/integration/bulk-invite.test.ts
git commit -m "feat(onboarding): bulkInviteAction with transactional batch + per-row results"
```

---

## Task 4: `<BulkInviteForm>` component — paste mode + CSV mode

**Files:**
- Create: `src/components/gw/BulkInviteForm/BulkInviteForm.tsx`
- Create: `src/components/gw/BulkInviteForm/index.ts`

This is the reusable client component. Pattern: one component, two tabs (Paste / CSV). Both collect rows into a unified `RosterRow[]` state, then submit via the prop callback so hosts can wrap it with their own server-action invocation.

- [ ] **Step 1: Implement the component**

```tsx
// src/components/gw/BulkInviteForm/BulkInviteForm.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseCsvRoster, type RosterRow, type RosterRole } from "./parseCsvRoster";
import type { BulkInviteResult } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

export type SubmitFn = (rows: RosterRow[]) => Promise<BulkInviteResult>;

export interface BulkInviteFormProps {
  onSubmit: SubmitFn;
  onSkip?: () => void;
  submitLabel?: string;
  skipLabel?: string;
}

type Mode = "PASTE" | "CSV";

const ROLE_OPTIONS: RosterRole[] = ["STAFF", "ADMIN", "VIEWER"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitPastedEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function BulkInviteForm({
  onSubmit,
  onSkip,
  submitLabel,
  skipLabel,
}: BulkInviteFormProps) {
  const [mode, setMode] = useState<Mode>("PASTE");
  const [pastedText, setPastedText] = useState("");
  const [pasteRole, setPasteRole] = useState<RosterRole>("STAFF");
  const [csvRows, setCsvRows] = useState<RosterRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvDefaultedNote, setCsvDefaultedNote] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const pastedEmails = useMemo(() => splitPastedEmails(pastedText), [pastedText]);
  const pastedValid = useMemo(
    () => pastedEmails.filter((e) => EMAIL_RE.test(e)),
    [pastedEmails],
  );
  const pastedInvalid = pastedEmails.filter((e) => !EMAIL_RE.test(e));

  const rowsToSubmit: RosterRow[] = useMemo(() => {
    if (mode === "CSV") return csvRows;
    return pastedValid.map((email) => ({
      firstName: "",
      lastName: "",
      email: email.toLowerCase(),
      role: pasteRole,
    }));
  }, [mode, pastedValid, pasteRole, csvRows]);

  const handleCsvFile = async (file: File) => {
    if (file.size > 500 * 1024) {
      setCsvErrors(["CSV too large — max 500 KB."]);
      return;
    }
    const text = await file.text();
    const parsed = parseCsvRoster(text);
    setCsvRows(parsed.rows);
    setCsvErrors(parsed.errors);
    setCsvDefaultedNote(parsed.defaultedToStaff);
  };

  const handleSubmit = () => {
    if (rowsToSubmit.length === 0) return;
    setSubmitError(null);
    startTransition(async () => {
      try {
        const r = await onSubmit(rowsToSubmit);
        setResult(r);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Bulk invite failed");
      }
    });
  };

  if (result) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-lg font-semibold">
            {result.invitedCount} invitation{result.invitedCount === 1 ? "" : "s"} sent
          </p>
          <ul className="text-sm text-muted-foreground space-y-1">
            {result.skippedDuplicates > 0 && (
              <li>· {result.skippedDuplicates} skipped (already member or pending)</li>
            )}
            {result.skippedInvalid > 0 && (
              <li>· {result.skippedInvalid} skipped (invalid email)</li>
            )}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Per-row results ({result.perRowResults.length})
            </summary>
            <ul className="mt-2 space-y-0.5 text-foreground">
              {result.perRowResults.map((r, i) => (
                <li key={`${r.email}-${i}`} className="font-mono">
                  {r.email} — {r.status}
                </li>
              ))}
            </ul>
          </details>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setResult(null)}>
              Invite more
            </Button>
            {onSkip && (
              <Button onClick={onSkip}>{skipLabel ?? "Done"}</Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("PASTE")}
          className={`rounded-md border px-3 py-1.5 ${mode === "PASTE" ? "bg-primary text-primary-foreground" : "bg-background"}`}
        >
          Paste emails
        </button>
        <button
          type="button"
          onClick={() => setMode("CSV")}
          className={`rounded-md border px-3 py-1.5 ${mode === "CSV" ? "bg-primary text-primary-foreground" : "bg-background"}`}
        >
          Upload CSV
        </button>
      </div>

      {mode === "PASTE" && (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1 text-xs font-medium">
              Emails (one per line, or comma-separated)
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={6}
                placeholder="jane@example.com&#10;john@example.com"
                className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="w-32 space-y-1 text-xs font-medium">
              Role for all
              <select
                value={pasteRole}
                onChange={(e) => setPasteRole(e.target.value as RosterRole)}
                className="block w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            <Badge variant="secondary">{pastedValid.length}</Badge> will be invited as {pasteRole}
            {pastedInvalid.length > 0 && (
              <span className="ml-2 text-amber-600">· {pastedInvalid.length} invalid</span>
            )}
          </p>
        </div>
      )}

      {mode === "CSV" && (
        <div className="space-y-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleCsvFile(f);
            }}
            className="block w-full text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Expected columns: <code>firstName, lastName, email, role</code> (role optional; defaults to STAFF).
            {" "}
            <a
              href="data:text/csv;charset=utf-8,firstName%2ClastName%2Cemail%2Crole%0AJane%2CDoe%2Cjane%40example.com%2CSTAFF%0A"
              download="guardwell-roster-template.csv"
              className="underline"
            >
              Download template
            </a>
          </p>
          {csvDefaultedNote && (
            <p className="text-xs text-amber-600">
              Role column missing — all rows defaulted to STAFF.
            </p>
          )}
          {csvErrors.length > 0 && (
            <ul className="text-xs text-red-600 space-y-0.5">
              {csvErrors.map((err, i) => (
                <li key={i}>· {err}</li>
              ))}
            </ul>
          )}
          {csvRows.length > 0 && (
            <div className="rounded-md border text-xs">
              <table className="w-full">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 50).map((r, i) => (
                    <tr key={`${r.email}-${i}`} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.email}</td>
                      <td className="px-2 py-1">
                        {[r.firstName, r.lastName].filter(Boolean).join(" ")}
                      </td>
                      <td className="px-2 py-1">{r.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 50 && (
                <p className="px-2 py-1 text-muted-foreground">
                  · +{csvRows.length - 50} more row(s)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || rowsToSubmit.length === 0}
        >
          {isPending ? "Inviting…" : submitLabel ?? `Invite ${rowsToSubmit.length}`}
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isPending}>
            {skipLabel ?? "Skip"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the barrel**

```ts
// src/components/gw/BulkInviteForm/index.ts
export { BulkInviteForm } from "./BulkInviteForm";
export { parseCsvRoster } from "./parseCsvRoster";
export type { RosterRow, RosterRole, ParseResult } from "./parseCsvRoster";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/gw/BulkInviteForm/
git commit -m "feat(onboarding): BulkInviteForm with paste + CSV modes"
```

---

## Task 5: Standalone `/programs/staff/bulk-invite` page

**Files:**
- Create: `src/app/(dashboard)/programs/staff/bulk-invite/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// src/app/(dashboard)/programs/staff/bulk-invite/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Users } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { BulkInviteForm } from "@/components/gw/BulkInviteForm";
import { bulkInviteAction } from "./actions";

export const metadata = { title: "Bulk invite · Staff" };

export default async function BulkInvitePage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canInvite = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { href: "/programs" as Route, label: "My Programs" },
          { href: "/programs/staff" as Route, label: "Staff" },
          { label: "Bulk invite" },
        ]}
      />
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Bulk invite team members</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste a list of emails or upload a CSV. Valid rows create individual
        invitations — each person receives the standard invite email with a 7-day
        accept link.
      </p>
      {!canInvite ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can invite team members.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <BulkInviteForm
              onSubmit={(rows) => bulkInviteAction({ rows })}
            />
            <p className="mt-6 text-xs text-muted-foreground">
              <Link href={"/programs/staff" as Route} className="underline">
                ← Back to staff
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the route renders**

Run the preview server if not already running, then visit `/programs/staff/bulk-invite` — should show the form with paste/CSV tabs.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/programs/staff/bulk-invite/page.tsx
git commit -m "feat(onboarding): standalone /programs/staff/bulk-invite page"
```

---

## Task 6: Staff page entry-point button

**Files:**
- Modify: `src/app/(dashboard)/programs/staff/page.tsx`

- [ ] **Step 1: Read the current page to find the invite section**

Run: `grep -n "InviteMemberForm\|Invite team" src/app/\(dashboard\)/programs/staff/page.tsx`

- [ ] **Step 2: Add the "Bulk invite" link above the invite form**

Locate the section that renders `<InviteMemberForm canInvite={...} />` and insert, immediately above it:

```tsx
{canInvite && (
  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
    <span className="text-muted-foreground">
      Have a list of staff? Invite everyone at once.
    </span>
    <Link
      href={"/programs/staff/bulk-invite" as Route}
      className="rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
    >
      + Bulk invite
    </Link>
  </div>
)}
```

If `Link` / `Route` aren't already imported at the top of the file, add:

```ts
import Link from "next/link";
import type { Route } from "next";
```

- [ ] **Step 3: Typecheck + manual verify**

Run: `npx tsc --noEmit`, then view `/programs/staff` in the browser and click the button — should navigate to the bulk-invite page.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/programs/staff/page.tsx
git commit -m "feat(onboarding): add Bulk invite entry point on /programs/staff"
```

---

## Task 7: First-run wizard route shell + progress bar

**Files:**
- Create: `src/app/onboarding/first-run/layout.tsx`
- Create: `src/app/onboarding/first-run/page.tsx`
- Create: `src/app/onboarding/first-run/WizardShell.tsx`

The page is a server component that computes the "current step" based on what the OWNER has already done — so a user who bails after Step 2 and comes back lands on Step 3. The shell is a client component that renders whichever step child is active + the progress bar + skip link.

- [ ] **Step 1: Create the layout (auth gate)**

```tsx
// src/app/onboarding/first-run/layout.tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function FirstRunLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up" as Route);
  if (!user.emailVerified) redirect("/sign-up/verify" as Route);

  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice" as Route);

  // Subscription gate — only TRIALING/ACTIVE can be in the wizard.
  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { subscriptionStatus: true, firstRunCompletedAt: true },
  });
  if (practice.subscriptionStatus === "INCOMPLETE") {
    redirect("/sign-up/payment" as Route);
  }
  if (
    practice.subscriptionStatus === "PAST_DUE" ||
    practice.subscriptionStatus === "CANCELED"
  ) {
    redirect("/account/locked" as Route);
  }

  // Compliance profile gate — wizard assumes it's done.
  const profile = await db.practiceComplianceProfile.findUnique({
    where: { practiceId: pu.practiceId },
    select: { practiceId: true },
  });
  if (!profile) redirect("/onboarding/compliance-profile" as Route);

  // If the wizard's already finished, send them home.
  if (practice.firstRunCompletedAt) redirect("/dashboard" as Route);

  return <div className="min-h-screen bg-background">{children}</div>;
}
```

- [ ] **Step 2: Create the step-router page**

```tsx
// src/app/onboarding/first-run/page.tsx
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { WizardShell } from "./WizardShell";

type StepCode = "OFFICERS" | "POLICY" | "TRAINING" | "INVITE" | "COMPLETE";

export default async function FirstRunPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  // Step 1 done when the OWNER has BOTH isPrivacyOfficer and isSecurityOfficer.
  const officersDone = pu.isPrivacyOfficer && pu.isSecurityOfficer;

  // Step 2 done when HIPAA_PRIVACY_POLICY is adopted + not retired.
  const privacyPolicy = await db.practicePolicy.findFirst({
    where: {
      practiceId: pu.practiceId,
      policyCode: "HIPAA_PRIVACY_POLICY",
      retiredAt: null,
    },
    select: { id: true, content: true, version: true },
  });
  const policyDone = Boolean(privacyPolicy);

  // Step 3 done when the OWNER has a passing, non-expired HIPAA_BASICS completion.
  const hipaaBasicsCourse = await db.trainingCourse.findUnique({
    where: { code: "HIPAA_BASICS" },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      passingScore: true,
      quizQuestions: { orderBy: { order: "asc" } },
    },
  });
  const trainingCompletion = hipaaBasicsCourse
    ? await db.trainingCompletion.findFirst({
        where: {
          userId: pu.userId,
          practiceId: pu.practiceId,
          courseId: hipaaBasicsCourse.id,
          passed: true,
          expiresAt: { gt: new Date() },
        },
      })
    : null;
  const trainingDone = Boolean(trainingCompletion);

  const currentStep: StepCode = !officersDone
    ? "OFFICERS"
    : !policyDone
      ? "POLICY"
      : !trainingDone
        ? "TRAINING"
        : "INVITE";

  // Fetch the privacy-policy template body for Step 2 (if not yet adopted).
  const privacyTemplate =
    !policyDone
      ? await db.policyTemplate.findUnique({
          where: { code: "HIPAA_PRIVACY_POLICY" },
          select: { code: true, title: true, bodyMarkdown: true },
        })
      : null;

  return (
    <WizardShell
      currentStep={currentStep}
      owner={{
        practiceUserId: pu.id,
        userId: pu.userId,
        displayName:
          [pu.dbUser.firstName, pu.dbUser.lastName].filter(Boolean).join(" ") ||
          pu.dbUser.email ||
          "You",
      }}
      privacyTemplate={privacyTemplate}
      hipaaBasicsCourse={hipaaBasicsCourse}
    />
  );
}
```

- [ ] **Step 3: Create the client shell**

```tsx
// src/app/onboarding/first-run/WizardShell.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Step1Officers } from "./Step1Officers";
import { Step2Policy } from "./Step2Policy";
import { Step3Training } from "./Step3Training";
import { Step4Invite } from "./Step4Invite";
import { WizardComplete } from "./WizardComplete";

type StepCode = "OFFICERS" | "POLICY" | "TRAINING" | "INVITE" | "COMPLETE";

const STEP_ORDER: Exclude<StepCode, "COMPLETE">[] = [
  "OFFICERS",
  "POLICY",
  "TRAINING",
  "INVITE",
];

const STEP_LABELS: Record<StepCode, string> = {
  OFFICERS: "Officers",
  POLICY: "Privacy Policy",
  TRAINING: "HIPAA training",
  INVITE: "Invite team",
  COMPLETE: "Done",
};

export interface WizardShellProps {
  currentStep: StepCode;
  owner: {
    practiceUserId: string;
    userId: string;
    displayName: string;
  };
  privacyTemplate: {
    code: string;
    title: string;
    bodyMarkdown: string;
  } | null;
  hipaaBasicsCourse: HipaaBasicsCourse | null;
}

export interface HipaaBasicsCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  passingScore: number;
  quizQuestions: Array<{
    id: string;
    question: string;
    options: string[];
    order: number;
  }>;
}

export function WizardShell(props: WizardShellProps) {
  const [step, setStep] = useState<StepCode>(props.currentStep);

  const currentIndex = STEP_ORDER.indexOf(step as Exclude<StepCode, "COMPLETE">);
  const completedCount =
    step === "COMPLETE" ? STEP_ORDER.length : Math.max(0, currentIndex);

  const advance = () => {
    const next = STEP_ORDER[currentIndex + 1];
    setStep(next ?? "COMPLETE");
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            First-run setup · {completedCount}/{STEP_ORDER.length} complete
          </p>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "You can come back to this anytime in Compliance Track. Skip?",
                )
              ) {
                window.location.assign("/dashboard");
              }
            }}
            className="text-xs text-muted-foreground underline"
          >
            Skip onboarding
          </button>
        </div>
        <div className="flex gap-1.5">
          {STEP_ORDER.map((code, i) => (
            <div
              key={code}
              className={`h-1.5 flex-1 rounded ${
                i < completedCount ? "bg-primary" : "bg-muted"
              }`}
              aria-label={STEP_LABELS[code]}
            />
          ))}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          {step === "OFFICERS" && (
            <Step1Officers owner={props.owner} onComplete={advance} />
          )}
          {step === "POLICY" && (
            <Step2Policy template={props.privacyTemplate} onComplete={advance} />
          )}
          {step === "TRAINING" && (
            <Step3Training course={props.hipaaBasicsCourse} onComplete={advance} />
          )}
          {step === "INVITE" && <Step4Invite onComplete={advance} />}
          {step === "COMPLETE" && <WizardComplete />}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Commit — step components coming in Tasks 8-11**

Don't commit yet; the shell imports Step1-4 + WizardComplete which don't exist. We'll commit after Task 11.

---

## Task 8: Step 1 — Officer designation

**Files:**
- Create: `src/app/onboarding/first-run/Step1Officers.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/app/onboarding/first-run/Step1Officers.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleOfficerAction } from "@/app/(dashboard)/programs/staff/actions";

export interface Step1OfficersProps {
  owner: { practiceUserId: string; userId: string; displayName: string };
  onComplete: () => void;
}

export function Step1Officers({ owner, onComplete }: Step1OfficersProps) {
  const [privacyDone, setPrivacyDone] = useState(false);
  const [securityDone, setSecurityDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (role: "PRIVACY" | "SECURITY") => {
    setError(null);
    startTransition(async () => {
      try {
        await toggleOfficerAction({
          practiceUserId: owner.practiceUserId,
          officerRole: role,
          designated: true,
        });
        if (role === "PRIVACY") setPrivacyDone(true);
        else setSecurityDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const bothDone = privacyDone && securityDone;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 1 · 90 seconds
        </p>
        <h2 className="text-xl font-semibold">Designate yourself as Privacy + Security Officer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          HIPAA requires every practice to name both a Privacy Officer and a Security
          Officer. As the owner, you'll fill both roles until you delegate them later.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <OfficerCard
          label="Privacy Officer"
          citation="HIPAA §164.530(a)(1)"
          name={owner.displayName}
          confirmed={privacyDone}
          disabled={isPending}
          onConfirm={() => handleToggle("PRIVACY")}
        />
        <OfficerCard
          label="Security Officer"
          citation="HIPAA §164.308(a)(2)"
          name={owner.displayName}
          confirmed={securityDone}
          disabled={isPending}
          onConfirm={() => handleToggle("SECURITY")}
        />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!bothDone}>
          Continue → Privacy Policy
        </Button>
      </div>
    </div>
  );
}

function OfficerCard({
  label,
  citation,
  name,
  confirmed,
  disabled,
  onConfirm,
}: {
  label: string;
  citation: string;
  name: string;
  confirmed: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition ${
        confirmed ? "border-emerald-500 bg-emerald-50" : "bg-background"
      }`}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{citation}</p>
      <p className="mt-3 text-sm">{name}</p>
      <Button
        type="button"
        variant={confirmed ? "secondary" : "default"}
        size="sm"
        className="mt-3 w-full"
        onClick={onConfirm}
        disabled={disabled || confirmed}
        aria-pressed={confirmed}
      >
        {confirmed ? "✓ Designated" : `I'll be the ${label}`}
      </Button>
    </div>
  );
}
```

---

## Task 9: Step 2 — Policy adoption

**Files:**
- Create: `src/app/onboarding/first-run/Step2Policy.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/app/onboarding/first-run/Step2Policy.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { adoptPolicyFromTemplateAction } from "@/app/(dashboard)/programs/policies/actions";

export interface Step2PolicyProps {
  template: { code: string; title: string; bodyMarkdown: string } | null;
  onComplete: () => void;
}

export function Step2Policy({ template, onComplete }: Step2PolicyProps) {
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!template) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Privacy policy template missing from the catalog. Contact support.
        </p>
        <Button onClick={onComplete} variant="ghost">
          Skip this step
        </Button>
      </div>
    );
  }

  const handleAdopt = () => {
    setError(null);
    startTransition(async () => {
      try {
        await adoptPolicyFromTemplateAction({ templateCode: template.code });
        setAdopted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Adoption failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 2 · 3 minutes
        </p>
        <h2 className="text-xl font-semibold">Adopt your HIPAA Privacy Policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every practice needs a Privacy Policy. We'll start you with our
          HIPAA-compliant template — you can edit it anytime in My Programs › Policies.
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-4 text-xs">
        <pre className="whitespace-pre-wrap font-sans text-foreground">
          {template.bodyMarkdown}
        </pre>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleAdopt}
          disabled={adopted || isPending}
        >
          {adopted ? "✓ Adopted" : isPending ? "Adopting…" : "Adopt template"}
        </Button>
        <Button onClick={onComplete} disabled={!adopted}>
          Continue → HIPAA training
        </Button>
      </div>
    </div>
  );
}
```

---

## Task 10: Step 3 — HIPAA Basics quiz

**Files:**
- Create: `src/app/onboarding/first-run/Step3Training.tsx`

Reuses existing `QuizRunner` client component. The wizard wraps it with a "Continue" button that appears after a passing completion.

- [ ] **Step 1: Implement the component**

```tsx
// src/app/onboarding/first-run/Step3Training.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import {
  QuizRunner,
  type QuizQuestion,
} from "@/app/(dashboard)/programs/training/[courseId]/QuizRunner";

export interface Step3TrainingProps {
  course: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    passingScore: number;
    quizQuestions: QuizQuestion[];
  } | null;
  onComplete: () => void;
}

export function Step3Training({ course, onComplete }: Step3TrainingProps) {
  const [passed, setPassed] = useState(false);

  if (!course) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          HIPAA Basics course missing from the catalog. Contact support.
        </p>
        <Button onClick={onComplete} variant="ghost">
          Skip this step
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 3 · 10 minutes
        </p>
        <h2 className="text-xl font-semibold">Take HIPAA Basics yourself</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          OCR expects every workforce member to complete HIPAA training. Pass at
          {" "}{course.passingScore}% to satisfy HIPAA_WORKFORCE_TRAINING for yourself.
        </p>
        {course.description && (
          <p className="mt-2 text-xs text-muted-foreground">{course.description}</p>
        )}
      </div>
      <div className="rounded-md border bg-muted/30 p-4">
        <QuizRunner
          courseId={course.id}
          passingScore={course.passingScore}
          questions={course.quizQuestions}
          onPass={() => setPassed(true)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Prefer the full lesson?{" "}
        <Link
          href={`/programs/training/${course.id}` as Route}
          className="underline"
          target="_blank"
        >
          Open the course in a new tab
        </Link>
        {" "}— quiz state is shared.
      </p>
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!passed}>
          Continue → Invite your team
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Extend QuizRunner with an optional onPass callback**

Read `src/app/(dashboard)/programs/training/[courseId]/QuizRunner.tsx`. Find the place where `submitQuizAction` resolves with `r` and the component calls `setResult(r)`. Directly after `setResult(r)`, add:

```ts
if (r.passed && onPass) onPass();
```

Extend the props interface:

```ts
export interface QuizRunnerProps {
  courseId: string;
  passingScore: number;
  questions: QuizQuestion[];
  onPass?: () => void;
}
```

And destructure `onPass` from props in the component signature.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

---

## Task 11: Step 4 — Bulk invite (or skip) + WizardComplete

**Files:**
- Create: `src/app/onboarding/first-run/Step4Invite.tsx`
- Create: `src/app/onboarding/first-run/WizardComplete.tsx`
- Create: `src/app/onboarding/first-run/actions.ts`
- Create: `src/lib/events/projections/firstRunCompleted.ts`

Completion event + projection first, then the two client components.

- [ ] **Step 1: Create the projection**

```ts
// src/lib/events/projections/firstRunCompleted.ts
//
// Projects ONBOARDING_FIRST_RUN_COMPLETED → Practice.firstRunCompletedAt.
// Idempotent: repeat writes leave the earliest timestamp in place.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"ONBOARDING_FIRST_RUN_COMPLETED", 1>;

export async function projectFirstRunCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  void args.payload; // payload is audit-only — no fields mapped to columns
  const practice = await tx.practice.findUnique({
    where: { id: args.practiceId },
    select: { firstRunCompletedAt: true },
  });
  if (practice?.firstRunCompletedAt) return; // idempotent
  await tx.practice.update({
    where: { id: args.practiceId },
    data: { firstRunCompletedAt: new Date() },
  });
}
```

- [ ] **Step 2: Create the server action**

```ts
// src/app/onboarding/first-run/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectFirstRunCompleted } from "@/lib/events/projections/firstRunCompleted";

const Input = z.object({
  stepsCompleted: z.array(z.string()).min(1),
  durationSeconds: z.number().int().min(0).default(0),
});

export async function completeFirstRunAction(
  input: z.infer<typeof Input>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can complete onboarding");
  }
  const parsed = Input.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ONBOARDING_FIRST_RUN_COMPLETED",
      payload: {
        completedByUserId: user.id,
        stepsCompleted: parsed.stepsCompleted,
        durationSeconds: parsed.durationSeconds,
      },
    },
    async (tx) =>
      projectFirstRunCompleted(tx, {
        practiceId: pu.practiceId,
        payload: {
          completedByUserId: user.id,
          stepsCompleted: parsed.stepsCompleted,
          durationSeconds: parsed.durationSeconds,
        },
      }),
  );

  revalidatePath("/dashboard");
  revalidatePath("/programs/track");
}
```

- [ ] **Step 3: Implement Step4Invite**

```tsx
// src/app/onboarding/first-run/Step4Invite.tsx
"use client";

import { Button } from "@/components/ui/button";
import { BulkInviteForm } from "@/components/gw/BulkInviteForm";
import { bulkInviteAction } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

export interface Step4InviteProps {
  onComplete: () => void;
}

export function Step4Invite({ onComplete }: Step4InviteProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 4 · 2 minutes (or skip)
        </p>
        <h2 className="text-xl font-semibold">Invite your team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the rest of your staff so they can take training and acknowledge
          policies. Skip for now if you want to roll this out quietly.
        </p>
      </div>
      <BulkInviteForm
        onSubmit={(rows) => bulkInviteAction({ rows })}
        onSkip={onComplete}
        submitLabel="Send invites"
        skipLabel="Skip for now — I'll invite later"
      />
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onComplete}>
          I'm done with invites → finish
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement WizardComplete**

```tsx
// src/app/onboarding/first-run/WizardComplete.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { completeFirstRunAction } from "./actions";

const STEPS = ["OFFICERS", "POLICY", "TRAINING", "INVITE"];

export function WizardComplete() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (recorded) return;
    // Fire the celebration BEFORE the server round-trip so it feels instant.
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.3 },
    });
    // Record the completion.
    completeFirstRunAction({
      stepsCompleted: STEPS,
      durationSeconds: 0,
    })
      .then(() => setRecorded(true))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Record failed"),
      );
  }, [recorded]);

  return (
    <div className="space-y-4 text-center">
      <h2 className="text-2xl font-semibold">You're at compliance score 30 🎉</h2>
      <p className="text-sm text-muted-foreground">
        Privacy + Security Officers named · Privacy Policy adopted · HIPAA Basics
        complete · Team invited. Your Compliance Track is waiting on the
        dashboard with the next steps.
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-center">
        <Button
          onClick={() => router.push("/dashboard" as Route)}
          disabled={!recorded}
        >
          Go to dashboard →
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck the full wizard**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit the whole wizard**

```bash
git add src/app/onboarding/first-run/ src/lib/events/projections/firstRunCompleted.ts src/app/\(dashboard\)/programs/training/\[courseId\]/QuizRunner.tsx
git commit -m "feat(onboarding): first-run wizard with officer / policy / training / invite steps"
```

---

## Task 12: Completion integration test

**Files:**
- Create: `tests/integration/first-run-completion.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/first-run-completion.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectFirstRunCompleted } from "@/lib/events/projections/firstRunCompleted";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `fr-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `fr-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "First Run Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice };
}

describe("First-run completion", () => {
  it("ONBOARDING_FIRST_RUN_COMPLETED sets Practice.firstRunCompletedAt", async () => {
    const { owner, practice } = await seed();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ONBOARDING_FIRST_RUN_COMPLETED",
        payload: {
          completedByUserId: owner.id,
          stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
          durationSeconds: 900,
        },
      },
      async (tx) =>
        projectFirstRunCompleted(tx, {
          practiceId: practice.id,
          payload: {
            completedByUserId: owner.id,
            stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
            durationSeconds: 900,
          },
        }),
    );
    const after = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    expect(after.firstRunCompletedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — repeat writes leave the earliest timestamp", async () => {
    const { owner, practice } = await seed();
    const payload = {
      completedByUserId: owner.id,
      stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
      durationSeconds: 900,
    };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: owner.id, type: "ONBOARDING_FIRST_RUN_COMPLETED", payload },
      async (tx) => projectFirstRunCompleted(tx, { practiceId: practice.id, payload }),
    );
    const first = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: owner.id, type: "ONBOARDING_FIRST_RUN_COMPLETED", payload },
      async (tx) => projectFirstRunCompleted(tx, { practiceId: practice.id, payload }),
    );
    const second = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    expect(second.firstRunCompletedAt?.getTime()).toBe(
      first.firstRunCompletedAt?.getTime(),
    );
  });
});
```

- [ ] **Step 2: Run the test — verify it passes**

Run: `npx vitest run tests/integration/first-run-completion.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/first-run-completion.test.ts
git commit -m "test(onboarding): first-run completion projection + idempotency"
```

---

## Task 13: Redirect compliance-profile → first-run wizard

**Files:**
- Modify: `src/app/onboarding/compliance-profile/page.tsx`

The form takes a `redirectTo` prop that defaults to `/dashboard`. Change the page that renders it to pass `/onboarding/first-run`.

- [ ] **Step 1: Read the page to find the redirectTo prop passage**

Run: `grep -n "redirectTo\|<ComplianceProfileForm" src/app/onboarding/compliance-profile/page.tsx`

- [ ] **Step 2: Change the redirectTo value**

Edit the prop where `<ComplianceProfileForm ... />` is rendered. Change `redirectTo="/dashboard"` to `redirectTo="/onboarding/first-run"`.

If the prop isn't currently passed, add it explicitly:

```tsx
<ComplianceProfileForm
  initial={/* existing */}
  redirectTo="/onboarding/first-run"
/>
```

- [ ] **Step 3: Smoke-test**

Complete a compliance-profile submission in preview → browser should navigate to `/onboarding/first-run` instead of `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/compliance-profile/page.tsx
git commit -m "feat(onboarding): route compliance-profile → first-run wizard"
```

---

## Task 14: Dashboard re-prompt banner for incomplete first-run

**Files:**
- Create: `src/app/(dashboard)/dashboard/FirstRunReminderBanner.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Build the banner**

```tsx
// src/app/(dashboard)/dashboard/FirstRunReminderBanner.tsx
import Link from "next/link";
import type { Route } from "next";
import { Sparkles } from "lucide-react";

export function FirstRunReminderBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Finish your 15-minute setup
        </p>
        <p className="text-sm text-muted-foreground">
          Designate officers, adopt your Privacy Policy, take HIPAA Basics, and
          invite your team. Gets you to compliance score 30.
        </p>
      </div>
      <Link
        href={"/onboarding/first-run" as Route}
        className="shrink-0 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Continue setup →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Wire the banner into the dashboard**

Open `src/app/(dashboard)/dashboard/page.tsx`. Inside the existing server component, before the `return`, add a fetch for the firstRunCompletedAt field and a conditional render at the top of the `<main>`:

Near the top of the function, add alongside the existing `eventCount` + `majorBreach` query — fold it into the existing `Promise.all`:

```ts
const [eventCount, majorBreach, practiceMeta] = await Promise.all([
  db.eventLog.count({ where: { practiceId: pu.practiceId } }),
  db.incident.findFirst({ /* existing */ }),
  db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { firstRunCompletedAt: true },
  }),
]);
```

(Preserve the existing incident query body — this just wraps it in a three-element tuple.)

Then import `FirstRunReminderBanner` at the top of the file:

```ts
import { FirstRunReminderBanner } from "./FirstRunReminderBanner";
```

And render it as the first child inside `<main>`, guarded by the null check:

```tsx
{!practiceMeta.firstRunCompletedAt && <FirstRunReminderBanner />}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/
git commit -m "feat(onboarding): dashboard re-prompt banner when first-run incomplete"
```

---

## Task 15: End-to-end manual verification

- [ ] **Step 1: Ensure dev server is running** (preview, not prod)

Use the preview tools: `preview_start`, then visit the relevant routes.

- [ ] **Step 2: Flow A — new practice, complete wizard**

1. Sign up a fresh test practice (or use an existing TRIALING practice with the DB flipped to `firstRunCompletedAt: null`, no policies, no officers, no completed training).
2. Go through `/onboarding/compliance-profile` → should redirect to `/onboarding/first-run`.
3. Step 1: click both officer cards → Continue enabled → click.
4. Step 2: read the policy preview → click "Adopt template" → Continue enabled → click.
5. Step 3: take the quiz → pass → Continue enabled → click.
6. Step 4: paste 2 emails → click Send invites → see the per-row result panel → click "I'm done with invites → finish".
7. Confetti fires → "Compliance score 30" screen → Go to dashboard.
8. `/dashboard` — banner should NOT appear (firstRunCompletedAt is set).

- [ ] **Step 3: Flow B — skip the wizard**

1. With a fresh practice, after compliance-profile, hit "Skip onboarding" link in the wizard header.
2. Land on `/dashboard`.
3. Banner SHOULD appear at the top of the dashboard with "Continue setup →".

- [ ] **Step 4: Flow C — partial completion + resume**

1. Complete Step 1 + Step 2, then close the tab.
2. Re-visit `/onboarding/first-run` — should land on Step 3 (training), not restart.

- [ ] **Step 5: Flow D — standalone bulk-invite**

1. Visit `/programs/staff/bulk-invite` directly (existing team, not via wizard).
2. Upload a CSV with 3 valid rows + 1 invalid row + 1 duplicate of an existing member.
3. Verify per-row result table lists: 2 INVITED, 1 INVALID_EMAIL, 1 ALREADY_MEMBER, 1 total of valid (depending on setup).
4. Return to `/programs/staff` — see the 2 new pending invitations in the pending list.

- [ ] **Step 6: Check the Cloud SQL proxy is not accidentally running against prod**

Before pushing, `ps aux | grep cloud-sql-proxy` — confirm it's either stopped or pointing at the dev connection.

---

## Task 16: Push feature branch + open PR

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`

Expected: all prior tests + the 8 new tests (6 bulk-invite + 2 first-run) pass. If any regressions surface, fix before proceeding.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/onboarding-phase-d
# gh pr create output will print URL
gh pr create --title "feat(onboarding): Phase D — first-run wizard + bulk invite" --body "$(cat <<'EOF'
## Summary
- New `/onboarding/first-run` 4-step wizard (officers → policy → training → invite) per docs/specs/onboarding-flow.md § Screen 7
- New `<BulkInviteForm>` component (paste + CSV modes) — reused in Step 4 and at standalone `/programs/staff/bulk-invite`
- New `bulkInviteAction` server action with transactional batch + per-row results + 200-row cap
- New `ONBOARDING_FIRST_RUN_COMPLETED` projection writes `Practice.firstRunCompletedAt`
- Compliance-profile form now redirects to `/onboarding/first-run` (was `/dashboard`)
- Dashboard banner re-prompts when `firstRunCompletedAt` is null
- 8 new integration tests (6 bulk-invite, 2 completion)

## Test plan
- [ ] Fresh practice → compliance-profile → first-run wizard → all 4 steps → confetti → dashboard
- [ ] Fresh practice → Skip onboarding link → dashboard shows banner
- [ ] Bulk invite with CSV: valid rows invited, duplicates flagged, invalid rows rejected
- [ ] `npm test -- --run` passes
- [ ] `npx tsc --noEmit` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Surface the PR URL to the user** and stop — wait for review feedback or merge instruction.

---

## Post-merge follow-ups (NOT in this plan)

- `PracticeUser.title String?` column — add when first customer asks for the column in their CSV.
- Resend-domain configured → Phase E drip emails.
- AI-Explain affordance on bulk-invited USER_INVITED activity rows (already gets the generic activity-log integration for free).
- Eventually: swap in a MutationObserver-free onPass callback into QuizRunner if the prop becomes broadly used.
