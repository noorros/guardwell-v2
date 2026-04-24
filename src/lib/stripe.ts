// src/lib/stripe.ts
//
// Centralized Stripe SDK wrapper + helpers. Single source of truth for:
//   - The Stripe client instance (lazy-initialized so test envs without
//     a key don't error on import)
//   - The single-tier price catalog (monthly + annual)
//   - Promotion-code lookup helpers
//   - Webhook signature verification
//
// All Stripe calls go through this module. Direct `new Stripe(...)`
// calls outside this file are a code-review reject.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

/** Lazy singleton so unit tests that don't touch billing aren't forced
 *  to set STRIPE_SECRET_KEY. Throws on first access if the key is
 *  missing — that's a config error worth surfacing loudly.
 *
 *  Defensive .trim() so a CRLF accidentally stored in Secret Manager
 *  doesn't produce auth failures or weird API errors. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — billing flows are unavailable.",
    );
  }
  _stripe = new Stripe(key, {
    typescript: true,
    appInfo: { name: "GuardWell v2", url: "https://v2.app.gwcomp.com" },
  });
  return _stripe;
}

/** Price IDs from env. monthly | annual. Validated at process start
 *  (or first billing call) so we surface "STRIPE_PRICE_MONTHLY missing"
 *  with a clean message instead of a Stripe API 400.
 *
 *  Defensive .trim() on the values: when these are stored in GCP
 *  Secret Manager via PowerShell `Out-File` or `echo` a trailing
 *  CRLF can sneak in, which Stripe rejects as "No such price". */
export interface PriceCatalog {
  monthly: string;
  annual: string;
}

export function getPriceCatalog(): PriceCatalog {
  const monthly = process.env.STRIPE_PRICE_MONTHLY?.trim();
  const annual = process.env.STRIPE_PRICE_ANNUAL?.trim();
  if (!monthly || !annual) {
    throw new Error(
      "STRIPE_PRICE_MONTHLY + STRIPE_PRICE_ANNUAL must both be set.",
    );
  }
  return { monthly, annual };
}

export type BillingInterval = "monthly" | "annual";

export function priceIdForInterval(interval: BillingInterval): string {
  const c = getPriceCatalog();
  return interval === "monthly" ? c.monthly : c.annual;
}

/** Look up an active Stripe Promotion Code by its user-facing code (e.g.
 *  "BETATESTER2026"). Returns null if not found or inactive. The
 *  promotion's id (promo_xxx) is what gets passed to Checkout's
 *  `discounts: [{ promotion_code: <id> }]`. */
export async function findActivePromotionCode(
  code: string,
): Promise<Stripe.PromotionCode | null> {
  const list = await getStripe().promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });
  return list.data[0] ?? null;
}

/** Pull the underlying coupon for a promotion code so we can render
 *  "100% off forever" in the UI banner without an extra fetch in the
 *  caller. */
export async function getCouponForPromotion(
  promotionCodeId: string,
): Promise<Stripe.Coupon | null> {
  const promo = await getStripe().promotionCodes.retrieve(promotionCodeId, {
    expand: ["coupon"],
  });
  // Newer Stripe API: `promotion.coupon` is an id; expand fetches it.
  // Older API responses surface `coupon` directly. Handle both.
  const couponField = (promo as unknown as { coupon?: Stripe.Coupon })
    .coupon;
  if (couponField && typeof couponField !== "string") {
    return couponField;
  }
  // Try the new shape via untyped cast.
  const promotion = (
    promo as unknown as { promotion?: { coupon?: string | Stripe.Coupon } }
  ).promotion;
  if (promotion?.coupon) {
    if (typeof promotion.coupon === "string") {
      return await getStripe().coupons.retrieve(promotion.coupon);
    }
    return promotion.coupon;
  }
  return null;
}

/** Verify a webhook payload's Stripe-Signature header. Returns the
 *  parsed event on success; throws on tamper/expired. The raw body
 *  must be the unparsed Buffer or string — DO NOT pass an object.
 *
 *  Defensive .trim() — same CRLF concern as the API key. */
export function verifyWebhook(
  rawBody: string | Buffer,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
