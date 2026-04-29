// src/lib/billing/portal.ts
//
// Shared Stripe Customer Portal action. Used by:
//   - /account/locked (when subscription is PAST_DUE / CANCELED)
//   - /settings/subscription (always-available management entry)
"use server";

import { getStripe } from "@/lib/stripe";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export type PortalActionResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error: "no-stripe-customer" | "not-authenticated" | "stripe-error";
    };

export async function openBillingPortalAction(args?: {
  returnUrl?: string;
}): Promise<PortalActionResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "not-authenticated" };

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { stripeCustomerId: true },
  });

  if (!practice.stripeCustomerId) {
    return { ok: false, error: "no-stripe-customer" };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: practice.stripeCustomerId,
      return_url:
        args?.returnUrl ?? "https://v2.app.gwcomp.com/settings/subscription",
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "stripe-error" };
  }
}
