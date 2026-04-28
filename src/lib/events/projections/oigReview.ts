// src/lib/events/projections/oigReview.ts
//
// Minimal projections for the two OIG compliance-program events.
// No model rows are created — the derivation rules query EventLog directly.
// These projections exist only to trigger rederiveRequirementStatus so that
// ComplianceItem + framework score are refreshed immediately on event commit.
//
// Naming convention: EVENT: prefix per oshaAttestation.ts (PR 2) /
// overpaymentReported.ts (PR 4). The EventLog row IS the evidence — there is
// no associated model to query.
//   OIG_AUDITING_MONITORING  ← "EVENT:OIG_ANNUAL_REVIEW_SUBMITTED"
//   OIG_RESPONSE_VIOLATIONS  ← "EVENT:OIG_CORRECTIVE_ACTION_RESOLVED"

import type { Prisma } from "@prisma/client";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

/**
 * OIG Element 5 — annual compliance program review submitted.
 * Triggers rederivation of OIG_AUDITING_MONITORING.
 */
export async function projectOigAnnualReviewSubmitted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(
    tx,
    args.practiceId,
    "EVENT:OIG_ANNUAL_REVIEW_SUBMITTED",
  );
}

/**
 * OIG Element 7 — corrective action resolved after detected violation.
 * Triggers rederivation of OIG_RESPONSE_VIOLATIONS.
 * Note: OigCorrectiveAction model deferred to Phase 9 (OQ-1).
 */
export async function projectOigCorrectiveActionResolved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string },
): Promise<void> {
  await rederiveRequirementStatus(
    tx,
    args.practiceId,
    "EVENT:OIG_CORRECTIVE_ACTION_RESOLVED",
  );
}
