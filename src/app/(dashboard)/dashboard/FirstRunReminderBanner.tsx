import Link from "next/link";
import type { Route } from "next";
import { Sparkles } from "lucide-react";

export function FirstRunReminderBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Finish your 15-minute setup
        </p>
        <p className="text-sm text-muted-foreground">
          Designate officers, adopt your Privacy Policy, take HIPAA Basics, and
          invite your team. Gets you to compliance score 30.
        </p>
      </div>
      <Link
        href={"/onboarding/first-run" as Route}
        className="shrink-0 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Continue setup →
      </Link>
    </div>
  );
}
