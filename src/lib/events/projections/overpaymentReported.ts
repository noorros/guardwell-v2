// src/lib/events/projections/overpaymentReported.ts
//
// Minimal projection for the OVERPAYMENT_REPORTED event.
// No model row is created — the derivation rule queries EventLog directly.
// This projection exists only to trigger rederiveRequirementStatus so that
// ComplianceItem + framework score are refreshed immediately.
//
// Naming convention: follows the EVENT: prefix convention established in
// oshaAttestation.ts (PR 2) and extended by DEA (PR 3). Any projection where
// "the EventLog row IS the evidence — there's no associated model to query"
// uses "EVENT:<EVENT_TYPE>" as the synthetic evidence code.
// See oshaAttestation.ts for the canonical reference.

import type { Prisma } from "@prisma/client";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

export async function projectOverpaymentReported(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(tx, args.practiceId, "EVENT:OVERPAYMENT_REPORTED");
}
