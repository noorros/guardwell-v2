// src/lib/events/projections/auditPrep.ts
//
// Projections for Audit Prep lifecycle:
//   AUDIT_PREP_SESSION_OPENED   → INSERT session row + N AuditPrepStep rows
//   AUDIT_PREP_STEP_COMPLETED   → UPDATE step status + evidenceJson + notes
//   AUDIT_PREP_STEP_REOPENED    → UPDATE step status back to PENDING
//   AUDIT_PREP_PACKET_GENERATED → set session.packetGeneratedAt + status=COMPLETED

import { Prisma } from "@prisma/client";
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
      evidenceJson: Prisma.JsonNull,
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
