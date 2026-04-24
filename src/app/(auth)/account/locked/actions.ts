// src/app/(auth)/account/locked/actions.ts
"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { getStripe } from "@/lib/stripe";

export async function openBillingPortalAction(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "no-practice" };

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { stripeCustomerId: true },
  });
  if (!practice.stripeCustomerId) {
    return { ok: false, error: "no-stripe-customer" };
  }

  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://v2.app.gwcomp.com";

  const session = await getStripe().billingPortal.sessions.create({
    customer: practice.stripeCustomerId,
    return_url: `${origin}/dashboard`,
  });

  return { ok: true, url: session.url };
}
