// src/app/(auth)/sign-up/payment/page.tsx
//
// Phase C payment page. Shown to users with subscriptionStatus =
// INCOMPLETE after they've completed sign-up + email verification.
//
// Three exit paths:
//   - Pay button → Stripe Checkout (handled in PayButton client island)
//   - Already-paid (TRIALING/ACTIVE) → redirect to compliance-profile
//   - 100%-off promo applied → button becomes "Activate free account",
//     no card collected, trial skipped (handled in checkout-session
//     server action)

import { redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { findActivePromotionCode, getCouponForPromotion } from "@/lib/stripe";
import { PaymentInner } from "./PaymentInner";

export const metadata = { title: "Choose your plan · Sign up" };
export const dynamic = "force-dynamic";

export default async function PaymentPage({
  searchParams,
}: {
  searchParams?: Promise<{ promo?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const promo = sp.promo?.trim() ?? null;

  const pu = await getPracticeUser();
  if (!pu) {
    // Defensive: someone hit /sign-up/payment without a Practice. Bounce
    // them to the start of the onboarding funnel.
    redirect("/sign-up" as Route);
  }

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { id: true, name: true, subscriptionStatus: true },
  });

  // Already paid? Skip onward.
  if (
    practice.subscriptionStatus === "TRIALING" ||
    practice.subscriptionStatus === "ACTIVE"
  ) {
    redirect("/onboarding/compliance-profile" as Route);
  }

  // Pre-resolve a known promo code so we can render "BETATESTER2026 —
  // 100% off forever, no card required" before the user clicks Pay.
  let promoBanner: {
    code: string;
    label: string;
    isHundredOff: boolean;
  } | null = null;
  if (promo) {
    const promotion = await findActivePromotionCode(promo);
    if (promotion) {
      const coupon = await getCouponForPromotion(promotion.id);
      const isHundredOff = coupon?.percent_off === 100;
      promoBanner = {
        code: promotion.code,
        label: isHundredOff
          ? `${promotion.code} applied — $0/month, no card required.`
          : `${promotion.code} applied — discount will show at checkout.`,
        isHundredOff,
      };
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <PaymentInner
        practiceName={practice.name}
        promoBanner={promoBanner}
        promoParam={promo}
      />
    </div>
  );
}

