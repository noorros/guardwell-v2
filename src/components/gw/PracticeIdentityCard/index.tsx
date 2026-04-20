// src/components/gw/PracticeIdentityCard/index.tsx
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PracticeRoleLabel = "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
export type OfficerRole = "Privacy Officer" | "Security Officer" | "Compliance Officer";

export interface PracticeIdentityCardProps {
  name: string;
  primaryState: string;
  specialty?: string;
  role?: PracticeRoleLabel;
  officerRoles?: OfficerRole[];
  setupProgress?: number;
  className?: string;
}

export function PracticeIdentityCard({
  name,
  primaryState,
  specialty,
  role,
  officerRoles,
  setupProgress,
  className,
}: PracticeIdentityCardProps) {
  const progress = setupProgress === undefined
    ? undefined
    : Math.max(0, Math.min(100, Math.round(setupProgress)));
  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{name}</h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{primaryState}</span>
              {specialty && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{specialty}</span>
                </>
              )}
            </p>
          </div>
          {role && <Badge variant="secondary">{role}</Badge>}
        </div>
        {officerRoles && officerRoles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {officerRoles.map((r) => (
              <Badge key={r} variant="outline">{r}</Badge>
            ))}
          </div>
        )}
        {progress !== undefined && (
          <div className="flex items-center gap-2 pt-1">
            {progress === 100 ? (
              <CheckCircle2
                className="h-4 w-4 text-[color:var(--gw-color-compliant)]"
                aria-hidden="true"
              />
            ) : null}
            <span className="text-xs text-muted-foreground">
              Setup: {progress}% {progress === 100 ? "complete" : null}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
