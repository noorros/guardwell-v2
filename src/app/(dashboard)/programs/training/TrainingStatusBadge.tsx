// src/app/(dashboard)/programs/training/TrainingStatusBadge.tsx
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

export interface TrainingStatusBadgeProps {
  latest: {
    score: number;
    passed: boolean;
    completedAt: Date | string;
    expiresAt: Date | string;
  } | null;
}

export function TrainingStatusBadge({ latest }: TrainingStatusBadgeProps) {
  const completedIso =
    latest && (typeof latest.completedAt === "string"
      ? latest.completedAt
      : latest.completedAt.toISOString());
  const formattedCompleted = useLocalDate(completedIso ?? "1970-01-01T00:00:00Z");
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
