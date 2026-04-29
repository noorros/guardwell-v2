// src/components/gw/ConciergeCostTile/index.tsx
//
// Dashboard "Concierge usage" tile. Server component — fetches its own
// data via getConciergeMonthlySpend so the parent dashboard doesn't need
// to thread costUsd through its existing Promise.all aggregation.
//
// Hides entirely when there's no usage this month — empty zeros pollute
// a glanceable dashboard. Once messageCount > 0, renders a clickable
// link to /concierge (the full-page Concierge view).

import { Bot } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { getConciergeMonthlySpend } from "@/lib/ai/conciergeMonthlySpend";

export interface ConciergeCostTileProps {
  practiceId: string;
}

export async function ConciergeCostTile({
  practiceId,
}: ConciergeCostTileProps) {
  const { costUsd, messageCount } = await getConciergeMonthlySpend({
    practiceId,
  });

  // Hide the tile entirely when there's no usage — empty-state pollution
  // on a dashboard that's meant to be glanceable.
  if (messageCount === 0) return null;

  const formattedCost = formatUsd(costUsd);

  return (
    <Link
      href={"/concierge" as Route}
      className="block rounded-lg border bg-card p-4 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-sm font-medium">Concierge usage</span>
        </div>
        <span
          className="text-sm tabular-nums"
          aria-label={`${formattedCost} this month`}
        >
          {formattedCost}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {messageCount} message{messageCount === 1 ? "" : "s"} this month
      </p>
    </Link>
  );
}

function formatUsd(amount: number): string {
  // Sub-cent usage ($0.0001-style fractions of a penny) rounds visually to
  // $0.00 — explicit short-circuit keeps the formatter from flickering
  // between "$0.00" and the same value via Intl on different inputs.
  if (amount < 0.01) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
