// src/app/(dashboard)/programs/risk/SraAssessmentBadge.tsx
"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";

const SSR_FMT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const noopSubscribe = () => () => {};

function useLocalDate(iso: string): string {
  return useSyncExternalStore(
    noopSubscribe,
    () =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(iso),
      ),
    () => SSR_FMT.format(new Date(iso)),
  );
}

export interface SraAssessmentBadgeProps {
  completedAt: string;
  overallScore: number;
  fresh: boolean;
}

export function SraAssessmentBadge({
  completedAt,
  overallScore,
  fresh,
}: SraAssessmentBadgeProps) {
  const formatted = useLocalDate(completedAt);
  return (
    <Badge
      variant="secondary"
      className="text-[10px]"
      style={{
        color: fresh ? "var(--gw-color-compliant)" : "var(--gw-color-at-risk)",
        borderColor: fresh
          ? "var(--gw-color-compliant)"
          : "var(--gw-color-at-risk)",
      }}
    >
      {fresh ? "Fresh" : "Expired"} · {formatted} · {overallScore}% addressed
    </Badge>
  );
}
