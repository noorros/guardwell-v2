# Audit Prep Wizard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a guided HHS OCR HIPAA audit-prep workflow that walks the practice through 6 high-leverage protocols, pulls live evidence from existing tables, and generates a multi-section PDF packet on demand.

**Architecture:** Two new tables (`AuditPrepSession` + `AuditPrepStep`) + 4 new event types + 3 server actions + page list at `/audit/prep` + per-session page at `/audit/prep/[id]` + PDF generator at `/api/audit/prep/[id]/packet`. Static protocol catalog in `src/lib/audit-prep/protocols.ts` keyed by mode. MVP only registers `HHS_OCR_HIPAA`; OSHA/CMS/DEA modes are scaffolded in the schema enum but not wired to protocols (defer to follow-up PRs).

**Tech Stack:** Next.js 16 App Router, Prisma 5.22, event sourcing per ADR-0001, `@react-pdf/renderer` for the packet (existing pattern in `src/lib/audit/`), Tailwind v4 + Shadcn for UI, vitest for tests.

---

## File Structure

**Create:**
- `src/lib/audit-prep/protocols.ts` — static catalog: `PROTOCOLS_BY_MODE[mode] → ProtocolDef[]`. Each `ProtocolDef` has `code`, `title`, `citation`, `description`, `evidenceLoader` (function name) + `whatWeAttach` (label list shown in UI).
- `src/lib/audit-prep/evidence-loaders.ts` — pure async helpers, one per protocol code: `loadNppEvidence(tx, practiceId)`, `loadWorkforceTrainingEvidence(...)`, etc. Each returns a structured object the UI + PDF can both consume.
- `src/lib/events/projections/auditPrep.ts` — `projectAuditPrepSessionOpened`, `projectAuditPrepStepCompleted`, `projectAuditPrepStepReopened`, `projectAuditPrepPacketGenerated`.
- `src/app/(dashboard)/audit/prep/page.tsx` — list of past sessions + "Start new session" form.
- `src/app/(dashboard)/audit/prep/actions.ts` — `openAuditPrepSessionAction`, `completeStepAction`, `reopenStepAction`.
- `src/app/(dashboard)/audit/prep/[id]/page.tsx` — per-session detail + protocol panels + "Generate packet" CTA.
- `src/app/(dashboard)/audit/prep/[id]/StepPanel.tsx` — client island for one collapsible protocol panel + Mark complete / Reopen buttons.
- `src/lib/audit-prep/packet-pdf.tsx` — `AuditPrepPacketDocument` (@react-pdf/renderer) — cover + per-protocol section.
- `src/app/api/audit/prep/[id]/packet/route.tsx` — GET handler that assembles evidence + renders PDF.
- `tests/integration/audit-prep.test.ts` — opens a session, completes a step, reopens, verifies projections + status transitions.

**Modify:**
- `prisma/schema.prisma` — add 2 new models + 2 new enums + `Practice.auditPrepSessions` back-relation.
- `src/lib/events/registry.ts` — add 4 EVENT_TYPES literals + 4 EVENT_SCHEMAS entries.
- `src/components/gw/AppShell/Sidebar.tsx` — add "Audit Prep" entry under Audit & Insights, after Reports.

**Test:**
- `tests/integration/audit-prep.test.ts`

---

## Task 1: Schema + sync local DB

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma db push --skip-generate`
- Run: `npx prisma generate`

- [ ] **Step 1: Add enums + 2 new models + Practice back-relation**

In `prisma/schema.prisma`, find the `Practice` model relations list (around line 109-114, the block ending with `complianceTrack PracticeTrack?`) and add a new line after `techAssets TechAsset[]`:

```prisma
  auditPrepSessions   AuditPrepSession[]
```

Then append at the end of the file (after the last `}` of `TechAsset`):

```prisma

// ────────────────────────────────────────────────────────────────────────────
// Audit Prep — guided pre-audit workflow per docs/specs/v1-ideas-survey.md §1.1
// ────────────────────────────────────────────────────────────────────────────

enum AuditPrepMode {
  HHS_OCR_HIPAA
  OSHA
  CMS
  DEA
}

enum AuditPrepStatus {
  DRAFT
  IN_PROGRESS
  COMPLETED
}

enum AuditPrepStepStatus {
  PENDING
  COMPLETE
  NOT_APPLICABLE
}

// One audit-prep session per "I just got the audit letter" moment. Mode
// gates which protocols apply; status walks DRAFT → IN_PROGRESS (first
// step touched) → COMPLETED (packet generated).
model AuditPrepSession {
  id              String           @id @default(cuid())
  practiceId      String
  mode            AuditPrepMode
  status          AuditPrepStatus  @default(DRAFT)
  startedByUserId String
  startedAt       DateTime         @default(now())
  completedAt     DateTime?
  // Set when packet is generated. Format: blob URL or signed bucket URL
  // (post-launch). For MVP we just record presence; the actual download
  // re-renders on each /api/audit/prep/[id]/packet request.
  packetGeneratedAt DateTime?

  practice Practice          @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  steps    AuditPrepStep[]

  @@index([practiceId, startedAt])
  @@index([practiceId, status])
}

// One row per protocol within a session. Generated up-front when the
// session opens (one INSERT per ProtocolDef in PROTOCOLS_BY_MODE[mode]).
// `evidenceJson` snapshots the live evidence at completion time so the
// PDF stays stable even if underlying tables change later.
model AuditPrepStep {
  id           String              @id @default(cuid())
  sessionId    String
  code         String              // matches ProtocolDef.code
  title        String              // snapshot at session creation
  status       AuditPrepStepStatus @default(PENDING)
  evidenceJson Json?               // structured evidence captured at completion
  notes        String?             @db.Text
  completedAt  DateTime?
  completedByUserId String?
  createdAt    DateTime            @default(now())

  session AuditPrepSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, code])
  @@index([sessionId, status])
}
```

- [ ] **Step 2: Push schema to local Postgres**

Run: `cd D:/GuardWell/guardwell-v2 && npx prisma db push --skip-generate`

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd D:/GuardWell/guardwell-v2 && npx prisma generate`

Expected: "Generated Prisma Client"

- [ ] **Step 4: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git checkout -b feat/audit-prep-wizard
git add prisma/schema.prisma
git commit -m "schema(audit-prep): AuditPrepSession + AuditPrepStep + enums"
```

---

## Task 2: Event registry + projection

**Files:**
- Modify: `src/lib/events/registry.ts`
- Create: `src/lib/events/projections/auditPrep.ts`

- [ ] **Step 1: Add 4 EventType literals**

In `src/lib/events/registry.ts`, find the `EVENT_TYPES` array and add before `] as const;`:

```ts
  "AUDIT_PREP_SESSION_OPENED",
  "AUDIT_PREP_STEP_COMPLETED",
  "AUDIT_PREP_STEP_REOPENED",
  "AUDIT_PREP_PACKET_GENERATED",
```

- [ ] **Step 2: Add 4 EVENT_SCHEMAS entries**

In the same file, find the closing `} as const;` of `EVENT_SCHEMAS` and add before it:

```ts
  AUDIT_PREP_SESSION_OPENED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      mode: z.enum(["HHS_OCR_HIPAA", "OSHA", "CMS", "DEA"]),
      protocolCount: z.number().int().min(1),
      startedByUserId: z.string().min(1),
    }),
  },
  AUDIT_PREP_STEP_COMPLETED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      stepCode: z.string().min(1),
      status: z.enum(["COMPLETE", "NOT_APPLICABLE"]),
      completedByUserId: z.string().min(1),
      notes: z.string().max(2000).nullable().optional(),
    }),
  },
  AUDIT_PREP_STEP_REOPENED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      stepCode: z.string().min(1),
      reopenedByUserId: z.string().min(1),
    }),
  },
  AUDIT_PREP_PACKET_GENERATED: {
    1: z.object({
      auditPrepSessionId: z.string().min(1),
      generatedByUserId: z.string().min(1),
    }),
  },
```

- [ ] **Step 3: Implement projection module**

Create `src/lib/events/projections/auditPrep.ts`:

```ts
// src/lib/events/projections/auditPrep.ts
//
// Projections for Audit Prep lifecycle:
//   AUDIT_PREP_SESSION_OPENED   → INSERT session row + N AuditPrepStep rows
//   AUDIT_PREP_STEP_COMPLETED   → UPDATE step status + evidenceJson + notes
//   AUDIT_PREP_STEP_REOPENED    → UPDATE step status back to PENDING
//   AUDIT_PREP_PACKET_GENERATED → set session.packetGeneratedAt + status=COMPLETED

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";

type SessionOpenedPayload = PayloadFor<"AUDIT_PREP_SESSION_OPENED", 1>;
type StepCompletedPayload = PayloadFor<"AUDIT_PREP_STEP_COMPLETED", 1>;
type StepReopenedPayload = PayloadFor<"AUDIT_PREP_STEP_REOPENED", 1>;
type PacketGeneratedPayload = PayloadFor<"AUDIT_PREP_PACKET_GENERATED", 1>;

export async function projectAuditPrepSessionOpened(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: SessionOpenedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const protocols = PROTOCOLS_BY_MODE[payload.mode];
  if (!protocols || protocols.length === 0) {
    throw new Error(
      `AUDIT_PREP_SESSION_OPENED refused: no protocols registered for mode ${payload.mode}`,
    );
  }
  await tx.auditPrepSession.create({
    data: {
      id: payload.auditPrepSessionId,
      practiceId,
      mode: payload.mode,
      status: "DRAFT",
      startedByUserId: payload.startedByUserId,
    },
  });
  for (const p of protocols) {
    await tx.auditPrepStep.create({
      data: {
        sessionId: payload.auditPrepSessionId,
        code: p.code,
        title: p.title,
        status: "PENDING",
      },
    });
  }
}

export async function projectAuditPrepStepCompleted(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    payload: StepCompletedPayload;
    evidenceJson: Prisma.InputJsonValue | null;
  },
): Promise<void> {
  const { payload, evidenceJson } = args;
  await tx.auditPrepStep.update({
    where: {
      sessionId_code: {
        sessionId: payload.auditPrepSessionId,
        code: payload.stepCode,
      },
    },
    data: {
      status: payload.status,
      evidenceJson: evidenceJson ?? undefined,
      notes: payload.notes ?? null,
      completedAt: new Date(),
      completedByUserId: payload.completedByUserId,
    },
  });
  // Bump session status to IN_PROGRESS on first step touched.
  await tx.auditPrepSession.update({
    where: { id: payload.auditPrepSessionId },
    data: { status: "IN_PROGRESS" },
  });
}

export async function projectAuditPrepStepReopened(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: StepReopenedPayload },
): Promise<void> {
  const { payload } = args;
  await tx.auditPrepStep.update({
    where: {
      sessionId_code: {
        sessionId: payload.auditPrepSessionId,
        code: payload.stepCode,
      },
    },
    data: {
      status: "PENDING",
      evidenceJson: undefined,
      notes: null,
      completedAt: null,
      completedByUserId: null,
    },
  });
}

export async function projectAuditPrepPacketGenerated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: PacketGeneratedPayload },
): Promise<void> {
  const { payload } = args;
  const now = new Date();
  await tx.auditPrepSession.update({
    where: { id: payload.auditPrepSessionId },
    data: {
      packetGeneratedAt: now,
      status: "COMPLETED",
      completedAt: now,
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add src/lib/events/registry.ts src/lib/events/projections/auditPrep.ts
git commit -m "events(audit-prep): 4 events + projections"
```

---

## Task 3: Protocol catalog + evidence loaders

**Files:**
- Create: `src/lib/audit-prep/protocols.ts`
- Create: `src/lib/audit-prep/evidence-loaders.ts`

- [ ] **Step 1: Implement evidence loaders**

Create `src/lib/audit-prep/evidence-loaders.ts`:

```ts
// src/lib/audit-prep/evidence-loaders.ts
//
// Pure async loaders that snapshot live compliance evidence into
// structured objects. Called when a step is marked complete. The output
// is persisted in AuditPrepStep.evidenceJson so the PDF stays stable
// even if underlying tables change later.

import type { Prisma } from "@prisma/client";

export interface EvidenceSnapshotBase {
  capturedAt: string; // ISO
}

export interface NppEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  lastReviewedAt: string | null;
  versionNumber: number | null;
}

export interface WorkforceTrainingEvidence extends EvidenceSnapshotBase {
  totalActiveStaff: number;
  trainedStaff: number;
  coveragePct: number;
  expiringWithin60Days: number;
}

export interface RiskAnalysisEvidence extends EvidenceSnapshotBase {
  latestSraCompletedAt: string | null;
  latestSraScore: number | null;
  isFresh: boolean; // ≤365 days
  phiAssetCount: number;
}

export interface RiskManagementEvidence extends EvidenceSnapshotBase {
  unresolvedBreachCount: number;
  openIncidentCount: number;
  resolvedBreachCount: number;
}

export interface SanctionsPolicyEvidence extends EvidenceSnapshotBase {
  // V2 doesn't have a dedicated sanctions table; use OIG framework
  // requirements as a proxy + privacy-officer designation as the
  // accountability anchor.
  privacyOfficerDesignated: boolean;
  oigFrameworkEnabled: boolean;
  oigComplianceCurrentPct: number | null; // PracticeFramework.scoreCache for OIG
}

export interface ContingencyPlanEvidence extends EvidenceSnapshotBase {
  // Composite from Breach Response policy + asset-inventory presence.
  breachResponsePolicyAdopted: boolean;
  totalAssetsTracked: number;
  phiAssetsWithEncryption: number;
}

export type EvidenceSnapshot =
  | NppEvidence
  | WorkforceTrainingEvidence
  | RiskAnalysisEvidence
  | RiskManagementEvidence
  | SanctionsPolicyEvidence
  | ContingencyPlanEvidence;

const DAY_MS = 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * DAY_MS;

export async function loadNppEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<NppEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "HIPAA_NPP_POLICY",
      },
    },
    select: {
      adoptedAt: true,
      lastReviewedAt: true,
      version: true,
      retiredAt: true,
    },
  });
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    lastReviewedAt: policy?.lastReviewedAt?.toISOString() ?? null,
    versionNumber: policy?.version ?? null,
  };
}

export async function loadWorkforceTrainingEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<WorkforceTrainingEvidence> {
  const totalActiveStaff = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  const completions = await tx.trainingCompletion.findMany({
    where: { practiceId, passed: true },
    select: { userId: true, expiresAt: true, course: { select: { code: true } } },
  });
  const hipaaBasicsCompletions = completions.filter(
    (c) => c.course.code === "HIPAA_BASICS",
  );
  const trainedStaff = new Set(hipaaBasicsCompletions.map((c) => c.userId)).size;
  const coveragePct =
    totalActiveStaff === 0
      ? 0
      : Math.round((trainedStaff / totalActiveStaff) * 100);
  const horizon = new Date(Date.now() + SIXTY_DAYS_MS);
  const expiringWithin60Days = completions.filter(
    (c) => c.expiresAt < horizon,
  ).length;
  return {
    capturedAt: new Date().toISOString(),
    totalActiveStaff,
    trainedStaff,
    coveragePct,
    expiringWithin60Days,
  };
}

export async function loadRiskAnalysisEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<RiskAnalysisEvidence> {
  const latestSra = await tx.practiceSraAssessment.findFirst({
    where: { practiceId, isDraft: false, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true, overallScore: true },
  });
  const phiAssetCount = await tx.techAsset.count({
    where: { practiceId, processesPhi: true, retiredAt: null },
  });
  const isFresh =
    latestSra?.completedAt !== null &&
    latestSra?.completedAt !== undefined &&
    Date.now() - latestSra.completedAt.getTime() < 365 * DAY_MS;
  return {
    capturedAt: new Date().toISOString(),
    latestSraCompletedAt: latestSra?.completedAt?.toISOString() ?? null,
    latestSraScore: latestSra?.overallScore ?? null,
    isFresh,
    phiAssetCount,
  };
}

export async function loadRiskManagementEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<RiskManagementEvidence> {
  const [unresolvedBreachCount, openIncidentCount, resolvedBreachCount] =
    await Promise.all([
      tx.incident.count({
        where: { practiceId, isBreach: true, resolvedAt: null },
      }),
      tx.incident.count({
        where: {
          practiceId,
          status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
        },
      }),
      tx.incident.count({
        where: { practiceId, isBreach: true, resolvedAt: { not: null } },
      }),
    ]);
  return {
    capturedAt: new Date().toISOString(),
    unresolvedBreachCount,
    openIncidentCount,
    resolvedBreachCount,
  };
}

export async function loadSanctionsPolicyEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<SanctionsPolicyEvidence> {
  const privacyOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isPrivacyOfficer: true, removedAt: null },
    select: { id: true },
  });
  const oigFw = await tx.regulatoryFramework.findUnique({
    where: { code: "OIG" },
    select: { id: true },
  });
  let oigEnabled = false;
  let oigScore: number | null = null;
  if (oigFw) {
    const pf = await tx.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: { practiceId, frameworkId: oigFw.id },
      },
      select: { enabled: true, scoreCache: true },
    });
    oigEnabled = pf?.enabled ?? false;
    oigScore = pf?.scoreCache ?? null;
  }
  return {
    capturedAt: new Date().toISOString(),
    privacyOfficerDesignated: !!privacyOfficer,
    oigFrameworkEnabled: oigEnabled,
    oigComplianceCurrentPct: oigScore,
  };
}

export async function loadContingencyPlanEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<ContingencyPlanEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "HIPAA_BREACH_RESPONSE_POLICY",
      },
    },
    select: { retiredAt: true },
  });
  const totalAssetsTracked = await tx.techAsset.count({
    where: { practiceId, retiredAt: null },
  });
  const phiAssetsWithEncryption = await tx.techAsset.count({
    where: {
      practiceId,
      retiredAt: null,
      processesPhi: true,
      encryption: { in: ["FULL_DISK", "FIELD_LEVEL"] },
    },
  });
  return {
    capturedAt: new Date().toISOString(),
    breachResponsePolicyAdopted: !!policy && policy.retiredAt === null,
    totalAssetsTracked,
    phiAssetsWithEncryption,
  };
}

export const EVIDENCE_LOADERS: Record<
  string,
  (tx: Prisma.TransactionClient, practiceId: string) => Promise<EvidenceSnapshot>
> = {
  NPP_DELIVERY: loadNppEvidence,
  WORKFORCE_TRAINING: loadWorkforceTrainingEvidence,
  RISK_ANALYSIS: loadRiskAnalysisEvidence,
  RISK_MANAGEMENT: loadRiskManagementEvidence,
  SANCTIONS_POLICY: loadSanctionsPolicyEvidence,
  CONTINGENCY_PLAN: loadContingencyPlanEvidence,
};
```

- [ ] **Step 2: Implement protocol catalog**

Create `src/lib/audit-prep/protocols.ts`:

```ts
// src/lib/audit-prep/protocols.ts
//
// Static catalog of audit-prep protocols, keyed by AuditPrepMode. Each
// ProtocolDef declares which evidence loader runs at completion + a
// human-readable "what we'll attach" summary shown in the UI.
//
// MVP: only HHS_OCR_HIPAA is registered. OSHA/CMS/DEA are stubbed out
// to throw at session creation if selected — that prevents accidental
// activation before the protocols are filled in.

export interface ProtocolDef {
  code: string;
  title: string;
  citation: string;
  description: string;
  // String key into EVIDENCE_LOADERS map.
  evidenceLoaderCode: string;
  // Bullets shown under "What we'll attach to the packet" in the UI.
  whatWeAttach: string[];
}

const HHS_OCR_HIPAA_PROTOCOLS: ProtocolDef[] = [
  {
    code: "NPP_DELIVERY",
    title: "Notice of Privacy Practices delivery",
    citation: "45 CFR §164.520",
    description:
      "OCR auditors verify that the practice has adopted, posted, and provided the NPP. They look for: a current adopted version, a posting strategy, and acknowledgment from new patients.",
    evidenceLoaderCode: "NPP_DELIVERY",
    whatWeAttach: [
      "NPP adoption status + date",
      "Last review date (annual review cadence)",
      "Adopted version number",
    ],
  },
  {
    code: "WORKFORCE_TRAINING",
    title: "Workforce HIPAA training",
    citation: "45 CFR §164.530(b)(1)",
    description:
      "OCR verifies that all workforce members have completed HIPAA training. Look for ≥95% coverage, with completions within the last 12 months.",
    evidenceLoaderCode: "WORKFORCE_TRAINING",
    whatWeAttach: [
      "Active staff count",
      "HIPAA Basics completion count + coverage %",
      "Completions expiring within 60 days",
    ],
  },
  {
    code: "RISK_ANALYSIS",
    title: "Security Risk Analysis (SRA)",
    citation: "45 CFR §164.308(a)(1)(ii)(A)",
    description:
      "OCR's most-cited finding is missing or stale risk analysis. Look for a completed SRA within the last 12 months AND an asset inventory that identifies PHI-processing systems.",
    evidenceLoaderCode: "RISK_ANALYSIS",
    whatWeAttach: [
      "Latest SRA completion date + score",
      "SRA freshness (within 365 days?)",
      "PHI-processing asset count",
    ],
  },
  {
    code: "RISK_MANAGEMENT",
    title: "Risk management + incident response",
    citation: "45 CFR §164.308(a)(1)(ii)(B) + §164.308(a)(6)",
    description:
      "OCR verifies that identified risks are tracked through resolution. Look for an incident log + breach determinations + resolution evidence.",
    evidenceLoaderCode: "RISK_MANAGEMENT",
    whatWeAttach: [
      "Unresolved breach count",
      "Open incident count (open + under investigation)",
      "Resolved breach count (historical)",
    ],
  },
  {
    code: "SANCTIONS_POLICY",
    title: "Sanctions policy + exclusion screening",
    citation: "45 CFR §164.530(e) + 42 CFR §1003 (OIG)",
    description:
      "OCR + OIG verify that the practice has a sanctions policy for workforce violations + screens against the federal exclusion list. Look for a designated Privacy Officer + OIG framework adoption.",
    evidenceLoaderCode: "SANCTIONS_POLICY",
    whatWeAttach: [
      "Privacy Officer designation status",
      "OIG framework enabled?",
      "OIG compliance score",
    ],
  },
  {
    code: "CONTINGENCY_PLAN",
    title: "Contingency plan + breach response",
    citation: "45 CFR §164.308(a)(7)",
    description:
      "OCR verifies that the practice can respond to system disruption + a breach. Look for a Breach Response policy + an asset inventory with encryption status.",
    evidenceLoaderCode: "CONTINGENCY_PLAN",
    whatWeAttach: [
      "Breach Response policy adoption status",
      "Total tracked assets",
      "PHI assets with encryption coverage",
    ],
  },
];

export const PROTOCOLS_BY_MODE: Record<string, ProtocolDef[]> = {
  HHS_OCR_HIPAA: HHS_OCR_HIPAA_PROTOCOLS,
  // OSHA, CMS, DEA stubbed — projection refuses to open a session until
  // the catalog is populated. Per docs/specs/v1-ideas-survey.md §1.1
  // these ship in follow-up PRs.
};
```

- [ ] **Step 3: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add src/lib/audit-prep/
git commit -m "feat(audit-prep): protocol catalog + evidence loaders for HHS_OCR_HIPAA"
```

---

## Task 4: Server actions

**Files:**
- Create: `src/app/(dashboard)/audit/prep/actions.ts`

- [ ] **Step 1: Implement actions**

Create `src/app/(dashboard)/audit/prep/actions.ts`:

```ts
// src/app/(dashboard)/audit/prep/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAuditPrepSessionOpened,
  projectAuditPrepStepCompleted,
  projectAuditPrepStepReopened,
} from "@/lib/events/projections/auditPrep";
import {
  PROTOCOLS_BY_MODE,
  type ProtocolDef,
} from "@/lib/audit-prep/protocols";
import { EVIDENCE_LOADERS } from "@/lib/audit-prep/evidence-loaders";

const OpenInput = z.object({
  mode: z.enum(["HHS_OCR_HIPAA", "OSHA", "CMS", "DEA"]),
});

export async function openAuditPrepSessionAction(
  input: z.infer<typeof OpenInput>,
): Promise<{ auditPrepSessionId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = OpenInput.parse(input);

  const protocols: ProtocolDef[] | undefined =
    PROTOCOLS_BY_MODE[parsed.mode];
  if (!protocols || protocols.length === 0) {
    throw new Error(
      `Audit Prep mode ${parsed.mode} is not yet available. Pick HHS_OCR_HIPAA.`,
    );
  }

  const auditPrepSessionId = randomUUID();
  const payload = {
    auditPrepSessionId,
    mode: parsed.mode,
    protocolCount: protocols.length,
    startedByUserId: user.id,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "AUDIT_PREP_SESSION_OPENED",
      payload,
    },
    async (tx) =>
      projectAuditPrepSessionOpened(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/audit/prep");
  return { auditPrepSessionId };
}

const CompleteInput = z.object({
  auditPrepSessionId: z.string().min(1),
  stepCode: z.string().min(1),
  status: z.enum(["COMPLETE", "NOT_APPLICABLE"]),
  notes: z.string().max(2000).optional(),
});

export async function completeStepAction(
  input: z.infer<typeof CompleteInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = CompleteInput.parse(input);

  const session = await db.auditPrepSession.findUnique({
    where: { id: parsed.auditPrepSessionId },
    select: { practiceId: true },
  });
  if (!session || session.practiceId !== pu.practiceId) {
    throw new Error("Audit Prep session not found");
  }

  // Only snapshot evidence on COMPLETE; NOT_APPLICABLE skips the loader.
  let evidenceJson: Record<string, unknown> | null = null;
  if (parsed.status === "COMPLETE") {
    const protocols = await db.auditPrepStep.findMany({
      where: {
        sessionId: parsed.auditPrepSessionId,
        code: parsed.stepCode,
      },
      select: { code: true },
    });
    if (protocols.length === 0) {
      throw new Error(
        `Step ${parsed.stepCode} not found in session ${parsed.auditPrepSessionId}`,
      );
    }
    const loader = EVIDENCE_LOADERS[parsed.stepCode];
    if (loader) {
      evidenceJson = (await db.$transaction(async (tx) =>
        loader(tx, pu.practiceId),
      )) as unknown as Record<string, unknown>;
    }
  }

  const payload = {
    auditPrepSessionId: parsed.auditPrepSessionId,
    stepCode: parsed.stepCode,
    status: parsed.status,
    completedByUserId: user.id,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "AUDIT_PREP_STEP_COMPLETED",
      payload,
    },
    async (tx) =>
      projectAuditPrepStepCompleted(tx, {
        practiceId: pu.practiceId,
        payload,
        evidenceJson: evidenceJson as never,
      }),
  );

  revalidatePath("/audit/prep");
  revalidatePath(`/audit/prep/${parsed.auditPrepSessionId}`);
}

const ReopenInput = z.object({
  auditPrepSessionId: z.string().min(1),
  stepCode: z.string().min(1),
});

export async function reopenStepAction(
  input: z.infer<typeof ReopenInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = ReopenInput.parse(input);

  const session = await db.auditPrepSession.findUnique({
    where: { id: parsed.auditPrepSessionId },
    select: { practiceId: true },
  });
  if (!session || session.practiceId !== pu.practiceId) {
    throw new Error("Audit Prep session not found");
  }

  const payload = {
    auditPrepSessionId: parsed.auditPrepSessionId,
    stepCode: parsed.stepCode,
    reopenedByUserId: user.id,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "AUDIT_PREP_STEP_REOPENED",
      payload,
    },
    async (tx) =>
      projectAuditPrepStepReopened(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath(`/audit/prep/${parsed.auditPrepSessionId}`);
}
```

- [ ] **Step 2: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add "src/app/(dashboard)/audit/prep/actions.ts"
git commit -m "feat(audit-prep): server actions for open/complete/reopen"
```

---

## Task 5: Integration tests

**Files:**
- Create: `tests/integration/audit-prep.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/integration/audit-prep.test.ts`:

```ts
// tests/integration/audit-prep.test.ts
//
// End-to-end coverage for Audit Prep lifecycle: open a session, verify
// 6 steps created; complete a step, verify evidence snapshot stored +
// session status flips IN_PROGRESS; reopen a step, verify status reset
// + evidence cleared.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAuditPrepSessionOpened,
  projectAuditPrepStepCompleted,
  projectAuditPrepStepReopened,
} from "@/lib/events/projections/auditPrep";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `aprep-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Audit Prep Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("Audit Prep lifecycle", () => {
  it("AUDIT_PREP_SESSION_OPENED creates the session + 6 protocol steps", async () => {
    const { user, practice } = await seed();
    const auditPrepSessionId = "test-session-1";
    const protocolCount = PROTOCOLS_BY_MODE.HHS_OCR_HIPAA!.length;
    const payload = {
      auditPrepSessionId,
      mode: "HHS_OCR_HIPAA" as const,
      protocolCount,
      startedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_SESSION_OPENED",
        payload,
      },
      async (tx) =>
        projectAuditPrepSessionOpened(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const session = await db.auditPrepSession.findUniqueOrThrow({
      where: { id: auditPrepSessionId },
      include: { steps: true },
    });
    expect(session.mode).toBe("HHS_OCR_HIPAA");
    expect(session.status).toBe("DRAFT");
    expect(session.steps).toHaveLength(protocolCount);
    expect(session.steps.every((s) => s.status === "PENDING")).toBe(true);
  });

  it("AUDIT_PREP_STEP_COMPLETED stores evidence + flips session to IN_PROGRESS", async () => {
    const { user, practice } = await seed();
    const auditPrepSessionId = "test-session-2";
    const protocolCount = PROTOCOLS_BY_MODE.HHS_OCR_HIPAA!.length;
    const openPayload = {
      auditPrepSessionId,
      mode: "HHS_OCR_HIPAA" as const,
      protocolCount,
      startedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_SESSION_OPENED",
        payload: openPayload,
      },
      async (tx) =>
        projectAuditPrepSessionOpened(tx, {
          practiceId: practice.id,
          payload: openPayload,
        }),
    );

    const completePayload = {
      auditPrepSessionId,
      stepCode: "NPP_DELIVERY",
      status: "COMPLETE" as const,
      completedByUserId: user.id,
      notes: "NPP posted 2026-01-01",
    };
    const evidenceJson = {
      capturedAt: new Date().toISOString(),
      policyAdopted: false,
      adoptedAt: null,
      lastReviewedAt: null,
      versionNumber: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_STEP_COMPLETED",
        payload: completePayload,
      },
      async (tx) =>
        projectAuditPrepStepCompleted(tx, {
          practiceId: practice.id,
          payload: completePayload,
          evidenceJson,
        }),
    );
    const session = await db.auditPrepSession.findUniqueOrThrow({
      where: { id: auditPrepSessionId },
      include: { steps: true },
    });
    expect(session.status).toBe("IN_PROGRESS");
    const nppStep = session.steps.find((s) => s.code === "NPP_DELIVERY");
    expect(nppStep?.status).toBe("COMPLETE");
    expect(nppStep?.notes).toBe("NPP posted 2026-01-01");
    expect(nppStep?.evidenceJson).toMatchObject({ policyAdopted: false });
  });

  it("AUDIT_PREP_STEP_REOPENED resets status + clears evidence", async () => {
    const { user, practice } = await seed();
    const auditPrepSessionId = "test-session-3";
    const protocolCount = PROTOCOLS_BY_MODE.HHS_OCR_HIPAA!.length;
    const openPayload = {
      auditPrepSessionId,
      mode: "HHS_OCR_HIPAA" as const,
      protocolCount,
      startedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_SESSION_OPENED",
        payload: openPayload,
      },
      async (tx) =>
        projectAuditPrepSessionOpened(tx, {
          practiceId: practice.id,
          payload: openPayload,
        }),
    );
    const completePayload = {
      auditPrepSessionId,
      stepCode: "NPP_DELIVERY",
      status: "COMPLETE" as const,
      completedByUserId: user.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_STEP_COMPLETED",
        payload: completePayload,
      },
      async (tx) =>
        projectAuditPrepStepCompleted(tx, {
          practiceId: practice.id,
          payload: completePayload,
          evidenceJson: { capturedAt: new Date().toISOString() } as never,
        }),
    );

    const reopenPayload = {
      auditPrepSessionId,
      stepCode: "NPP_DELIVERY",
      reopenedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "AUDIT_PREP_STEP_REOPENED",
        payload: reopenPayload,
      },
      async (tx) =>
        projectAuditPrepStepReopened(tx, {
          practiceId: practice.id,
          payload: reopenPayload,
        }),
    );
    const step = await db.auditPrepStep.findFirstOrThrow({
      where: { sessionId: auditPrepSessionId, code: "NPP_DELIVERY" },
    });
    expect(step.status).toBe("PENDING");
    expect(step.evidenceJson).toBeNull();
    expect(step.completedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd D:/GuardWell/guardwell-v2 && npx vitest run tests/integration/audit-prep.test.ts`

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add tests/integration/audit-prep.test.ts
git commit -m "test(audit-prep): lifecycle integration tests"
```

---

## Task 6: List + per-session pages + client island

**Files:**
- Create: `src/app/(dashboard)/audit/prep/page.tsx`
- Create: `src/app/(dashboard)/audit/prep/[id]/page.tsx`
- Create: `src/app/(dashboard)/audit/prep/[id]/StepPanel.tsx`

- [ ] **Step 1: Implement the list page**

Create `src/app/(dashboard)/audit/prep/page.tsx`:

```tsx
// src/app/(dashboard)/audit/prep/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/gw/EmptyState";
import { StartSessionForm } from "./StartSessionForm";

export const metadata = { title: "Audit Prep · Audit & Insights" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "var(--gw-color-setup)",
  IN_PROGRESS: "var(--gw-color-needs)",
  COMPLETED: "var(--gw-color-compliant)",
};

export default async function AuditPrepPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const sessions = await db.auditPrepSession.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { startedAt: "desc" },
    include: { steps: { select: { status: true } } },
    take: 20,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Audit Prep" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Prep</h1>
          <p className="text-sm text-muted-foreground">
            Guided pre-audit walkthrough. Pick the audit type, work through
            the protocols, then download a packet to send your auditor or
            outside counsel. Evidence is snapshotted at completion so the
            packet stays stable even if your data changes later.
          </p>
        </div>
      </header>

      <StartSessionForm />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Past sessions
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          </div>
          {sessions.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No audit-prep sessions yet"
              description="Start a session above when you receive an audit notice or want to validate readiness ahead of one."
            />
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => {
                const completed = s.steps.filter(
                  (st) => st.status !== "PENDING",
                ).length;
                const total = s.steps.length;
                const pct =
                  total === 0 ? 0 : Math.round((completed / total) * 100);
                return (
                  <li key={s.id} className="space-y-1 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/audit/prep/${s.id}` as Route}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {s.mode.replace(/_/g, " ")} ·{" "}
                        {s.startedAt.toISOString().slice(0, 10)}
                      </Link>
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{
                          color: STATUS_TONE[s.status] ?? "var(--gw-color-setup)",
                          borderColor:
                            STATUS_TONE[s.status] ?? "var(--gw-color-setup)",
                        }}
                      >
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {completed} of {total} protocols touched · {pct}%
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Implement the start-session client island**

Create `src/app/(dashboard)/audit/prep/StartSessionForm.tsx`:

```tsx
// src/app/(dashboard)/audit/prep/StartSessionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openAuditPrepSessionAction } from "./actions";

export function StartSessionForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"HHS_OCR_HIPAA" | "OSHA" | "CMS" | "DEA">(
    "HHS_OCR_HIPAA",
  );

  const handleStart = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { auditPrepSessionId } = await openAuditPrepSessionAction({
          mode,
        });
        router.push(`/audit/prep/${auditPrepSessionId}` as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open session.");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Start a new session</h2>
        <p className="text-xs text-muted-foreground">
          Pick the audit type. Only HHS OCR HIPAA is wired up for v1; OSHA /
          CMS / DEA modes ship in follow-up PRs.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 space-y-1 text-xs font-medium text-foreground">
            Audit type
            <select
              value={mode}
              onChange={(e) =>
                setMode(
                  e.target.value as "HHS_OCR_HIPAA" | "OSHA" | "CMS" | "DEA",
                )
              }
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="HHS_OCR_HIPAA">HHS OCR HIPAA</option>
              <option value="OSHA" disabled>
                OSHA (coming soon)
              </option>
              <option value="CMS" disabled>
                CMS (coming soon)
              </option>
              <option value="DEA" disabled>
                DEA (coming soon)
              </option>
            </select>
          </label>
          <Button onClick={handleStart} size="sm" disabled={isPending}>
            {isPending ? "Opening…" : "Start session"}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Implement the per-session detail page**

Create `src/app/(dashboard)/audit/prep/[id]/page.tsx`:

```tsx
// src/app/(dashboard)/audit/prep/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck, Download } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";
import { StepPanel } from "./StepPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Prep session" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AuditPrepDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;
  const session = await db.auditPrepSession.findUnique({
    where: { id },
    include: { steps: { orderBy: { code: "asc" } } },
  });
  if (!session || session.practiceId !== pu.practiceId) notFound();
  const protocols = PROTOCOLS_BY_MODE[session.mode] ?? [];

  const completedCount = session.steps.filter(
    (s) => s.status !== "PENDING",
  ).length;
  const total = session.steps.length;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  const allDone =
    total > 0 && session.steps.every((s) => s.status !== "PENDING");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "Audit & Insights" },
          { label: "Audit Prep", href: "/audit/prep" as Route },
          { label: session.startedAt.toISOString().slice(0, 10) },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.mode.replace(/_/g, " ")} audit prep
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {session.status.replace(/_/g, " ")}
            </Badge>
            <span>Started {session.startedAt.toISOString().slice(0, 10)}</span>
            {session.packetGeneratedAt && (
              <span>
                Packet generated{" "}
                {session.packetGeneratedAt.toISOString().slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        <ScoreRing score={pct} size={64} strokeWidth={7} assessed />
      </header>

      <ul className="space-y-3">
        {protocols.map((p) => {
          const step = session.steps.find((s) => s.code === p.code);
          if (!step) return null;
          return (
            <li key={p.code}>
              <StepPanel
                sessionId={session.id}
                stepCode={p.code}
                title={p.title}
                citation={p.citation}
                description={p.description}
                whatWeAttach={p.whatWeAttach}
                status={step.status}
                notes={step.notes}
                completedAtIso={step.completedAt?.toISOString() ?? null}
              />
            </li>
          );
        })}
      </ul>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Generate audit packet</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {allDone
                ? "All protocols touched. Download the packet to send to your auditor or outside counsel."
                : `Complete ${total - completedCount} more protocol${
                    total - completedCount === 1 ? "" : "s"
                  } to enable packet generation.`}
            </p>
          </div>
          <Link
            href={`/api/audit/prep/${session.id}/packet` as Route}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              allDone
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
            aria-disabled={!allDone}
            onClick={(e) => {
              if (!allDone) e.preventDefault();
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download packet
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Implement the StepPanel client island**

Create `src/app/(dashboard)/audit/prep/[id]/StepPanel.tsx`:

```tsx
// src/app/(dashboard)/audit/prep/[id]/StepPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeStepAction, reopenStepAction } from "../actions";

export interface StepPanelProps {
  sessionId: string;
  stepCode: string;
  title: string;
  citation: string;
  description: string;
  whatWeAttach: string[];
  status: "PENDING" | "COMPLETE" | "NOT_APPLICABLE";
  notes: string | null;
  completedAtIso: string | null;
}

export function StepPanel({
  sessionId,
  stepCode,
  title,
  citation,
  description,
  whatWeAttach,
  status,
  notes: initialNotes,
  completedAtIso,
}: StepPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNotes ?? "");

  const handleComplete = (newStatus: "COMPLETE" | "NOT_APPLICABLE") => {
    setError(null);
    startTransition(async () => {
      try {
        await completeStepAction({
          auditPrepSessionId: sessionId,
          stepCode,
          status: newStatus,
          notes: notes.trim() || undefined,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const handleReopen = () => {
    setError(null);
    startTransition(async () => {
      try {
        await reopenStepAction({
          auditPrepSessionId: sessionId,
          stepCode,
        });
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const isDone = status !== "PENDING";

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              <Badge variant="outline" className="text-[10px]">
                {citation}
              </Badge>
              {isDone && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color:
                      status === "COMPLETE"
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-setup)",
                    borderColor:
                      status === "COMPLETE"
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-setup)",
                  }}
                >
                  {status === "COMPLETE" ? "Complete" : "N/A"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-[11px]">
          <p className="font-medium text-foreground">
            What we&apos;ll attach to the packet
          </p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {whatWeAttach.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {!isDone ? (
          <>
            <label className="block text-[11px] font-medium text-foreground">
              Notes (optional, included in packet)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            </label>
            {error && (
              <p className="text-[11px] text-[color:var(--gw-color-risk)]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleComplete("NOT_APPLICABLE")}
                disabled={isPending}
              >
                Mark N/A
              </Button>
              <Button
                size="sm"
                onClick={() => handleComplete("COMPLETE")}
                disabled={isPending}
              >
                {isPending ? "Saving…" : "Mark complete"}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-end justify-between gap-3 text-[11px] text-muted-foreground">
            <div>
              {completedAtIso && (
                <p>Completed {completedAtIso.slice(0, 10)}</p>
              )}
              {notes && (
                <p className="mt-1">
                  <span className="font-medium text-foreground">Notes:</span>{" "}
                  {notes}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReopen}
              disabled={isPending}
              className="text-[10px]"
            >
              Reopen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add "src/app/(dashboard)/audit/prep/"
git commit -m "feat(audit-prep): list page + per-session page + step panel"
```

---

## Task 7: PDF generator + API route

**Files:**
- Create: `src/lib/audit-prep/packet-pdf.tsx`
- Create: `src/app/api/audit/prep/[id]/packet/route.tsx`

- [ ] **Step 1: Implement the PDF document**

Create `src/lib/audit-prep/packet-pdf.tsx`:

```tsx
// src/lib/audit-prep/packet-pdf.tsx
//
// Multi-section audit-prep packet PDF. Cover page + one section per
// completed protocol. Notes are included verbatim. Evidence is rendered
// from the snapshotted JSON so the packet matches what was on screen
// when the protocol was marked complete.

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  coverTitle: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 6,
  },
  coverSubtitle: { fontSize: 12, color: "#64748B", marginBottom: 28 },
  meta: { fontSize: 10, color: "#475569", marginBottom: 3 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 18,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  citation: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 6,
    fontStyle: "italic",
  },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  evidenceLabel: { fontSize: 9, color: "#475569", fontWeight: "bold" },
  evidenceValue: { fontSize: 10, marginLeft: 4, marginBottom: 3 },
  notesBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 2,
    borderLeftColor: "#94A3B8",
    fontSize: 9,
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

export interface PacketSectionInput {
  code: string;
  title: string;
  citation: string;
  description: string;
  evidenceJson: Record<string, unknown> | null;
  notes: string | null;
  status: "COMPLETE" | "NOT_APPLICABLE";
}

export interface AuditPrepPacketInput {
  practiceName: string;
  practiceState: string;
  mode: string;
  startedAt: Date;
  generatedAt: Date;
  sections: PacketSectionInput[];
}

export function AuditPrepPacketDocument({
  input,
}: {
  input: AuditPrepPacketInput;
}) {
  return (
    <Document
      title={`${input.mode.replace(/_/g, " ")} audit-prep packet — ${input.practiceName}`}
      author="GuardWell"
      subject="Audit prep packet"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.coverTitle}>Audit-Prep Packet</Text>
        <Text style={s.coverSubtitle}>
          {input.mode.replace(/_/g, " ")} · {input.practiceName} ·{" "}
          {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Started {input.startedAt.toISOString().slice(0, 10)}
        </Text>
        <Text style={s.meta}>
          Generated {input.generatedAt.toISOString().slice(0, 10)}
        </Text>
        <Text style={s.meta}>{input.sections.length} sections</Text>
        <Text style={s.footer} fixed>
          GuardWell — Audit-Prep Packet · Confidential
        </Text>
      </Page>

      {input.sections.map((sec) => (
        <Page key={sec.code} size="LETTER" style={s.page}>
          <Text style={s.sectionTitle}>
            {sec.title}{" "}
            {sec.status === "NOT_APPLICABLE" ? "(N/A)" : ""}
          </Text>
          <Text style={s.citation}>{sec.citation}</Text>
          <Text style={s.paragraph}>{sec.description}</Text>

          {sec.status === "COMPLETE" && sec.evidenceJson && (
            <View>
              <Text style={s.evidenceLabel}>Evidence snapshot</Text>
              {Object.entries(sec.evidenceJson).map(([k, v]) => (
                <Text key={k} style={s.evidenceValue}>
                  • {k}: {String(v)}
                </Text>
              ))}
            </View>
          )}

          {sec.notes && (
            <View style={s.notesBox}>
              <Text style={s.evidenceLabel}>Notes</Text>
              <Text>{sec.notes}</Text>
            </View>
          )}

          <Text style={s.footer} fixed>
            GuardWell — Audit-Prep Packet · Confidential
          </Text>
        </Page>
      ))}
    </Document>
  );
}
```

- [ ] **Step 2: Implement the API route**

Create `src/app/api/audit/prep/[id]/packet/route.tsx`:

```tsx
// src/app/api/audit/prep/[id]/packet/route.tsx
//
// GET /api/audit/prep/[id]/packet — assembles the multi-section packet
// from completed steps' snapshotted evidence + emits an
// AUDIT_PREP_PACKET_GENERATED event so the session flips COMPLETED.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAuditPrepPacketGenerated } from "@/lib/events/projections/auditPrep";
import {
  AuditPrepPacketDocument,
  type PacketSectionInput,
} from "@/lib/audit-prep/packet-pdf";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";

export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "No practice" }, { status: 401 });
  }

  const session = await db.auditPrepSession.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { code: "asc" } },
    },
  });
  if (!session || session.practiceId !== pu.practiceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const protocols = PROTOCOLS_BY_MODE[session.mode] ?? [];
  const sections: PacketSectionInput[] = protocols.flatMap((p) => {
    const step = session.steps.find((s) => s.code === p.code);
    if (!step || step.status === "PENDING") return [];
    return [
      {
        code: p.code,
        title: p.title,
        citation: p.citation,
        description: p.description,
        evidenceJson:
          (step.evidenceJson as Record<string, unknown> | null) ?? null,
        notes: step.notes,
        status: step.status as "COMPLETE" | "NOT_APPLICABLE",
      },
    ];
  });

  const pdfBuffer = await renderToBuffer(
    <AuditPrepPacketDocument
      input={{
        practiceName: pu.practice.name,
        practiceState: pu.practice.primaryState,
        mode: session.mode,
        startedAt: session.startedAt,
        generatedAt: new Date(),
        sections,
      }}
    />,
  );

  // Emit packet-generated event after render. Failure here doesn't
  // block the download — try/catch + log so the user still gets the PDF.
  try {
    const payload = {
      auditPrepSessionId: session.id,
      generatedByUserId: user.id,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "AUDIT_PREP_PACKET_GENERATED",
        payload,
      },
      async (tx) =>
        projectAuditPrepPacketGenerated(tx, {
          practiceId: pu.practiceId,
          payload,
        }),
    );
  } catch (err) {
    console.error("[audit-prep] packet-generated event failed", err);
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="audit-prep-${session.mode}-${pu.practice.name.replace(/[^A-Za-z0-9]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add src/lib/audit-prep/packet-pdf.tsx "src/app/api/audit/prep"
git commit -m "feat(audit-prep): packet PDF generator + API route"
```

---

## Task 8: Sidebar entry

**Files:**
- Modify: `src/components/gw/AppShell/Sidebar.tsx`

- [ ] **Step 1: Add ClipboardCheck import + AUDIT_ITEMS entry**

In `src/components/gw/AppShell/Sidebar.tsx`, find the lucide-react import block and add `ClipboardCheck` to the destructured list. Then find the `AUDIT_ITEMS` array (around line 81-85) and update it:

```tsx
const AUDIT_ITEMS: ProgramItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/audit/overview" as Route },
  { label: "Activity log", icon: ScrollText, href: "/audit/activity" as Route },
  { label: "Reports", icon: FileBarChart2, href: "/audit/reports" as Route },
  { label: "Audit Prep", icon: ClipboardCheck, href: "/audit/prep" as Route },
];
```

- [ ] **Step 2: Commit**

```bash
cd D:/GuardWell/guardwell-v2
git add src/components/gw/AppShell/Sidebar.tsx
git commit -m "ui(sidebar): Audit Prep entry under Audit & Insights"
```

---

## Task 9: Validate full suite + lint + Cloud SQL push

**Files:** None (validation only)

- [ ] **Step 1: Run tsc**

Run: `cd D:/GuardWell/guardwell-v2 && npx tsc --noEmit 2>&1 | tail -10`

Expected: clean (no output).

- [ ] **Step 2: Run eslint on changed surfaces**

Run:

```bash
cd D:/GuardWell/guardwell-v2 && npx eslint \
  src/lib/audit-prep \
  src/lib/events/projections/auditPrep.ts \
  src/lib/events/registry.ts \
  src/components/gw/AppShell/Sidebar.tsx \
  "src/app/(dashboard)/audit/prep" \
  "src/app/api/audit/prep" \
  tests/integration/audit-prep.test.ts 2>&1 | tail -10
```

Expected: clean (no output).

- [ ] **Step 3: Run full test suite**

Run: `cd D:/GuardWell/guardwell-v2 && npx vitest run 2>&1 | grep "Tests "`

Expected: "Tests 383 passed (383)" (was 380; +3 from audit-prep.test.ts).

- [ ] **Step 4: Push schema to Cloud SQL**

Run:

```bash
cd D:/GuardWell/guardwell-v2 && \
DATABASE_URL='postgresql://gwapp:PVBcxB8v3JrGiRRwyJEIs8666oRDNZ3B@127.0.0.1:5434/guardwell_v2?schema=public' \
npx prisma db push --skip-generate 2>&1 | tail -3
```

Expected: "Your database is now in sync with your Prisma schema."

---

## Task 10: PR + merge + deploy

- [ ] **Step 1: Push branch**

Run: `cd D:/GuardWell/guardwell-v2 && git push -u origin feat/audit-prep-wizard 2>&1 | tail -3`

- [ ] **Step 2: Create PR**

Run:

```bash
cd D:/GuardWell/guardwell-v2 && "/c/Program Files/GitHub CLI/gh.exe" pr create \
  --title "feat(audit-prep): HHS OCR HIPAA wizard MVP + packet PDF" \
  --body "Per docs/specs/v1-ideas-survey.md §1.1. Tightly-scoped MVP: only HHS OCR HIPAA mode is wired up. OSHA/CMS/DEA modes are scaffolded in the schema enum but throw at session creation until protocols are added in follow-up PRs.

6 protocols: NPP delivery, Workforce Training, Risk Analysis, Risk Management, Sanctions Policy, Contingency Plan. Each has a structured evidence loader pulling from existing tables (PracticePolicy, TrainingCompletion, PracticeSraAssessment, Incident, TechAsset, etc). Evidence is snapshotted into AuditPrepStep.evidenceJson at completion so the packet stays stable even if data changes later.

Suite: 380 → 383 passing. Cloud SQL synced."
```

- [ ] **Step 3: Merge**

Run: `cd D:/GuardWell/guardwell-v2 && "/c/Program Files/GitHub CLI/gh.exe" pr merge --merge --delete-branch`

- [ ] **Step 4: Sync local main + verify deploy**

Run: `cd D:/GuardWell/guardwell-v2 && git checkout main && git pull --ff-only origin main`

Then poll Cloud Build until SUCCESS, then navigate to `https://v2.app.gwcomp.com/audit/prep` in the Chrome MCP tab and verify the page renders + the start-session form is visible.

---

## Self-Review

**Spec coverage:**
- Schema (AuditPrepSession + AuditPrepStep + 3 enums + back-relation) → Task 1 ✓
- 4 events + projections → Task 2 ✓
- 6 HIPAA protocols + evidence loaders → Task 3 ✓
- Server actions (open + complete + reopen) → Task 4 ✓
- Integration tests → Task 5 ✓
- /audit/prep + /audit/prep/[id] + StepPanel → Task 6 ✓
- PDF generator + /api/audit/prep/[id]/packet route → Task 7 ✓
- Sidebar entry → Task 8 ✓
- Validation + Cloud SQL push → Task 9 ✓
- PR + merge + deploy → Task 10 ✓

**Placeholder scan:** None. Every task has runnable commands + complete code.

**Type consistency:**
- `AuditPrepMode` enum values (HHS_OCR_HIPAA / OSHA / CMS / DEA) match between schema, EVENT_SCHEMAS zod, server-action zod, and StartSessionForm useState type.
- `AuditPrepStepStatus` enum values (PENDING / COMPLETE / NOT_APPLICABLE) consistent across schema, payload schema, completeStepAction zod, and StepPanel `status` prop.
- `ProtocolDef` interface matches the shape used by both projections (in projectAuditPrepSessionOpened) and server actions (in completeStepAction's evidence-loader lookup).
- `PROTOCOLS_BY_MODE` index by mode string, lookup pattern is identical in projection + server action + page.
