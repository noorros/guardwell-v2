// Shared utilities. No React, no Next.js-specific imports here — keep
// composable and tree-shakeable.

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names safely (later wins on conflict). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compliance score → label per ADR-0005 thresholds. */
export type ComplianceLabel = "Compliant" | "Good" | "Needs Work" | "At Risk";

export function scoreToLabel(score: number): ComplianceLabel {
  if (score >= 90) return "Compliant";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs Work";
  return "At Risk";
}

/** Compliance score → CSS color token name. */
export function scoreToColorToken(score: number): string {
  if (score >= 90) return "var(--gw-color-compliant)";
  if (score >= 70) return "var(--gw-color-good)";
  if (score >= 50) return "var(--gw-color-needs)";
  return "var(--gw-color-risk)";
}

/** Used when a framework has no ComplianceItem rows yet — paints the score
 *  ring / dot blue and swaps the status label to "Not assessed". Kept
 *  distinct from scoreToColorToken so the threshold pipeline stays pure. */
export const NOT_ASSESSED_LABEL = "Not assessed" as const;
export const NOT_ASSESSED_COLOR_TOKEN = "var(--gw-color-setup)";

/**
 * Compute up to 2-letter initials for the avatar.
 * Prefers display name (first letter of first 2 parts).
 * Falls back to first 2 letters of the email local-part.
 * Returns "??" for empty input.
 */
export function computeUserInitials(email: string, displayName?: string): string {
  if (displayName && displayName.trim().length > 0) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (!email) return "??";
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "??";
}
