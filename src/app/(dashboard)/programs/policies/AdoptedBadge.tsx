// src/app/(dashboard)/programs/policies/AdoptedBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

export interface AdoptedBadgeProps {
  adoptedAt: string;
}

export function AdoptedBadge({ adoptedAt }: AdoptedBadgeProps) {
  const tz = usePracticeTimezone();
  const formatted = formatPracticeDateLong(new Date(adoptedAt), tz);
  return (
    <Badge
      variant="secondary"
      className="text-[10px]"
      style={{
        color: "var(--gw-color-compliant)",
        borderColor: "var(--gw-color-compliant)",
      }}
    >
      <time dateTime={adoptedAt}>Adopted {formatted}</time>
    </Badge>
  );
}

export interface RetiredBadgeProps {
  retiredAt: string;
}

export function RetiredBadge({ retiredAt }: RetiredBadgeProps) {
  const tz = usePracticeTimezone();
  const formatted = formatPracticeDateLong(new Date(retiredAt), tz);
  return (
    <Badge variant="outline" className="text-[10px]">
      <time dateTime={retiredAt}>Retired {formatted}</time>
    </Badge>
  );
}
