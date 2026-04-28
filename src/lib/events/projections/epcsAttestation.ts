// src/lib/events/projections/epcsAttestation.ts
//
// Minimal projection for the EPCS_ATTESTATION event.
// No model row is created — the derivation rule queries EventLog directly.
// This projection exists only to trigger rederiveRequirementStatus so that
// ComplianceItem + framework score are refreshed immediately.
//
// Naming convention: the synthetic evidence code uses an `EVENT:` prefix
// (e.g. "EVENT:EPCS_ATTESTATION") to distinguish it from `<MODEL>:<CODE>`
// patterns elsewhere in the system (e.g. "POLICY:DEA_SECURE_STORAGE_POLICY",
// "CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION"). The `EVENT:`
// prefix signals "the EventLog row IS the evidence — there's no associated
// model to query." Reuse this pattern for any future event-only attestation flow.

import type { Prisma } from "@prisma/client";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

export async function projectEpcsAttestation(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(tx, args.practiceId, "EVENT:EPCS_ATTESTATION");
}
