// Audit #21 (OSHA I-4): §1904.39 8-hour fatality reporting banner.
// Mirrors <MajorBreachBanner> for the HIPAA major-breach surface but
// for the OSHA fatality clock. Renders only when the
// INCIDENT_OSHA_FATALITY_REPORTED event has been recorded for the
// incident — server-side caller passes the deadline + practice
// timezone-formatted label.

import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { severityToColorToken } from "@/lib/severity";

export interface OshaFatalityBannerProps {
  /** §1904.39 reporting deadline (occurredAt + 8h for DEATH). */
  deadlineAt: Date;
  /** Pre-formatted deadline label in the practice's timezone, e.g.
   *  "2026-04-30 17:42 MST". Server passes via formatPracticeDateTime. */
  deadlineLabel: string;
  /** Override "now" for testing the countdown. */
  now?: Date;
  className?: string;
}

const HOUR_MS = 60 * 60 * 1000;

function hoursBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / HOUR_MS);
}

export function OshaFatalityBanner({
  deadlineAt,
  deadlineLabel,
  now = new Date(),
  className,
}: OshaFatalityBannerProps) {
  const color = severityToColorToken("risk");
  const hours = hoursBetween(now, deadlineAt);
  const remainingText =
    hours <= 0
      ? `${Math.abs(hours)} hours overdue`
      : `${hours} hour${hours === 1 ? "" : "s"} remaining`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        className,
      )}
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
      }}
    >
      <AlertOctagon
        className="mt-0.5 h-5 w-5 shrink-0"
        style={{ color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold" style={{ color }}>
          OSHA fatality reported — call OSHA within 8 hours
        </p>
        <p className="text-sm text-foreground">
          29 CFR §1904.39 deadline:{" "}
          <time dateTime={deadlineAt.toISOString()} className="font-medium">
            {deadlineLabel}
          </time>{" "}
          ({remainingText}).
        </p>
        <p className="text-xs text-muted-foreground">
          Phone: 1-800-321-OSHA (6742) or use the OSHA online reporting tool.
        </p>
      </div>
    </div>
  );
}
