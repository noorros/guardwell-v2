// src/lib/events/projections/destructionLogged.ts
//
// Projects DESTRUCTION_LOGGED events: writes a DestructionLog row and
// rederives HIPAA_DOCUMENTATION_RETENTION.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"DESTRUCTION_LOGGED", 1>;

export async function projectDestructionLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.destructionLog.create({
    data: {
      id: payload.destructionLogId,
      practiceId,
      documentType: payload.documentType,
      description: payload.description,
      volumeEstimate: payload.volumeEstimate ?? null,
      method: payload.method,
      performedByUserId: payload.performedByUserId,
      witnessedByUserId: payload.witnessedByUserId ?? null,
      certificateUrl: payload.certificateUrl ?? null,
      destroyedAt: new Date(payload.destroyedAt),
      notes: payload.notes ?? null,
    },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "DESTRUCTION:LOGGED",
  );
}
