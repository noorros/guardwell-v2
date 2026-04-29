// src/app/(dashboard)/programs/credentials/CredentialStatusBadge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDateLong } from "@/lib/audit/format";

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
  const tz = usePracticeTimezone();
  const formatted = expiryDate
    ? formatPracticeDateLong(new Date(expiryDate), tz)
    : "";

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
