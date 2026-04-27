// src/app/(dashboard)/dashboard/ComplianceTrackWidget.tsx
//
// Renders the practice's Compliance Track progress at the top of the
// dashboard. For new accounts (firstRunCompletedAt within the last 7
// days) the widget is large + primary-colored to keep onboarding
// momentum. After 7 days it demotes to a slim secondary card so the
// dashboard isn't permanently dominated by onboarding chrome.

import Link from "next/link";
import type { Route } from "next";
import { Compass } from "lucide-react";

const NEW_ACCOUNT_WINDOW_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface ComplianceTrackWidgetProps {
  totalTasks: number;
  completedTasks: number;
  /** When the first-run wizard finished. null when wizard hasn't completed. */
  firstRunCompletedAt: Date | null;
}

export function ComplianceTrackWidget({
  totalTasks,
  completedTasks,
  firstRunCompletedAt,
}: ComplianceTrackWidgetProps) {
  if (totalTasks === 0) return null;

  const pct = Math.round((completedTasks / totalTasks) * 100);
  const trackHref = "/programs/track" as Route;

  const isNew =
    firstRunCompletedAt !== null &&
    Date.now() - firstRunCompletedAt.getTime() <
      NEW_ACCOUNT_WINDOW_DAYS * ONE_DAY_MS;

  if (!isNew) {
    return (
      <Link
        href={trackHref}
        className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
      >
        <Compass className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">
          Compliance Track —{" "}
          <strong className="text-foreground">{completedTasks}</strong> of{" "}
          <strong className="text-foreground">{totalTasks}</strong> tasks
          complete
        </span>
        <span>→</span>
      </Link>
    );
  }

  // Prominent widget for accounts in the first 7 days.
  return (
    <Link
      href={trackHref}
      className="block rounded-lg border border-primary/30 bg-primary/5 p-5 hover:border-primary/50"
    >
      <div className="flex items-start gap-3">
        <Compass className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
        <div className="flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base font-semibold text-foreground">
              Your Compliance Track
            </p>
            <p className="text-xs font-medium text-muted-foreground">
              {completedTasks}/{totalTasks} complete · {pct}%
            </p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(pct, 1)}%` }}
              aria-label={`${pct}% complete`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Pick up where you left off — your full 12-week roadmap is one click
            away.
          </p>
        </div>
      </div>
    </Link>
  );
}
