// src/components/gw/ModuleSummaryBand/index.tsx
"use client";

import { CircleCheck, Clock, AlertTriangle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";

export interface ModuleSummaryBandProps {
  compliantCount: number;
  totalRequirements: number;
  gapCount: number;
  deadlineCount: number;
  className?: string;
}

export function ModuleSummaryBand({
  compliantCount,
  totalRequirements,
  gapCount,
  deadlineCount,
  className,
}: ModuleSummaryBandProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleFilter = (status: "compliant" | "gap") => {
    router.push(`${pathname}?status=${status}` as Route);
  };

  const deadlineTone =
    deadlineCount > 0
      ? "border-[color:var(--gw-color-needs)] bg-[color:color-mix(in_oklch,var(--gw-color-needs)_10%,transparent)] text-[color:var(--gw-color-needs)]"
      : "border-border bg-muted/40 text-muted-foreground";

  const gapTone =
    gapCount > 0
      ? "border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_10%,transparent)] text-[color:var(--gw-color-risk)]"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <section
      aria-label="Compliance summary"
      className={cn("flex flex-wrap gap-3", className)}
    >
      <button
        type="button"
        onClick={() => handleFilter("compliant")}
        aria-label={`${compliantCount} of ${totalRequirements} requirements compliant. Click to filter.`}
        className={cn(
          "flex min-w-[160px] flex-1 items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50",
          "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_10%,transparent)] text-[color:var(--gw-color-compliant)]",
        )}
      >
        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold leading-tight">
            {compliantCount} of {totalRequirements}
          </div>
          <div className="text-xs font-medium opacity-80">compliant</div>
        </div>
      </button>

      <div
        title="Deadlines available once operational pages ship"
        aria-label={`${deadlineCount} deadlines this month. Deadlines available once operational pages ship.`}
        className={cn(
          "flex min-w-[160px] flex-1 cursor-not-allowed items-start gap-3 rounded-lg border p-4 text-left",
          deadlineTone,
        )}
      >
        <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold leading-tight">
            {`${deadlineCount} deadlines this month`}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => handleFilter("gap")}
        aria-label={`${gapCount} open gaps. Click to filter.`}
        className={cn(
          "flex min-w-[160px] flex-1 items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50",
          gapTone,
        )}
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold leading-tight">
            {`${gapCount} open gaps`}
          </div>
        </div>
      </button>
    </section>
  );
}
