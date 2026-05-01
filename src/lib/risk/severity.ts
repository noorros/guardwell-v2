// src/lib/risk/severity.ts
//
// Phase 5 — RiskItem severity badge mapping. Mirrors
// regulatorySeverityBadgeVariant from src/lib/regulatory/types.ts.
// CRITICAL + HIGH render destructive (red), MEDIUM default (primary),
// LOW + INFO secondary (muted). Unknown inputs fall back to secondary
// so a future enum addition doesn't crash the UI.

export function riskSeverityBadgeVariant(
  severity: string,
): "default" | "destructive" | "secondary" {
  if (severity === "CRITICAL" || severity === "HIGH") return "destructive";
  if (severity === "MEDIUM") return "default";
  return "secondary";
}

export function riskSeverityLabel(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}
