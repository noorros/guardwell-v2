// src/app/(dashboard)/programs/vendors/BaaStatusBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

export interface BaaStatusBadgeProps {
  processesPhi: boolean;
  baaExecutedAt: string | null;
  baaExpiresAt: string | null;
}

export function BaaStatusBadge({
  processesPhi,
  baaExecutedAt,
  baaExpiresAt,
}: BaaStatusBadgeProps) {
  const tz = usePracticeTimezone();
  const executedDate = baaExecutedAt
    ? formatPracticeDateLong(new Date(baaExecutedAt), tz)
    : "";
  const expiresDate = baaExpiresAt
    ? formatPracticeDateLong(new Date(baaExpiresAt), tz)
    : "";

  if (!processesPhi) {
    return (
      <Badge variant="outline" className="text-[10px]">
        No PHI access
      </Badge>
    );
  }

  if (!baaExecutedAt) {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-at-risk)",
          borderColor: "var(--gw-color-at-risk)",
        }}
      >
        BAA missing
      </Badge>
    );
  }

  const expired = baaExpiresAt && new Date(baaExpiresAt) <= new Date();
  if (expired) {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-at-risk)",
          borderColor: "var(--gw-color-at-risk)",
        }}
      >
        BAA expired {expiresDate}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="text-[10px]"
      style={{
        color: "var(--gw-color-compliant)",
        borderColor: "var(--gw-color-compliant)",
      }}
    >
      BAA signed {executedDate}
    </Badge>
  );
}
