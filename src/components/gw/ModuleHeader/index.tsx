// src/components/gw/ModuleHeader/index.tsx
import type { LucideIcon } from "lucide-react";
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
  className?: string;
}

export function ModuleHeader({
  icon: Icon,
  name,
  citation,
  citationHref,
  score,
  jurisdictions,
  className,
}: ModuleHeaderProps) {
  return (
    <header className={cn("flex items-start gap-5 rounded-xl border bg-card p-6", className)}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-xl font-bold text-foreground">{name}</h1>
        {citation && <RegulationCitation citation={citation} href={citationHref} />}
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
