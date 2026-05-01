// src/lib/regulatory/types.ts
//
// Shared types for the regulatory intelligence engine (Phase 8).

export type FrameworkCode =
  | "HIPAA"
  | "OSHA"
  | "OIG"
  | "DEA"
  | "CMS"
  | "CLIA"
  | "MACRA"
  | "TCPA"
  | "ALLERGY";

export const ALL_FRAMEWORK_CODES = [
  "HIPAA",
  "OSHA",
  "OIG",
  "DEA",
  "CMS",
  "CLIA",
  "MACRA",
  "TCPA",
  "ALLERGY",
] as const satisfies readonly FrameworkCode[];

export type Severity = "INFO" | "ADVISORY" | "URGENT";

// Mapping from RegulatoryAlert.severity (3 levels) to NotificationSeverity
// (3 levels). Lives here (not in runNotify.ts) so PR 6's UI badges can
// reuse the same source-of-truth instead of duplicating the literals or
// importing from a cron worker.
export const REGULATORY_TO_NOTIFICATION_SEVERITY: Record<
  Severity,
  "INFO" | "WARNING" | "CRITICAL"
> = {
  INFO: "INFO",
  ADVISORY: "WARNING",
  URGENT: "CRITICAL",
};

// Shadcn <Badge> variant + display label for a RegulatoryAlert.severity
// value. Lives here (not duplicated across list + detail pages) so the
// visual weight stays consistent and a future severity tier change
// (e.g. introducing CRITICAL distinct from URGENT) is a one-file edit.
export function regulatorySeverityBadgeVariant(
  severity: string,
): "default" | "destructive" | "secondary" {
  // URGENT = destructive (red), ADVISORY = default (primary), INFO = secondary.
  // Visual weight matches REGULATORY_TO_NOTIFICATION_SEVERITY (URGENT →
  // CRITICAL, ADVISORY → WARNING, INFO → INFO).
  if (severity === "URGENT") return "destructive";
  if (severity === "ADVISORY") return "default";
  return "secondary";
}

export function regulatorySeverityLabel(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

export type FeedType = "RSS" | "ATOM" | "SCRAPE";

export interface ParsedArticle {
  title: string;
  url: string;
  summary?: string;
  rawContent?: string;
  publishDate?: Date;
}
