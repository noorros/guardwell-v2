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

export type FeedType = "RSS" | "ATOM" | "SCRAPE";

export interface ParsedArticle {
  title: string;
  url: string;
  summary?: string;
  rawContent?: string;
  publishDate?: Date;
}
