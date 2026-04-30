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
  mode: z.enum(["HHS_OCR_HIPAA", "OSHA", "CMS", "DEA", "ALLERGY"]),
});

export async function openAuditPrepSessionAction(
  input: z.infer<typeof OpenInput>,
): Promise<{ auditPrepSessionId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = OpenInput.parse(input);

  const protocols: ProtocolDef[] | undefined = PROTOCOLS_BY_MODE[parsed.mode];
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

  // Snapshot evidence for COMPLETE only — NOT_APPLICABLE skips loader.
  let evidenceJson: Record<string, unknown> | null = null;
  if (parsed.status === "COMPLETE") {
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
