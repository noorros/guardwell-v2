// src/app/(auth)/sign-up/payment/actions.ts
//
// Phase C server action: createCheckoutSessionAction.
//
// Creates (or re-uses) the Stripe Customer for the practice, then
// creates a Checkout Session with:
//   - 1 line item (monthly OR annual price)
//   - mode: subscription
//   - 7-day trial (skipped if a 100%-off promo is applied — trial is moot)
//   - allow_promotion_codes: true (lets users type ANY active code in
//     Checkout, including BETATESTER2026 if not pre-applied)
//   - discounts: [{ promotion_code: <id> }] when a known promo was
//     carried in via the URL param
//   - payment_method_collection: 'if_required' so Stripe skips card
//     collection when 100% off is applied (beta testers never see card)
//
// Returns the checkoutUrl. Client redirects via window.location.href.

"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  getStripe,
  priceIdForInterval,
  findActivePromotionCode,
} from "@/lib/stripe";

const Input = z.object({
  billingInterval: z.enum(["monthly", "annual"]),
  promoCode: z.string().max(200).optional(),
});

export type CreateCheckoutSessionResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

export async function createCheckoutSessionAction(
  input: z.infer<typeof Input>,
): Promise<CreateCheckoutSessionResult> {
  try {
    return await createCheckoutSessionInner(input);
  } catch (err) {
    // Surface the message to the client instead of letting Next swallow
    // it as an opaque 500. The client renders this in a red alert.
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[createCheckoutSessionAction] failed:", err);
    return { ok: false, error: `checkout-error: ${msg}` };
  }
}

async function createCheckoutSessionInner(
  input: z.infer<typeof Input>,
): Promise<CreateCheckoutSessionResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "no-practice" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid-input" };

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: {
      id: true,
      name: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });

  // Already paid → don't make a new checkout session, just signal the
  // page to redirect onward.
  if (
    practice.subscriptionStatus === "TRIALING" ||
    practice.subscriptionStatus === "ACTIVE"
  ) {
    return { ok: false, error: "already-subscribed" };
  }

  const stripe = getStripe();
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    (process.env.NEXT_PUBLIC_APP_URL || "https://v2.app.gwcomp.com");

  // 1. Create or reuse the Stripe Customer.
  let stripeCustomerId = practice.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: practice.name,
      metadata: {
        practiceId: practice.id,
        ownerUserId: user.id,
      },
    });
    stripeCustomerId = customer.id;
    // Stash on the Practice row immediately so a retry doesn't make
    // a second Customer.
    await db.practice.update({
      where: { id: practice.id },
      data: { stripeCustomerId },
    });
  }

  // 2. Resolve the URL-passed promo code if any.
  let promotion: Awaited<ReturnType<typeof findActivePromotionCode>> = null;
  if (parsed.data.promoCode) {
    promotion = await findActivePromotionCode(parsed.data.promoCode);
  }

  // 3. Build the Checkout Session.
  const priceId = priceIdForInterval(parsed.data.billingInterval);

  // If a 100%-off promo is applied, the 7-day trial is meaningless
  // (the customer will never be charged). Skip the trial so Stripe
  // doesn't send a "trial ending" email that confuses the user.
  // Also skip card collection — payment_method_collection: 'if_required'
  // tells Stripe to omit the card field when no payment is due.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: promotion
      ? { metadata: { practiceId: practice.id } }
      : {
          trial_period_days: 7,
          metadata: { practiceId: practice.id },
        },
    discounts: promotion
      ? [{ promotion_code: promotion.id }]
      : undefined,
    allow_promotion_codes: promotion ? undefined : true,
    payment_method_collection: promotion ? "if_required" : "always",
    success_url: `${origin}/sign-up/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/sign-up/payment${parsed.data.promoCode ? `?promo=${encodeURIComponent(parsed.data.promoCode)}` : ""}`,
    metadata: {
      practiceId: practice.id,
      ownerUserId: user.id,
    },
    // Tax + billing address: leave Stripe Tax off for now (per
    // billing-single-tier memo it was off in v1 too).
  });

  if (!session.url) {
    return { ok: false, error: "stripe-no-url" };
  }
  return { ok: true, checkoutUrl: session.url };
}
