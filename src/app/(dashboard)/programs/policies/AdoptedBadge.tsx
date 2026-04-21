// src/app/(dashboard)/programs/policies/AdoptedBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";

const FMT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export interface AdoptedBadgeProps {
  adoptedAt: string; // ISO
}

export function AdoptedBadge({ adoptedAt }: AdoptedBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className="text-[10px]"
      style={{
        color: "var(--gw-color-compliant)",
        borderColor: "var(--gw-color-compliant)",
      }}
      suppressHydrationWarning
    >
      <time dateTime={adoptedAt} suppressHydrationWarning>
        Adopted {FMT.format(new Date(adoptedAt))}
      </time>
    </Badge>
  );
}

export interface RetiredBadgeProps {
  retiredAt: string;
}

export function RetiredBadge({ retiredAt }: RetiredBadgeProps) {
  return (
    <Badge variant="outline" className="text-[10px]" suppressHydrationWarning>
      <time dateTime={retiredAt} suppressHydrationWarning>
        Retired {FMT.format(new Date(retiredAt))}
      </time>
    </Badge>
  );
}
