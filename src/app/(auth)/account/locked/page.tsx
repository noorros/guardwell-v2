// src/app/(auth)/account/locked/page.tsx
//
// Phase C lockout screen. Shown when subscriptionStatus is PAST_DUE
// or CANCELED. Shows the user how to fix it (Stripe Customer Portal
// link) and what to expect (no data loss; access restored when
// payment goes through).

import { redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Logo } from "@/components/gw/Logo";
import { OpenBillingPortalButton } from "./OpenBillingPortalButton";

export const metadata = { title: "Subscription paused · Account" };
export const dynamic = "force-dynamic";

export default async function AccountLockedPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-up" as Route);

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: {
      subscriptionStatus: true,
      stripeCustomerId: true,
      currentPeriodEnd: true,
    },
  });

  // If they're not actually locked, send them home.
  if (
    practice.subscriptionStatus !== "PAST_DUE" &&
    practice.subscriptionStatus !== "CANCELED"
  ) {
    redirect("/dashboard" as Route);
  }

  const isCancelled = practice.subscriptionStatus === "CANCELED";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow">
        <Logo className="flex justify-center" height={36} />
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            {isCancelled
              ? "Your subscription is canceled"
              : "Your subscription is past due"}
          </h1>
          <p className="text-sm text-slate-500">
            {isCancelled
              ? "Your data is safe and waiting. Restart your subscription anytime to regain access."
              : "We weren't able to charge your card on file. Update your payment method to restore access — no data is lost."}
          </p>
        </div>

        <ul className="space-y-1 rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
          <li className="flex items-start gap-1.5">
            <span aria-hidden="true" className="text-emerald-600">
              ✓
            </span>
            <span>Your practice data is preserved (no deletion)</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span aria-hidden="true" className="text-emerald-600">
              ✓
            </span>
            <span>
              {isCancelled
                ? "Restart anytime — picks up where you left off"
                : "Access restored automatically when payment goes through"}
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span aria-hidden="true" className="text-emerald-600">
              ✓
            </span>
            <span>Open the Stripe portal below to update your card</span>
          </li>
        </ul>

        {practice.stripeCustomerId && (
          <OpenBillingPortalButton />
        )}
        {!practice.stripeCustomerId && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            We couldn&apos;t find a Stripe customer for your account. Email
            support@gwcomp.com and we&apos;ll get you back in.
          </p>
        )}

        <p className="text-center text-xs text-slate-500">
          Need help?{" "}
          <a
            href="mailto:support@gwcomp.com"
            className="text-blue-700 underline hover:no-underline"
          >
            support@gwcomp.com
          </a>
        </p>
      </div>
    </div>
  );
}
