// tests/integration/audit-prep.test.ts
//
// End-to-end coverage for Audit Prep lifecycle: open a session, verify
// all 6 steps created; complete a step, verify evidence snapshot stored
// + session status flips IN_PROGRESS; reopen a step, verify status
// reset + evidence cleared.

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
  it("AUDIT_PREP_SESSION_OPENED creates the session + N protocol steps", async () => {
    const { user, practice } = await seed();
    const auditPrepSessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
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
    const auditPrepSessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
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
    const auditPrepSessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
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
