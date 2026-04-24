// src/app/(auth)/sign-up/payment/PayButton.tsx
"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "./actions";

export interface PayButtonProps {
  billingInterval: "monthly" | "annual";
  promoCode?: string;
  /** Set to true if the resolved promo is 100% off — changes button
   *  copy + tone since "no charge" is more accurate than "free trial". */
  promoIsHundredOff?: boolean;
}

export function PayButton({
  billingInterval,
  promoCode,
  promoIsHundredOff,
}: PayButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await createCheckoutSessionAction({
        billingInterval,
        promoCode,
      });
      if (res.ok) {
        window.location.href = res.checkoutUrl;
      } else if (res.error === "already-subscribed") {
        // Edge case: user navigated back to /sign-up/payment after
        // already paying. Skip them onward.
        window.location.href = "/onboarding/compliance-profile";
      } else {
        setError(res.error);
      }
    });
  };

  const label = promoIsHundredOff
    ? "Activate free account"
    : "Start 7-day free trial →";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Redirecting to Stripe…" : label}
      </button>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <p className="text-center text-[10px] text-slate-400">
        Stripe-secured checkout. Card details never touch our servers.
      </p>
    </div>
  );
}
