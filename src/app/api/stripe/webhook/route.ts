// src/app/api/stripe/webhook/route.ts
//
// Phase C webhook handler. Listens to 5 Stripe events:
//   - checkout.session.completed       → SUBSCRIPTION_STARTED + optional PROMO_APPLIED
//   - customer.subscription.updated    → SUBSCRIPTION_STATUS_CHANGED
//   - customer.subscription.deleted    → SUBSCRIPTION_STATUS_CHANGED → CANCELED
//   - invoice.payment_succeeded        → SUBSCRIPTION_STATUS_CHANGED → ACTIVE
//   - invoice.payment_failed           → SUBSCRIPTION_STATUS_CHANGED → PAST_DUE
//
// Signature is verified via STRIPE_WEBHOOK_SECRET. Each event is
// idempotent thanks to appendEventAndApply's idempotencyKey check
// (we use the Stripe event id, e.g. evt_xxx, so a duplicate delivery
// is a no-op).

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { verifyWebhook, getStripe } from "@/lib/stripe";
import { appendEventAndApply } from "@/lib/events";
import {
  projectSubscriptionStarted,
  projectSubscriptionStatusChanged,
  projectPromoApplied,
} from "@/lib/events/projections/subscriptionStatus";

// Stripe webhook payloads must be received as the raw body for signature
// verification. Next.js 16 app router gives us req.text() for that.

type V2Status = "INCOMPLETE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

function normalizeStatus(stripeStatus: Stripe.Subscription.Status): V2Status {
  switch (stripeStatus) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "INCOMPLETE";
    default:
      return "INCOMPLETE";
  }
}

async function findPracticeIdForCustomer(
  customerId: string,
): Promise<string | null> {
  const p = await db.practice.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return p?.id ?? null;
}

async function findPracticeIdForSubscription(
  subscriptionId: string,
): Promise<string | null> {
  const p = await db.practice.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  return p?.id ?? null;
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "missing-signature" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = verifyWebhook(rawBody, sig);
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid-signature",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionDelta(event);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      default:
        // Ignore other event types — Stripe sends a lot we don't subscribe
        // to depending on dashboard config.
        break;
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // Don't 500 to Stripe — we want them to retry on transient failures
    // but not loop forever on bad data. Return 200 + log to our side.
    console.error("[stripe.webhook] event.type=%s id=%s err=%o", event.type, event.id, err);
    return NextResponse.json({ received: true, error: "internal-non-fatal" });
  }
}

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "subscription" || !session.customer) return;
  if (!session.subscription) return;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer.id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;

  // Find the practice via the customer (we wrote stripeCustomerId
  // when we created the Customer in createCheckoutSessionAction).
  const practiceId = await findPracticeIdForCustomer(customerId);
  if (!practiceId) {
    console.warn("[stripe.webhook] checkout.session.completed for unknown customer", customerId);
    return;
  }

  // Pull the subscription so we know its price + interval + trial end.
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  const item = subscription.items.data[0];
  const price = item?.price;
  const priceId = price?.id ?? "";
  const interval = price?.recurring?.interval === "year" ? "year" : "month";
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : null;

  // Optional promo info: Stripe v2024 API uses `discounts` (array of
  // ids or expanded objects) on the modern Subscription type. Resolve
  // the first one.
  const discountsField = (
    subscription as unknown as {
      discounts?: Array<string | Stripe.Discount> | null;
    }
  ).discounts;
  let promotionCodeId: string | null = null;
  let promotionCode: string | null = null;
  let percentOff: number | null = null;
  let durationLabel: string | null = null;
  // Re-retrieve the subscription with discounts expanded so the field
  // is fully populated (the initial retrieve only expanded items.data.price).
  if (discountsField && discountsField.length > 0) {
    const subWithDiscounts = await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["discounts"] },
    );
    const expanded = (
      subWithDiscounts as unknown as { discounts?: Array<Stripe.Discount> }
    ).discounts;
    // Stripe API surfaces Discount fields slightly differently across
    // SDK minor versions. Cast to a permissive shape; ignore missing
    // fields gracefully.
    const discount = expanded?.[0] as
      | (Stripe.Discount & {
          coupon?: Stripe.Coupon;
          promotion_code?: string | { id: string } | null;
        })
      | undefined;
    if (discount) {
      const promo = discount.promotion_code;
      promotionCodeId =
        typeof promo === "string"
          ? promo
          : promo && typeof promo === "object"
            ? promo.id
            : null;
      if (discount.coupon) {
        percentOff = discount.coupon.percent_off ?? null;
        durationLabel = discount.coupon.duration ?? null;
      }
      if (promotionCodeId) {
        const pc = await stripe.promotionCodes
          .retrieve(promotionCodeId)
          .catch(() => null);
        promotionCode = pc?.code ?? null;
      }
    }
  }

  const idempotencyKey = `stripe:${event.id}`;

  // Emit SUBSCRIPTION_STARTED
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: null,
      type: "SUBSCRIPTION_STARTED",
      idempotencyKey,
      payload: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeCheckoutSessionId: session.id,
        priceId,
        billingInterval: interval,
        trialEndsAt: trialEnd,
        promotionCodeId,
        promotionCode,
      },
    },
    async (tx) =>
      projectSubscriptionStarted(tx, {
        practiceId,
        payload: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeCheckoutSessionId: session.id,
          priceId,
          billingInterval: interval,
          trialEndsAt: trialEnd,
          promotionCodeId,
          promotionCode,
        },
      }),
  );

  // Emit a separate PROMO_APPLIED audit row when a promo was used.
  if (promotionCodeId && promotionCode) {
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: null,
        type: "PROMO_APPLIED",
        idempotencyKey: `${idempotencyKey}:promo`,
        payload: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          promotionCodeId,
          promotionCode,
          percentOff,
          durationLabel,
        },
      },
      async (tx) =>
        projectPromoApplied(tx, {
          practiceId,
          payload: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            promotionCodeId,
            promotionCode,
            percentOff,
            durationLabel,
          },
        }),
    );
  }
}

async function handleSubscriptionDelta(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const practiceId = await findPracticeIdForCustomer(customerId);
  if (!practiceId) return;

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { subscriptionStatus: true },
  });
  const previous = practice.subscriptionStatus as V2Status;
  const next: V2Status =
    event.type === "customer.subscription.deleted"
      ? "CANCELED"
      : normalizeStatus(subscription.status);

  // Stripe v2024 moved current_period_end onto each SubscriptionItem
  // (a sub can have items on different cadences). For our single-line
  // sub the first item's period end is the effective subscription end.
  const periodEndUnix = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end
    ?? subscription.items.data[0]?.current_period_end
    ?? null;

  if (previous === next && !periodEndUnix) return;

  const periodEnd = periodEndUnix
    ? new Date(periodEndUnix * 1000).toISOString()
    : null;

  await appendEventAndApply(
    {
      practiceId,
      actorUserId: null,
      type: "SUBSCRIPTION_STATUS_CHANGED",
      idempotencyKey: `stripe:${event.id}`,
      payload: {
        stripeSubscriptionId: subscription.id,
        previousStatus: previous,
        nextStatus: next,
        currentPeriodEnd: periodEnd,
        reason: event.type,
      },
    },
    async (tx) =>
      projectSubscriptionStatusChanged(tx, {
        practiceId,
        payload: {
          stripeSubscriptionId: subscription.id,
          previousStatus: previous,
          nextStatus: next,
          currentPeriodEnd: periodEnd,
          reason: event.type,
        },
      }),
  );
}

async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
  };
  if (!invoice.subscription) return;
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;

  const practiceId = await findPracticeIdForSubscription(subscriptionId);
  if (!practiceId) return;

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { subscriptionStatus: true },
  });
  const previous = practice.subscriptionStatus as V2Status;
  if (previous === "ACTIVE") return;

  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  await appendEventAndApply(
    {
      practiceId,
      actorUserId: null,
      type: "SUBSCRIPTION_STATUS_CHANGED",
      idempotencyKey: `stripe:${event.id}`,
      payload: {
        stripeSubscriptionId: subscriptionId,
        previousStatus: previous,
        nextStatus: "ACTIVE",
        currentPeriodEnd: periodEnd,
        reason: "invoice.payment_succeeded",
      },
    },
    async (tx) =>
      projectSubscriptionStatusChanged(tx, {
        practiceId,
        payload: {
          stripeSubscriptionId: subscriptionId,
          previousStatus: previous,
          nextStatus: "ACTIVE",
          currentPeriodEnd: periodEnd,
          reason: "invoice.payment_succeeded",
        },
      }),
  );
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
  };
  if (!invoice.subscription) return;
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;

  const practiceId = await findPracticeIdForSubscription(subscriptionId);
  if (!practiceId) return;

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { subscriptionStatus: true },
  });
  const previous = practice.subscriptionStatus as V2Status;

  await appendEventAndApply(
    {
      practiceId,
      actorUserId: null,
      type: "SUBSCRIPTION_STATUS_CHANGED",
      idempotencyKey: `stripe:${event.id}`,
      payload: {
        stripeSubscriptionId: subscriptionId,
        previousStatus: previous,
        nextStatus: "PAST_DUE",
        currentPeriodEnd: null,
        reason: "invoice.payment_failed",
      },
    },
    async (tx) =>
      projectSubscriptionStatusChanged(tx, {
        practiceId,
        payload: {
          stripeSubscriptionId: subscriptionId,
          previousStatus: previous,
          nextStatus: "PAST_DUE",
          currentPeriodEnd: null,
          reason: "invoice.payment_failed",
        },
      }),
  );
}
