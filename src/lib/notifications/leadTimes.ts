// src/lib/notifications/leadTimes.ts
//
// Effective lead-time resolution per category. Defaults match existing
// hardcoded values in per-generator files (e.g.
// generateCredentialRenewalNotifications uses [90, 60, 30, 7]). The
// per-practice override JSON at Practice.reminderSettings can supersede
// any category. Missing keys fall through to defaults.

export type LeadTimeCategory =
  | "credentials"
  | "cmsEnrollment"
  | "training"
  | "trainingExpiring"
  | "policies"
  | "policyReview"
  | "baa"
  | "incidents"
  | "deaInventory";

export const DEFAULT_LEAD_TIMES: Record<LeadTimeCategory, number[]> = {
  credentials: [90, 60, 30, 7],
  cmsEnrollment: [90, 60, 30, 7],
  training: [14, 7, 3, 1],
  trainingExpiring: [30, 14, 7],
  policies: [30, 7],
  policyReview: [90, 60, 30],
  baa: [60, 30, 7],
  incidents: [30, 14, 3],
  deaInventory: [60, 14, 1],
};

export interface PracticeReminderSettings {
  credentials?: number[];
  cmsEnrollment?: number[];
  training?: number[];
  trainingExpiring?: number[];
  policies?: number[];
  policyReview?: number[];
  baa?: number[];
  incidents?: number[];
  deaInventory?: number[];
}

/**
 * Returns the effective lead-time milestone array for a given category.
 * Practice override (if set) wins; otherwise default. Returned array is
 * always sorted descending (largest milestone first) for "fire smallest
 * unfired milestone" loop semantics in generators.
 */
export function getEffectiveLeadTimes(
  reminderSettings: unknown,
  category: LeadTimeCategory,
): number[] {
  const settings = reminderSettings as PracticeReminderSettings | null;
  const override = settings?.[category];
  const result =
    override && Array.isArray(override) && override.length > 0
      ? override
      : DEFAULT_LEAD_TIMES[category];
  return [...result].sort((a, b) => b - a);
}
