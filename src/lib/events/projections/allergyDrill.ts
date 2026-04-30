// src/lib/events/projections/allergyDrill.ts
import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";
import { assertProjectionPracticeOwned } from "./guards";

type LoggedPayload = PayloadFor<"ALLERGY_DRILL_LOGGED", 1>;
type UpdatedPayload = PayloadFor<"ALLERGY_DRILL_UPDATED", 1>;
type DeletedPayload = PayloadFor<"ALLERGY_DRILL_DELETED", 1>;

export async function projectAllergyDrillLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: LoggedPayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse a forged ALLERGY_DRILL_LOGGED carrying another
  // practice's drillId — without this guard, scenario / participants /
  // observations on Practice B's drill could be overwritten.
  const existing = await tx.allergyDrill.findUnique({
    where: { id: payload.drillId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyDrill",
    id: payload.drillId,
  });

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

/**
 * Audit #15: typo correction on an existing drill row. The original
 * conductor (conductedById) is preserved; only the user-editable fields
 * are mutated. Refuses if the row is missing, retired, or belongs to a
 * different practice. Triggers ALLERGY_ANNUAL_DRILL rederive in case
 * the new conductedAt date crosses the annual threshold.
 */
export async function projectAllergyDrillUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UpdatedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.allergyDrill.findUnique({
    where: { id: payload.drillId },
    select: { practiceId: true, retiredAt: true },
  });
  if (!existing) {
    throw new Error(
      `ALLERGY_DRILL_UPDATED refused: drill ${payload.drillId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyDrill",
    id: payload.drillId,
  });
  if (existing.retiredAt) {
    throw new Error(
      `ALLERGY_DRILL_UPDATED refused: drill ${payload.drillId} is retired`,
    );
  }
  await tx.allergyDrill.update({
    where: { id: payload.drillId },
    data: {
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

/**
 * Audit #15: soft-delete. Idempotent — re-emitting on an already-retired
 * drill row leaves retiredAt unchanged. Always rederives
 * ALLERGY_ANNUAL_DRILL because deleting the most-recent drill can flip
 * the annual rule back to GAP.
 */
export async function projectAllergyDrillDeleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DeletedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.allergyDrill.findUnique({
    where: { id: payload.drillId },
    select: { practiceId: true, retiredAt: true },
  });
  if (!existing) {
    throw new Error(
      `ALLERGY_DRILL_DELETED refused: drill ${payload.drillId} not found`,
    );
  }
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "allergyDrill",
    id: payload.drillId,
  });
  if (!existing.retiredAt) {
    await tx.allergyDrill.update({
      where: { id: payload.drillId },
      data: { retiredAt: new Date(payload.deletedAt) },
    });
  }
  await rederiveRequirementStatus(tx, practiceId, "ALLERGY_ANNUAL_DRILL");
}
