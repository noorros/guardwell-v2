// src/app/(auth)/sign-up/payment/success/page.tsx
//
// Phase C post-Checkout landing. Stripe redirects here after a
// successful Checkout session. We don't strictly need to do anything
// at the request layer (the webhook handles state) — this page is a
// confirmation moment + a 3-second auto-advance to compliance-profile.
//
// We DO call our own pollSubscriptionStatus client-side because the
// Stripe webhook may take a few seconds to reach us; the UI shouldn't
// race ahead before the practice flips to TRIALING.

import { redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Logo } from "@/components/gw/Logo";
import { SuccessAutoAdvance } from "./SuccessAutoAdvance";

export const metadata = { title: "Payment confirmed · Sign up" };
export const dynamic = "force-dynamic";

export default async function PaymentSuccessPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-up" as Route);

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { subscriptionStatus: true, trialEndsAt: true },
  });

  // If the webhook already landed and the practice is past TRIALING,
  // this page is a brief moment of celebration before going onward.
  // Otherwise (e.g. webhook still en route), the client island polls
  // the subscriptionStatus until it flips.

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 text-center shadow">
        <Logo className="flex justify-center" height={36} />
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">You&apos;re in</h1>
        <p className="text-sm text-slate-500">
          {practice.subscriptionStatus === "TRIALING" && practice.trialEndsAt
            ? `Your 7-day free trial runs through ${practice.trialEndsAt.toISOString().slice(0, 10)}. We won't charge anything until then. Cancel anytime in /settings/billing.`
            : "Your subscription is active. Cancel anytime in /settings/billing."}
        </p>
        <SuccessAutoAdvance
          initialStatus={practice.subscriptionStatus}
        />
      </div>
    </div>
  );
}
