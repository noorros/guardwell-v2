// src/app/(auth)/sign-up/payment/success/SuccessAutoAdvance.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { getMySubscriptionStatusAction } from "./actions";

export function SuccessAutoAdvance({
  initialStatus,
}: {
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [tickCount, setTickCount] = useState(0);
  const NEXT_HREF = "/onboarding/compliance-profile" as Route;

  // If the webhook hasn't landed yet (status still INCOMPLETE), poll
  // every 2s until it flips. Stops after 30 ticks (~60s) to avoid an
  // infinite loop if the webhook never arrives.
  useEffect(() => {
    if (status !== "INCOMPLETE") return;
    if (tickCount >= 30) return;
    const id = setInterval(async () => {
      const next = await getMySubscriptionStatusAction();
      setStatus(next);
      setTickCount((c) => c + 1);
    }, 2000);
    return () => clearInterval(id);
  }, [status, tickCount]);

  // Once status is TRIALING/ACTIVE, advance after a 3s celebration.
  useEffect(() => {
    if (status === "INCOMPLETE") return;
    if (status === "PAST_DUE" || status === "CANCELED") {
      // Edge case — shouldn't happen on success page but be safe.
      router.push("/account/locked" as Route);
      return;
    }
    const id = setTimeout(() => router.push(NEXT_HREF), 3000);
    return () => clearTimeout(id);
  }, [status, router]);

  return (
    <div className="space-y-2">
      {status === "INCOMPLETE" && tickCount < 30 && (
        <p className="text-[11px] text-slate-500">
          Confirming your subscription with Stripe…
        </p>
      )}
      {status === "INCOMPLETE" && tickCount >= 30 && (
        <p className="text-[11px] text-amber-700">
          Webhook is taking longer than usual. Refresh the page in a moment
          or visit /dashboard directly.
        </p>
      )}
      {(status === "TRIALING" || status === "ACTIVE") && (
        <p className="text-[11px] text-emerald-700">
          Loading your dashboard…
        </p>
      )}
    </div>
  );
}
