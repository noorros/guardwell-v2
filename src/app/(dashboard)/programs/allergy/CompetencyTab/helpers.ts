// src/app/(dashboard)/programs/allergy/CompetencyTab/helpers.ts
//
// Pure helpers extracted from CompetencyTab.tsx (audit #21 MIN-8 —
// Wave-4 D4 file-organization).

// SIX_MONTHS_MS lives in src/lib/allergy/constants.ts (audit #21 MIN-1).
import { SIX_MONTHS_MS } from "@/lib/allergy/constants";

/**
 * 6-month inactivity check (USP §21 + v1 logic). True when the
 * compounder hasn't logged a session in ≥SIX_MONTHS_MS, signalling that
 * re-evaluation is required before they can compound again.
 */
export function isInactive(lastCompoundedAt: string | null | undefined): boolean {
  if (!lastCompoundedAt) return false;
  return Date.now() - new Date(lastCompoundedAt).getTime() >= SIX_MONTHS_MS;
}
