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
