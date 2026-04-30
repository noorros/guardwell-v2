// src/lib/credentials/status.ts
//
// Audit #16 (Credentials I-5 + I-11): single source of truth for the
// EXPIRING_SOON window + the credential status derivation. Before this
// helper:
//   - src/app/(dashboard)/programs/credentials/page.tsx used 90 days
//   - src/components/gw/ConciergeConversation prompts mentioned 90 days
//   - src/lib/audit/credentials-register-pdf.tsx used 60 days
//   - src/lib/notifications/generators.ts used 60 days
// Same credential could render yellow ("Expiring soon") on the dashboard
// and green ("Current") on the printed register PDF — confusing for
// audit defense and for users planning renewals.
//
// All four surfaces now import EXPIRING_SOON_DAYS + getCredentialStatus
// from here. The window is 90 days — chosen to give the renewal-
// milestone defaults (90/60/30/7) a chance to fire BEFORE the badge
// flips to yellow, so users see the heads-up before the visual
// urgency cue lands.

export const EXPIRING_SOON_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CredentialStatus =
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "NO_EXPIRY";

/**
 * Derive a credential's status from its expiryDate. `now` is injectable
 * for tests + for the PDF generator (which captures `generatedAt` once
 * and reuses it across rows for stable batched output).
 */
export function getCredentialStatus(
  expiryDate: Date | null | undefined,
  now: Date,
): CredentialStatus {
  if (!expiryDate) return "NO_EXPIRY";
  const ms = expiryDate.getTime() - now.getTime();
  if (ms < 0) return "EXPIRED";
  if (ms / DAY_MS <= EXPIRING_SOON_DAYS) return "EXPIRING_SOON";
  return "ACTIVE";
}
