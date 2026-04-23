import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { cn, scoreToLabel, NOT_ASSESSED_LABEL } from "@/lib/utils";

export interface ComplianceCardProps {
  title: string;
  score: number;
  subtitle?: string;
  href?: string;
  footer?: ReactNode;
  className?: string;
  /** When false, renders in "Not assessed" setup state. Defaults to true. */
  assessed?: boolean;
}

function CardBody({ title, score, subtitle, footer, assessed = true }: Omit<ComplianceCardProps, "href" | "className">) {
  const label = assessed ? scoreToLabel(score) : NOT_ASSESSED_LABEL;
  return (
    <CardContent className="flex items-center gap-4 p-5">
      <ScoreRing score={score} size={72} strokeWidth={8} assessed={assessed} />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="secondary">{label}</Badge>
          {footer}
        </div>
      </div>
    </CardContent>
  );
}

export function ComplianceCard({ title, score, subtitle, href, footer, className, assessed }: ComplianceCardProps) {
  const body = <CardBody title={title} score={score} subtitle={subtitle} footer={footer} assessed={assessed} />;
  if (href) {
    return (
      <a href={href} className={cn("block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", className)}>
        <Card className="transition-colors hover:bg-accent">{body}</Card>
      </a>
    );
  }
  return <Card className={className}>{body}</Card>;
}
