// src/app/(dashboard)/programs/training/TrainingStatusBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

export interface TrainingStatusBadgeProps {
  latest: {
    score: number;
    passed: boolean;
    completedAt: Date | string;
    expiresAt: Date | string;
  } | null;
}

export function TrainingStatusBadge({ latest }: TrainingStatusBadgeProps) {
  const tz = usePracticeTimezone();
  const completedDate = latest
    ? typeof latest.completedAt === "string"
      ? new Date(latest.completedAt)
      : latest.completedAt
    : null;
  const formattedCompleted = completedDate
    ? formatPracticeDateLong(completedDate, tz)
    : "";
  const expired = latest ? new Date(latest.expiresAt) <= new Date() : false;

  if (!latest) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Not started
      </Badge>
    );
  }

  if (latest.passed && !expired) {
    return (
      <Badge
        variant="secondary"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Passed {formattedCompleted} · {latest.score}%
      </Badge>
    );
  }

  if (latest.passed && expired) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Expired · retake required
      </Badge>
    );
  }

  // Latest attempt failed.
  return (
    <Badge variant="outline" className="text-[10px]">
      Failed · retry ({latest.score}%)
    </Badge>
  );
}
