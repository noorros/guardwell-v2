// src/app/(dashboard)/programs/policies/AdoptedBadge.tsx
"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";

// Deterministic for SSR so hydration matches.
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

export interface AdoptedBadgeProps {
  adoptedAt: string;
}

export function AdoptedBadge({ adoptedAt }: AdoptedBadgeProps) {
  const formatted = useLocalDate(adoptedAt);
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
  const formatted = useLocalDate(retiredAt);
  return (
    <Badge variant="outline" className="text-[10px]">
      <time dateTime={retiredAt}>Retired {formatted}</time>
    </Badge>
  );
}
