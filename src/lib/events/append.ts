// Event append + projection helper. Per ADR-0001, this is the ONLY way
// projection tables (ComplianceItem, PracticeFramework, etc.) are mutated.
//
// Usage:
//   await appendEventAndApply({
//     practiceId,
//     actorUserId: user.id,
//     type: "POLICY_ACKNOWLEDGED",
//     payload: { requirementId, evidenceId },
//   }, async (tx) => {
//     await tx.complianceItem.upsert({ ... });
//   });
//
// The helper:
//   1. Validates payload against the registered Zod schema for (type, version)
//   2. Opens a Prisma transaction
//   3. Appends the event to EventLog
//   4. Runs the projection callback inside the same transaction
//   5. Returns the appended event row
//
// Implementation will land alongside the first real event type in the
// weeks-1–2 sprint. This stub establishes the import path so projection
// code can be written against it from day one.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type EventInput<TPayload> = {
  practiceId: string;
  actorUserId?: string | null;
  type: string;
  schemaVersion?: number;
  payload: TPayload;
  idempotencyKey?: string;
};

export type ProjectionFn = (tx: Prisma.TransactionClient) => Promise<void>;

/** Stub — full implementation lands in week 1 of v2 build. */
export async function appendEventAndApply<TPayload>(
  event: EventInput<TPayload>,
  projection: ProjectionFn,
) {
  return db.$transaction(async (tx) => {
    const row = await tx.eventLog.create({
      data: {
        practiceId: event.practiceId,
        actorUserId: event.actorUserId ?? null,
        type: event.type,
        schemaVersion: event.schemaVersion ?? 1,
        payload: event.payload as Prisma.InputJsonValue,
        idempotencyKey: event.idempotencyKey,
      },
    });
    await projection(tx);
    return row;
  });
}
