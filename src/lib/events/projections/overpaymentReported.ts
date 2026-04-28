// src/lib/events/projections/overpaymentReported.ts
//
// Minimal projection for the OVERPAYMENT_REPORTED event.
// No model row is created — the derivation rule queries EventLog directly.
// This projection exists only to trigger rederiveRequirementStatus so that
// ComplianceItem + framework score are refreshed immediately.
//
// Naming convention: the synthetic evidence code uses an "OVERPAYMENT:" prefix
// (e.g. "OVERPAYMENT:REPORTED") to distinguish it from other evidence namespaces
// ("POLICY:", "CREDENTIAL_TYPE:", "EVENT:"). The "OVERPAYMENT:" prefix signals
// "the EventLog row IS the evidence — there's no associated model to query."
// Reuse the EVENT: prefix pattern for any future event-only attestation flow.

import type { Prisma } from "@prisma/client";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

export async function projectOverpaymentReported(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(tx, args.practiceId, "OVERPAYMENT:REPORTED");
}
