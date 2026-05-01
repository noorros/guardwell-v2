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

export type FeedType = "RSS" | "ATOM" | "SCRAPE";

export interface ParsedArticle {
  title: string;
  url: string;
  summary?: string;
  rawContent?: string;
  publishDate?: Date;
}
