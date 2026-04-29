// src/app/(auth)/account/locked/OpenBillingPortalButton.tsx
"use client";

import { useState, useTransition } from "react";
import { openBillingPortalAction } from "@/lib/billing/portal";

export function OpenBillingPortalButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await openBillingPortalAction();
      if (res.ok) {
        window.location.href = res.url;
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Opening Stripe portal…" : "Update payment method →"}
      </button>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
