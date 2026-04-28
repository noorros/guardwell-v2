// src/lib/events/projections/oshaAttestation.ts
//
// Minimal projections for the OSHA poster + PPE attestation events.
// Neither event creates a dedicated model row — the derivation rules
// query EventLog directly. These projections exist only to trigger
// rederiveRequirementStatus so that ComplianceItem + framework score
// are refreshed immediately when the event is appended.
//
// Naming convention: the synthetic evidence codes use an `EVENT:` prefix
// (e.g. "EVENT:POSTER_ATTESTATION") to distinguish them from
// `<MODEL>:<CODE>` patterns elsewhere in the system (e.g.
// "POLICY:HIPAA_PRIVACY_POLICY", "TRAINING:HIPAA_PRIVACY_BASICS",
// "CREDENTIAL_TYPE:DEA_REGISTRATION"). The `EVENT:` prefix signals
// "the EventLog row IS the evidence — there's no associated model to
// query." Reuse this pattern for any future event-only attestation flow.

import type { Prisma } from "@prisma/client";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

export async function projectPosterAttestation(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(tx, args.practiceId, "EVENT:POSTER_ATTESTATION");
}

export async function projectPpeAssessmentCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(tx, args.practiceId, "EVENT:PPE_ASSESSMENT_COMPLETED");
}
