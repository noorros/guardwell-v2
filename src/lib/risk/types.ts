// src/lib/risk/types.ts
//
// Shared types for the Phase 5 risk + CAP module. Mirrors the pattern
// in src/lib/regulatory/types.ts: union types co-located with display
// helpers (severity badge variants, status labels) so one file change
// covers schema literals + UI.

export type RiskSource =
  | "SRA"
  | "TECHNICAL_ASSESSMENT"
  | "MANUAL"
  | "INCIDENT_FOLLOWUP"
  | "REGULATORY_ALERT";

export const ALL_RISK_SOURCES = [
  "SRA",
  "TECHNICAL_ASSESSMENT",
  "MANUAL",
  "INCIDENT_FOLLOWUP",
  "REGULATORY_ALERT",
] as const satisfies readonly RiskSource[];

export type RiskSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const ALL_RISK_SEVERITIES = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const satisfies readonly RiskSeverity[];

export type RiskItemStatus = "OPEN" | "MITIGATED" | "ACCEPTED" | "TRANSFERRED";

export type CapStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

// Effective CAP status — CAPs whose dueDate has passed and aren't
// COMPLETED render as OVERDUE. Stored value never changes; OVERDUE is
// purely derived. See src/lib/risk/capStatus.ts.
export type EffectiveCapStatus = CapStatus | "OVERDUE";

export type RiskWeight = "LOW" | "MEDIUM" | "HIGH";

export type TechCategory =
  | "NETWORK"
  | "ENDPOINT"
  | "CLOUD"
  | "ACCESS"
  | "MONITORING"
  | "BACKUP";

export const ALL_TECH_CATEGORIES = [
  "NETWORK",
  "ENDPOINT",
  "CLOUD",
  "ACCESS",
  "MONITORING",
  "BACKUP",
] as const satisfies readonly TechCategory[];
