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
