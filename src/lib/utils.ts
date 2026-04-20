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
