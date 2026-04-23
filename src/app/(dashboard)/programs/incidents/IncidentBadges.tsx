// src/app/(dashboard)/programs/incidents/IncidentBadges.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { MAJOR_BREACH_THRESHOLD } from "@/components/gw/MajorBreachBanner";

export function IncidentStatusBadge({ status }: { status: string }) {
  const tone =
    status === "RESOLVED" || status === "CLOSED"
      ? "compliant"
      : status === "UNDER_INVESTIGATION"
        ? "needs"
        : "risk";
  const label = status.replace(/_/g, " ").toLowerCase();
  const first = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <Badge
      variant="outline"
      className="text-[10px]"
      style={{
        color: `var(--gw-color-${tone})`,
        borderColor: `var(--gw-color-${tone})`,
      }}
    >
      {first}
    </Badge>
  );
}

export function IncidentBreachBadge({
  isBreach,
  affectedCount,
}: {
  isBreach: boolean | null;
  affectedCount: number;
}) {
  if (isBreach === null) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Undetermined
      </Badge>
    );
  }
  if (isBreach === false) {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Not a breach
      </Badge>
    );
  }
  const isMajor = affectedCount >= MAJOR_BREACH_THRESHOLD;
  return (
    <Badge
      variant="outline"
      className="text-[10px]"
      style={{
        color: "var(--gw-color-risk)",
        borderColor: "var(--gw-color-risk)",
      }}
    >
      {isMajor ? "Major breach (500+)" : "Breach"}
    </Badge>
  );
}
