// src/app/(dashboard)/programs/vendors/BaaStatusBadge.tsx
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
  const executedDate = useLocalDate(baaExecutedAt ?? "1970-01-01T00:00:00Z");
  const expiresDate = useLocalDate(baaExpiresAt ?? "1970-01-01T00:00:00Z");

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
