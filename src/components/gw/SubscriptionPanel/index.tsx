// src/components/gw/SubscriptionPanel/index.tsx
//
// Displays the practice's current Stripe subscription state and a
// "Manage subscription" button that opens the Stripe Customer Portal.
// Used by /settings/subscription.

"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openBillingPortalAction } from "@/lib/billing/portal";

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export interface SubscriptionPanelProps {
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  cardLast4: string | null;
  planLabel: string;
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const variant: "default" | "secondary" | "destructive" =
    status === "ACTIVE"
      ? "default"
      : status === "PAST_DUE" || status === "CANCELED"
        ? "destructive"
        : "secondary";
  const label =
    status === "ACTIVE"
      ? "Active"
      : status === "TRIALING"
        ? "Trial"
        : status === "PAST_DUE"
          ? "Past due"
          : status === "CANCELED"
            ? "Canceled"
            : "Incomplete";
  return <Badge variant={variant}>{label}</Badge>;
}

function daysUntil(date: Date | null): number {
  if (!date) return 0;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  // Format in UTC so the rendered calendar date matches the instant stored
  // in Stripe (and is stable across server vs. client timezones).
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buttonLabel(status: SubscriptionStatus): string {
  if (status === "PAST_DUE") return "Update payment method";
  if (status === "CANCELED") return "Reactivate subscription";
  return "Manage subscription";
}

export function SubscriptionPanel(props: SubscriptionPanelProps) {
  const {
    subscriptionStatus,
    currentPeriodEnd,
    trialEndsAt,
    stripeCustomerId,
    cardLast4,
    planLabel,
  } = props;
  const [pending, startTransition] = useTransition();

  function handleOpenPortal() {
    startTransition(async () => {
      const result = await openBillingPortalAction();
      if (result.ok) {
        // Open in a new tab so the user can come back to GuardWell.
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{planLabel}</h2>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={subscriptionStatus} />
            {subscriptionStatus === "TRIALING" && trialEndsAt && (
              <span className="text-sm text-muted-foreground">
                {daysUntil(trialEndsAt)} days remaining
              </span>
            )}
            {subscriptionStatus === "ACTIVE" && currentPeriodEnd && (
              <span className="text-sm text-muted-foreground">
                Renews on <span>{formatDate(currentPeriodEnd)}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {cardLast4 && (
        <p className="text-sm text-muted-foreground">
          Payment method: card ending in {cardLast4}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        {stripeCustomerId && (
          <Button onClick={handleOpenPortal} disabled={pending}>
            {pending ? "Opening…" : buttonLabel(subscriptionStatus)}
          </Button>
        )}
        {subscriptionStatus === "TRIALING" && (
          <Button variant="outline" asChild>
            <a href="/api/stripe/checkout?fromTrial=1">Subscribe now</a>
          </Button>
        )}
      </div>
    </div>
  );
}
