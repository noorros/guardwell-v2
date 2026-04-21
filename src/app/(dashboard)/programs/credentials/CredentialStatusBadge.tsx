// src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx
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

export type CredentialStatus =
  | "NO_EXPIRY"
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED";

export interface CredentialStatusBadgeProps {
  status: CredentialStatus;
  expiryDate: string | null;
}

export function CredentialStatusBadge({
  status,
  expiryDate,
}: CredentialStatusBadgeProps) {
  const formatted = useLocalDate(expiryDate ?? "1970-01-01T00:00:00Z");

  if (status === "NO_EXPIRY") {
    return (
      <Badge
        variant="secondary"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-compliant)",
          borderColor: "var(--gw-color-compliant)",
        }}
      >
        Active · no expiry
      </Badge>
    );
  }

  if (status === "EXPIRED") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-at-risk)",
          borderColor: "var(--gw-color-at-risk)",
        }}
      >
        Expired {formatted}
      </Badge>
    );
  }

  if (status === "EXPIRING_SOON") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color: "var(--gw-color-warn)",
          borderColor: "var(--gw-color-warn)",
        }}
      >
        Expiring {formatted}
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
      Active · expires {formatted}
    </Badge>
  );
}
