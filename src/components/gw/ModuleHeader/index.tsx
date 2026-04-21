// src/components/gw/ModuleHeader/index.tsx
import type { LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { RegulationCitation } from "@/components/gw/RegulationCitation";
import { cn } from "@/lib/utils";

export interface ModuleHeaderProps {
  icon: LucideIcon;
  name: string;
  citation?: string;
  citationHref?: string;
  score?: number;
  jurisdictions?: string[];
  /**
   * Timestamp of the practice's last scoring pass for this framework.
   * - null / undefined → "Not assessed yet"
   * - <= 90 days old → "Last assessed X ago"
   * - > 90 days old  → same text + an amber "Stale" chip
   *
   * Per contract Section A, assessments go stale at 90 days.
   */
  assessedAt?: Date | null;
  /**
   * Override "now" for stale-window comparison. Kept injectable so the
   * component stays pure-in-render (matches DeadlineWarning's pattern) and
   * tests can pin time.
   */
  now?: Date;
  className?: string;
}

const STALE_MS = 90 * 24 * 60 * 60 * 1000;

export function ModuleHeader({
  icon: Icon,
  name,
  citation,
  citationHref,
  score,
  jurisdictions,
  assessedAt,
  now = new Date(),
  className,
}: ModuleHeaderProps) {
  const isStale =
    assessedAt != null && now.getTime() - assessedAt.getTime() > STALE_MS;

  return (
    <header className={cn("flex items-start gap-5 rounded-xl border bg-card p-6", className)}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-xl font-bold text-foreground">{name}</h1>
        {citation && <RegulationCitation citation={citation} href={citationHref} />}
        <div className="flex flex-wrap items-center gap-2">
          {assessedAt ? (
            <span className="text-xs text-muted-foreground">
              Last assessed {formatDistanceToNow(assessedAt, { addSuffix: true })}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not assessed yet</span>
          )}
          {isStale && (
            <Badge
              variant="outline"
              className="border-[color:var(--gw-color-needs)] bg-[color:color-mix(in_oklch,var(--gw-color-needs)_15%,transparent)] text-[color:var(--gw-color-needs)]"
            >
              Stale
            </Badge>
          )}
        </div>
        {jurisdictions && jurisdictions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {jurisdictions.map((j) => (
              <Badge key={j} variant="secondary">{j}</Badge>
            ))}
          </div>
        )}
      </div>
      {typeof score === "number" && (
        <ScoreRing score={score} size={72} strokeWidth={8} />
      )}
    </header>
  );
}
