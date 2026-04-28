// src/lib/events/projections/macraActivity.ts
//
// Projects MACRA_ACTIVITY_LOGGED events. Writes a MacraActivityLog row + then
// rederives any RegulatoryRequirement that lists "MACRA_ACTIVITY:LOGGED" in
// its acceptedEvidenceTypes. The five derivation rules in macra.ts read from
// this table directly (filtered by activityType + attestationYear).
//
// Naming convention: model-row-backed evidence code "MACRA_ACTIVITY:LOGGED"
// (mirrors "DEA_INVENTORY:RECORDED" / "SRA_COMPLETED" patterns where a model
// row IS the evidence). This is distinct from the EVENT: prefix used for
// event-only synthetic codes (POSTER_ATTESTATION, EPCS_ATTESTATION, etc.)
// which have no associated model row.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"MACRA_ACTIVITY_LOGGED", 1>;

export async function projectMacraActivityLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Upsert (not create) for idempotent replay. MacraActivityLog rows are
  // append-only so the payload is immutable; re-projecting the same event
  // (event-bus retry, manual rerun, projection backfill) is a no-op on
  // update. Mirrors the policyAdopted upsert pattern.
  await tx.macraActivityLog.upsert({
    where: { id: payload.activityId },
    update: {},
    create: {
      id: payload.activityId,
      practiceId,
      activityCode: payload.activityCode,
      activityType: payload.activityType,
      attestationYear: payload.attestationYear,
      activityName: payload.activityName,
      loggedByUserId: payload.loggedByUserId,
      notes: payload.notes ?? null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "MACRA_ACTIVITY:LOGGED");
}
