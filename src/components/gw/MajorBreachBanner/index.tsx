import { AlertOctagon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { severityToColorToken } from "@/lib/severity";

export const MAJOR_BREACH_THRESHOLD = 500;

export interface MajorBreachBannerProps {
  affectedCount: number;
  reportingDeadline: Date;
  now?: Date;
  onDismiss?: () => void;
  className?: string;
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000;
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - f) / MS);
}

export function MajorBreachBanner({
  affectedCount,
  reportingDeadline,
  now = new Date(),
  onDismiss,
  className,
}: MajorBreachBannerProps) {
  if (affectedCount < MAJOR_BREACH_THRESHOLD) return null;

  const color = severityToColorToken("risk");
  const days = daysBetween(now, reportingDeadline);
  const deadlineText = days <= 0
    ? `${Math.abs(days)} days overdue`
    : `in ${days} days`;
  const formattedCount = new Intl.NumberFormat("en-US").format(affectedCount);

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
          Major breach: 500+ individuals affected
        </p>
        <p className="text-sm text-foreground">
          {formattedCount} individuals affected. HHS notification and media notice
          required{" "}
          <time dateTime={reportingDeadline.toISOString()} className="font-medium">
            {deadlineText}
          </time>
          .
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-background"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
