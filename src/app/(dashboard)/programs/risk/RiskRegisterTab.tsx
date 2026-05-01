// src/app/(dashboard)/programs/risk/RiskRegisterTab.tsx
//
// Phase 5 PR 5 — client component (filter state lives in the URL but the
// filter chips dispatch via useRouter().push). Renders a list of
// RiskItem rows with severity / source filters. Empty state covers both
// "no risks" and "filtered to nothing" cases.

"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  riskSeverityBadgeVariant,
  riskSeverityLabel,
} from "@/lib/risk/severity";
import type { RiskSource, RiskItemStatus } from "@/lib/risk/types";

export interface RiskRegisterRow {
  id: string;
  source: RiskSource;
  severity: string;
  title: string;
  category: string;
  status: RiskItemStatus;
  createdAtIso: string;
}

export interface RiskRegisterTabProps {
  risks: RiskRegisterRow[];
}

const SEVERITY_GROUPS: Record<string, ReadonlyArray<string> | null> = {
  all: null,
  high: ["HIGH", "CRITICAL"],
  medium: ["MEDIUM"],
  low: ["LOW", "INFO"],
};

const SOURCE_LABEL: Record<RiskSource, string> = {
  SRA: "SRA",
  TECHNICAL_ASSESSMENT: "Tech",
  MANUAL: "Manual",
  INCIDENT_FOLLOWUP: "Incident",
  REGULATORY_ALERT: "Alert",
};

const STATUS_LABEL: Record<RiskItemStatus, string> = {
  OPEN: "Open",
  MITIGATED: "Mitigated",
  ACCEPTED: "Accepted",
  TRANSFERRED: "Transferred",
};

export function RiskRegisterTab({ risks }: RiskRegisterTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const severityKey = sp.get("severity") ?? "all";
  const sourceKey = sp.get("source") ?? "all";
  const statusKey = sp.get("status") ?? "open";

  const filtered = risks.filter((r) => {
    const sevGroup = SEVERITY_GROUPS[severityKey] ?? null;
    if (sevGroup && !sevGroup.includes(r.severity)) return false;
    if (sourceKey !== "all" && r.source !== sourceKey) return false;
    if (statusKey === "open" && r.status !== "OPEN") return false;
    if (statusKey === "resolved" && r.status === "OPEN") return false;
    return true;
  });

  const updateFilter = (
    key: "severity" | "source" | "status",
    value: string,
    fallback: string,
  ) => {
    const params = new URLSearchParams(sp.toString());
    // Always carry the current tab so we stay on the register tab.
    if (!params.get("tab")) params.set("tab", "register");
    if (value === fallback) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.push((qs ? `${pathname}?${qs}` : pathname) as Route);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div
            role="toolbar"
            aria-label="Severity filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Severity
            </span>
            {(
              [
                { key: "all", label: "All" },
                { key: "high", label: "High + Critical" },
                { key: "medium", label: "Medium" },
                { key: "low", label: "Low + Info" },
              ] as const
            ).map((opt) => {
              const isActive = severityKey === opt.key;
              return (
                <Button
                  key={opt.key}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  aria-pressed={isActive}
                  onClick={() => updateFilter("severity", opt.key, "all")}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>

          <div
            role="toolbar"
            aria-label="Source filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Source
            </span>
            {(
              [
                { key: "all", label: "All" },
                { key: "SRA", label: "SRA" },
                { key: "TECHNICAL_ASSESSMENT", label: "Tech" },
                { key: "MANUAL", label: "Manual" },
              ] as const
            ).map((opt) => {
              const isActive = sourceKey === opt.key;
              return (
                <Button
                  key={opt.key}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  aria-pressed={isActive}
                  onClick={() => updateFilter("source", opt.key, "all")}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>

          <div
            role="toolbar"
            aria-label="Status filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            {(
              [
                { key: "open", label: "Open" },
                { key: "resolved", label: "Resolved" },
                { key: "all", label: "All" },
              ] as const
            ).map((opt) => {
              const isActive = statusKey === opt.key;
              return (
                <Button
                  key={opt.key}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  aria-pressed={isActive}
                  onClick={() => updateFilter("status", opt.key, "open")}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {risks.length === 0
                ? "No open risks. Complete an SRA or Tech Assessment to populate the register."
                : "No risks match these filters."}
            </div>
          ) : (
            <ul className="divide-y" data-testid="risk-list">
              {filtered.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={riskSeverityBadgeVariant(r.severity)}
                        className="text-[10px]"
                      >
                        {riskSeverityLabel(r.severity)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {SOURCE_LABEL[r.source]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {STATUS_LABEL[r.status]}
                      </Badge>
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {r.category.replaceAll("_", " ")}
                      </span>
                    </div>
                    <Link
                      href={`/programs/risk/items/${r.id}` as Route}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {r.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      Created{" "}
                      {new Date(r.createdAtIso).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/programs/risk/items/${r.id}` as Route}>
                      View
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
