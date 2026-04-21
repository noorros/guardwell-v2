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
