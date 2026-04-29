// src/app/(dashboard)/programs/risk/SraAssessmentBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

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
  const tz = usePracticeTimezone();
  const formatted = formatPracticeDateLong(new Date(completedAt), tz);
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
