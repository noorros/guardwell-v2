import { AlertTriangle, Clock, CircleCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysUntilToSeverity, severityToColorToken, type Severity } from "@/lib/severity";

export interface DeadlineWarningProps {
  label: string;
  deadline: Date;
  now?: Date;
  description?: string;
  className?: string;
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000;
  // Use UTC midnight on both sides so DST doesn't wobble the boundary.
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - f) / MS);
}

function formatRelative(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  risk: AlertTriangle,
  needs: Clock,
  good: Clock,
  compliant: CircleCheck,
};

export function DeadlineWarning({
  label,
  deadline,
  now = new Date(),
  description,
  className,
}: DeadlineWarningProps) {
  const days = daysBetween(now, deadline);
  const severity = daysUntilToSeverity(days);
  const color = severityToColorToken(severity);
  const Icon = SEVERITY_ICON[severity];
  const relative = formatRelative(days);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        className,
      )}
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
      }}
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {label}{" "}
          <time
            dateTime={deadline.toISOString()}
            className="font-normal text-muted-foreground"
          >
            — {relative}
          </time>
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
