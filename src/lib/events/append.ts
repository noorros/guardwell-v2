// THE ONLY WAY projection tables get mutated (per ADR-0001). Server actions
// MUST go through this helper. The lint rule `no-direct-projection-mutation`
// (Task F1) blocks any other code path under src/app/(dashboard)/.

import { db } from "@/lib/db";
import {
  getEventSchema,
  EVENT_SCHEMAS,
  type EventType,
  type PayloadFor,
} from "./registry";
import type { EventLog, Prisma } from "@prisma/client";

export type EventInput<T extends EventType, V extends number = 1> = {
  practiceId: string;
  actorUserId?: string | null;
  type: T;
  schemaVersion?: V;
  payload: PayloadFor<T, V & keyof (typeof EVENT_SCHEMAS)[T]>;
  /** Pass to dedupe retried writes — identical idempotencyKey returns the
   *  existing row instead of inserting a duplicate. */
  idempotencyKey?: string;
};

export type ProjectionFn = (
  tx: Prisma.TransactionClient,
  event: EventLog,
) => Promise<void>;

/** Append a typed event AND apply its projection inside one transaction.
 *  Validates payload via the registered Zod schema. The optional `V` type
 *  parameter widens the payload to a non-default schema version when the
 *  caller passes `schemaVersion: 2` (etc.) — leave V defaulted for the
 *  v1 case. */
export async function appendEventAndApply<
  T extends EventType,
  V extends number = 1,
>(input: EventInput<T, V>, projection: ProjectionFn): Promise<EventLog> {
  const version = input.schemaVersion ?? 1;
  const schema = getEventSchema(input.type, version);
  const validated = schema.parse(input.payload);

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
