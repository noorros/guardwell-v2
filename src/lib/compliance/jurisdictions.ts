// src/lib/compliance/jurisdictions.ts
//
// Helpers for state-overlay compliance. Practices have a primaryState
// (required) plus operatingStates (additional jurisdictions they serve
// via telehealth, satellite offices, etc.). Each RegulatoryRequirement
// has a jurisdictionFilter: String[] — empty = federal, non-empty =
// applies only to practices whose jurisdictions overlap.

import type { Prisma } from "@prisma/client";

/**
 * The full set of state codes a practice is obligated under. Always includes
 * primaryState; appends any operatingStates. De-duplicated.
 */
export function getPracticeJurisdictions(practice: {
  primaryState: string;
  operatingStates?: string[];
}): string[] {
  const set = new Set<string>([practice.primaryState]);
  for (const s of practice.operatingStates ?? []) set.add(s);
  return Array.from(set);
}

/**
 * Prisma where-clause fragment that matches federal requirements
 * (empty jurisdictionFilter) OR state-specific requirements that overlap
 * the given jurisdictions.
 *
 * Use inside `where: { ..., ...jurisdictionRequirementFilter(states) }`
 * on any `regulatoryRequirement.findMany` or `.count` call.
 */
export function jurisdictionRequirementFilter(
  jurisdictions: string[],
): Prisma.RegulatoryRequirementWhereInput {
  return {
    OR: [
      { jurisdictionFilter: { isEmpty: true } },
      { jurisdictionFilter: { hasSome: jurisdictions } },
    ],
  };
}

/**
 * Does this requirement apply to a practice with the given jurisdictions?
 * In-memory equivalent of jurisdictionRequirementFilter for use after
 * a requirement set has already been loaded.
 */
export function requirementAppliesToJurisdictions(
  requirement: { jurisdictionFilter: string[] },
  jurisdictions: string[],
): boolean {
  if (requirement.jurisdictionFilter.length === 0) return true;
  return requirement.jurisdictionFilter.some((s) => jurisdictions.includes(s));
}
