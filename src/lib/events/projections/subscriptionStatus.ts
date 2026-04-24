// src/lib/events/projections/subscriptionStatus.ts
//
// Projects all four subscription/onboarding events:
//   - SUBSCRIPTION_STARTED       → first-time Stripe checkout success
//   - SUBSCRIPTION_STATUS_CHANGED → ongoing webhook deltas (trial→active,
//                                    invoice.payment_failed, sub.deleted, …)
//   - PROMO_APPLIED              → audit-only: promo metadata captured
//                                    alongside SUBSCRIPTION_STARTED for
//                                    cleaner counting
//   - ONBOARDING_FIRST_RUN_COMPLETED → marks Practice.firstRunCompletedAt
//
// Practice rows hold the canonical subscription state (stripeCustomerId,
// stripeSubscriptionId, subscriptionStatus, trialEndsAt, currentPeriodEnd,
// firstRunCompletedAt). EventLog is the audit trail.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type StartedPayload = PayloadFor<"SUBSCRIPTION_STARTED", 1>;
type StatusChangedPayload = PayloadFor<"SUBSCRIPTION_STATUS_CHANGED", 1>;
type PromoAppliedPayload = PayloadFor<"PROMO_APPLIED", 1>;
type FirstRunPayload = PayloadFor<"ONBOARDING_FIRST_RUN_COMPLETED", 1>;

export async function projectSubscriptionStarted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: StartedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practice.update({
    where: { id: practiceId },
    data: {
      stripeCustomerId: payload.stripeCustomerId,
      stripeSubscriptionId: payload.stripeSubscriptionId,
      subscriptionStatus: "TRIALING",
      trialEndsAt: payload.trialEndsAt
        ? new Date(payload.trialEndsAt)
        : null,
    },
  });
}

export async function projectSubscriptionStatusChanged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: StatusChangedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.practice.update({
    where: { id: practiceId },
    data: {
      subscriptionStatus: payload.nextStatus,
      currentPeriodEnd: payload.currentPeriodEnd
        ? new Date(payload.currentPeriodEnd)
        : null,
    },
  });
}

/** PROMO_APPLIED has no projection side-effect on Practice (the discount
 *  is applied at Stripe). The event itself in EventLog is the audit
 *  trail. We keep the projection function so the event can be emitted
 *  through appendEventAndApply alongside SUBSCRIPTION_STARTED in the
 *  same transaction. */
export async function projectPromoApplied(
  _tx: Prisma.TransactionClient,
  _args: { practiceId: string; payload: PromoAppliedPayload },
): Promise<void> {
  // No-op projection. EventLog row written by appendEventAndApply is
  // the entire output of this event type.
}

export async function projectFirstRunCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: FirstRunPayload },
): Promise<void> {
  const { practiceId } = args;
  await tx.practice.update({
    where: { id: practiceId },
    data: { firstRunCompletedAt: new Date() },
  });
}
