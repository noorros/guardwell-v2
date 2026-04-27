// src/lib/onboarding/select-drip-day.ts
//
// Pure selector: given a practice's trial state + which days have already
// been emailed, return the list of drip days due NOW. The runner sends one
// email per due day in order, so a missed cron run catches up on the next
// invocation.
//
// Deliberately pure (no DB, no clock except the explicit `now` arg) so it's
// trivial to unit test boundary conditions.

import { DRIP_DAYS, type DripDay } from "./drip-content";

const TRIAL_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Stop sending drip emails this many days after trial start. Day 10 is
// the latest scheduled send; we give a small buffer for cron lag, then
// stop entirely to prevent stale "trial ends in 24h" emails from going
// out months later if a row gets missed and the practice stays around.
const DRIP_GRACE_DAYS = 14;

export type DripSubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export interface DripSelectorInput {
  subscriptionStatus: DripSubscriptionStatus;
  trialEndsAt: Date | null;
  /** Days that have already been sent for this practice. */
  alreadySentDays: ReadonlySet<DripDay>;
  now: Date;
}

export interface DripSelectorResult {
  /** Reason the practice is ineligible. null when at least one day is due. */
  ineligibleReason: string | null;
  /** Days due to send NOW, in ascending order. Empty when up-to-date or ineligible. */
  daysDue: DripDay[];
}

export function selectDripDays(input: DripSelectorInput): DripSelectorResult {
  if (input.subscriptionStatus === "INCOMPLETE") {
    return { ineligibleReason: "subscription INCOMPLETE", daysDue: [] };
  }
  if (input.subscriptionStatus === "CANCELED") {
    return { ineligibleReason: "subscription CANCELED", daysDue: [] };
  }
  if (!input.trialEndsAt) {
    return { ineligibleReason: "trialEndsAt not set", daysDue: [] };
  }

  // Trial is fixed at 7 days, set in the SUBSCRIPTION_STARTED projection.
  // Drip is anchored on trial start (signup-day 0 = trialEndsAt - 7d).
  const trialStartedAt = new Date(
    input.trialEndsAt.getTime() - TRIAL_DAYS * ONE_DAY_MS,
  );
  const daysSinceStart = Math.floor(
    (input.now.getTime() - trialStartedAt.getTime()) / ONE_DAY_MS,
  );

  if (daysSinceStart < 0) {
    return { ineligibleReason: "trial hasn't started yet", daysDue: [] };
  }
  if (daysSinceStart > DRIP_GRACE_DAYS) {
    return {
      ineligibleReason: `${daysSinceStart} days past trial start (grace=${DRIP_GRACE_DAYS})`,
      daysDue: [],
    };
  }

  const daysDue: DripDay[] = [];
  for (const day of DRIP_DAYS) {
    if (input.alreadySentDays.has(day)) continue;
    if (daysSinceStart >= day) daysDue.push(day);
  }

  return { ineligibleReason: null, daysDue };
}
