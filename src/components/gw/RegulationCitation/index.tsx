// src/components/gw/RegulationCitation/index.tsx
import { cn } from "@/lib/utils";

export interface RegulationCitationProps {
  citation: string;
  href?: string;
  className?: string;
}

export function RegulationCitation({ citation, href, className }: RegulationCitationProps) {
  const baseClass = cn(
    "inline-block font-mono text-xs tabular-nums text-muted-foreground",
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(baseClass, "underline decoration-dotted underline-offset-2 hover:text-foreground")}
      >
        {citation}
      </a>
    );
  }
  return <span className={baseClass}>{citation}</span>;
}
