// src/lib/events/projections/requirementStatus.ts
//
// Projects REQUIREMENT_STATUS_UPDATED events into ComplianceItem rows.
// Called inside the appendEventAndApply transaction via the projection
// callback the server action passes.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"REQUIREMENT_STATUS_UPDATED", 1>;

export async function projectRequirementStatusUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Upsert the ComplianceItem. Unique on (practiceId, requirementId).
  await tx.complianceItem.upsert({
    where: {
      practiceId_requirementId: {
        practiceId,
        requirementId: payload.requirementId,
      },
    },
    update: {
      status: payload.nextStatus,
    },
    create: {
      practiceId,
      requirementId: payload.requirementId,
      status: payload.nextStatus,
    },
  });
}
