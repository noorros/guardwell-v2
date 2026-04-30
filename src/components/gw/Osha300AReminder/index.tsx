// src/components/gw/Osha300AReminder/index.tsx
//
// Phase 2 Section G B1 (v2 feature recovery, 2026-04-30):
// OSHA Form 300A annual-summary posting reminder. §1904.32(b)(6) requires
// the prior-year 300A summary to be POSTED in a conspicuous location from
// Feb 1 through Apr 30 each year. Notification cron only nudges through
// Feb 1 (audit #21 generator); this banner picks up the in-window surface
// inline on /modules/osha so the user sees the deadline approaching.
//
// Behavior:
//   - Renders only when `now` falls in [Feb 1 00:00, May 1 00:00) of the
//     practice's timezone. Outside the window: returns null.
//   - Color/icon escalation by days-remaining (yellow → orange → red),
//     mirroring DeadlineWarning's severity bands.
//   - Pre-formats the deadline label in practice TZ (no UTC drift).
//
// Note on the year shown: the form covers the PRIOR calendar year, so
// the headline says "Post your 2025 OSHA Form 300A" when in the 2026
// window. The window year (2026 in that example) is the year of Apr 30.

import { CalendarClock, AlertTriangle, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatPracticeDateLong,
  getPracticeYear,
} from "@/lib/audit/format";
import {
  daysUntilToSeverity,
  severityToColorToken,
  type Severity,
} from "@/lib/severity";
import { cn } from "@/lib/utils";

export interface Osha300AReminderProps {
  /** Date to evaluate against. Defaults to now. Injectable for tests. */
  now?: Date;
  /** Practice IANA timezone. Defaults to "UTC". Determines window boundaries. */
  tz?: string | null;
  /** Optional href for the "Generate Form 300A" CTA. Omit to hide the link. */
  href?: string;
  className?: string;
}

const DAY_MS = 86_400_000;

/**
 * UTC instant for YYYY-MM-DD 00:00:00 as observed in `tz`. Inlined from
 * the audit/format.ts internal helper because we need it at component
 * render time and can't import the unexported `zonedYmdToUtc`.
 *
 * Algorithm: pick a UTC candidate, ask Intl what zoned wall-clock that
 * represents, compute the offset, subtract it. One iteration suffices
 * for a midnight target except across the DST boundary; two iterations
 * always converge.
 */
function zonedYmdToUtc(
  year: number,
  month1to12: number,
  day: number,
  tz: string,
): Date {
  let utcMs = Date.UTC(year, month1to12 - 1, day, 0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = getZoneOffsetMinutes(new Date(utcMs), tz);
    const corrected =
      Date.UTC(year, month1to12 - 1, day, 0, 0, 0, 0) - offsetMin * 60_000;
    if (corrected === utcMs) break;
    utcMs = corrected;
  }
  return new Date(utcMs);
}

function getZoneOffsetMinutes(at: Date, zone: string): number {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  risk: AlertTriangle,
  needs: Clock,
  good: CalendarClock,
  compliant: CalendarClock,
};

export function Osha300AReminder({
  now = new Date(),
  tz,
  href,
  className,
}: Osha300AReminderProps) {
  const zone = tz && tz.length > 0 ? tz : "UTC";
  // Calendar year in the practice's timezone — Apr 15 in California is still
  // 2026 even when server-UTC has rolled over to 2027 on Dec 31 22:00 PST.
  const localYear = getPracticeYear(now, zone);
  // Window: [Feb 1 00:00, May 1 00:00) in practice TZ. We use May 1 00:00 as
  // the exclusive upper bound so the entire calendar day Apr 30 is in-window
  // including the final minute (Apr 30 23:59).
  const windowStartUtc = zonedYmdToUtc(localYear, 2, 1, zone);
  const windowEndUtc = zonedYmdToUtc(localYear, 5, 1, zone);
  const inWindow =
    now.getTime() >= windowStartUtc.getTime() &&
    now.getTime() < windowEndUtc.getTime();
  if (!inWindow) return null;

  // Deadline = Apr 30 of the local year, presented as the last instant of
  // the day so the <time> element semantically represents the posting
  // deadline (end-of-day Apr 30, not midnight).
  // For days-remaining math we use [now, May 1 00:00) so a banner shown
  // on Apr 30 23:59 still reads "0 days remaining" rather than "-1 day".
  const msUntilEnd = windowEndUtc.getTime() - now.getTime();
  const daysToDeadline = Math.max(0, Math.ceil(msUntilEnd / DAY_MS) - 1);

  const severity = daysUntilToSeverity(daysToDeadline);
  const color = severityToColorToken(severity);
  const Icon = SEVERITY_ICON[severity];

  // Form 300A summarizes the PRIOR calendar year's recordable injuries.
  const reminderYear = localYear - 1;
  const deadlineEndOfDay = new Date(windowEndUtc.getTime() - 1);
  const deadlineLabel = formatPracticeDateLong(deadlineEndOfDay, zone);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        className,
      )}
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
      }}
    >
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0"
        style={{ color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold" style={{ color }}>
          OSHA Form 300A annual summary — required posting period (29 CFR
          §1904.32(b)(6))
        </p>
        <p className="text-sm text-foreground">
          Post the {reminderYear} Form 300A in a conspicuous workplace
          location for employees to view.{" "}
          <time
            dateTime={deadlineEndOfDay.toISOString()}
            className="font-medium"
          >
            {daysToDeadline === 0
              ? `Posting deadline: ${deadlineLabel} (today)`
              : `${daysToDeadline} day${daysToDeadline === 1 ? "" : "s"} left to post (deadline ${deadlineLabel})`}
          </time>
          .
        </p>
        {href && (
          <p className="pt-1">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
            >
              Generate Form 300 PDF
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
