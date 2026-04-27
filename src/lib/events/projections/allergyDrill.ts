// src/lib/events/projections/allergyDrill.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"ALLERGY_DRILL_LOGGED", 1>;

export async function projectAllergyDrillLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.allergyDrill.upsert({
    where: { id: payload.drillId },
    create: {
      id: payload.drillId,
      practiceId,
      conductedById: payload.conductedByUserId,
      conductedAt: new Date(payload.conductedAt),
      scenario: payload.scenario,
      participantIds: payload.participantIds,
      durationMinutes: payload.durationMinutes ?? null,
      observations: payload.observations ?? null,
      correctiveActions: payload.correctiveActions ?? null,
      nextDrillDue: payload.nextDrillDue
        ? new Date(payload.nextDrillDue)
        : null,
    },
    update: {
      conductedAt: new Date(payload.conductedAt),
      scenario: payload.scenario,
      participantIds: payload.participantIds,
      durationMinutes: payload.durationMinutes ?? null,
      observations: payload.observations ?? null,
      correctiveActions: payload.correctiveActions ?? null,
      nextDrillDue: payload.nextDrillDue
        ? new Date(payload.nextDrillDue)
        : null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_ANNUAL_DRILL");
}
