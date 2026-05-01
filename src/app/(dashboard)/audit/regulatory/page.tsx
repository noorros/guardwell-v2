// src/app/(dashboard)/audit/regulatory/page.tsx
//
// Phase 8 PR 6 — Regulatory alerts list. Server-rendered. Filters live
// in the URL (severity / framework / status) so they're shareable and
// bookmarkable. Active alerts are the default view; a status toggle
// surfaces dismissed history when needed.

import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ALL_FRAMEWORK_CODES,
  type FrameworkCode,
  type Severity,
} from "@/lib/regulatory/types";
import { formatPracticeDate } from "@/lib/audit/format";

export const metadata = { title: "Regulatory alerts · Audit" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SEVERITIES: ReadonlyArray<Severity> = ["INFO", "ADVISORY", "URGENT"];
const KNOWN_SEVERITIES = new Set<string>(SEVERITIES);
const KNOWN_FRAMEWORKS = new Set<string>(ALL_FRAMEWORK_CODES);

type StatusFilter = "active" | "dismissed" | "all";
const KNOWN_STATUSES = new Set<StatusFilter>(["active", "dismissed", "all"]);

function severityVariant(severity: string): "default" | "destructive" | "secondary" {
  // URGENT = destructive (red), ADVISORY = default (primary), INFO = secondary.
  // Mirrors the visual weight implied by REGULATORY_TO_NOTIFICATION_SEVERITY
  // (URGENT → CRITICAL, ADVISORY → WARNING, INFO → INFO).
  if (severity === "URGENT") return "destructive";
  if (severity === "ADVISORY") return "default";
  return "secondary";
}

function severityLabel(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

interface SearchParams {
  severity?: string;
  framework?: string;
  status?: string;
  page?: string;
}

export default async function RegulatoryAlertsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const tz = pu.practice.timezone ?? "UTC";
  const sp = (await searchParams) ?? {};

  const selectedSeverity =
    sp.severity && KNOWN_SEVERITIES.has(sp.severity)
      ? (sp.severity as Severity)
      : null;
  const selectedFramework =
    sp.framework && KNOWN_FRAMEWORKS.has(sp.framework)
      ? (sp.framework as FrameworkCode)
      : null;
  const selectedStatus: StatusFilter = KNOWN_STATUSES.has(
    sp.status as StatusFilter,
  )
    ? (sp.status as StatusFilter)
    : "active";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const whereClause: Prisma.RegulatoryAlertWhereInput = {
    practiceId: pu.practiceId,
  };
  if (selectedSeverity) whereClause.severity = selectedSeverity;
  if (selectedFramework) {
    whereClause.matchedFrameworks = { has: selectedFramework };
  }
  if (selectedStatus === "active") {
    whereClause.dismissedAt = null;
  } else if (selectedStatus === "dismissed") {
    whereClause.dismissedAt = { not: null };
  }

  const [alerts, totalCount] = await Promise.all([
    db.regulatoryAlert.findMany({
      where: whereClause,
      include: {
        article: {
          select: {
            title: true,
            publishDate: true,
            source: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    db.regulatoryAlert.count({ where: whereClause }),
  ]);

  const buildHref = (
    overrides: Partial<{
      severity: string | null;
      framework: string | null;
      status: StatusFilter | null;
      page: number;
    }>,
  ): Route => {
    const q = new URLSearchParams();
    const sev =
      overrides.severity !== undefined ? overrides.severity : selectedSeverity;
    const fw =
      overrides.framework !== undefined ? overrides.framework : selectedFramework;
    const status =
      overrides.status !== undefined ? overrides.status : selectedStatus;
    const nextPage = overrides.page ?? page;
    if (sev) q.set("severity", sev);
    if (fw) q.set("framework", fw);
    if (status && status !== "active") q.set("status", status);
    if (nextPage > 1) q.set("page", String(nextPage));
    const s = q.toString();
    return (s ? `/audit/regulatory?${s}` : "/audit/regulatory") as Route;
  };

  const hasNext = skip + alerts.length < totalCount;
  const hasPrev = page > 1;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Regulatory alerts" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Bell className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Regulatory alerts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tailored summaries of new regulatory news that touches your enabled
            frameworks. Acknowledge to mark you&apos;ve seen it, or add to your
            corrective-action plan to drive follow-up.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          {/* Severity chips */}
          <div
            role="toolbar"
            aria-label="Severity filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Severity
            </span>
            <Button
              asChild
              size="sm"
              variant={!selectedSeverity ? "default" : "outline"}
              className="h-7 text-[11px]"
            >
              <Link href={buildHref({ severity: null, page: 1 })}>All</Link>
            </Button>
            {SEVERITIES.map((sev) => {
              const isActive = selectedSeverity === sev;
              return (
                <Button
                  key={sev}
                  asChild
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  aria-pressed={isActive}
                >
                  <Link
                    href={buildHref({
                      severity: isActive ? null : sev,
                      page: 1,
                    })}
                  >
                    {severityLabel(sev)}
                  </Link>
                </Button>
              );
            })}
          </div>

          {/* Framework chips */}
          <div
            role="toolbar"
            aria-label="Framework filter"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Framework
            </span>
            <Button
              asChild
              size="sm"
              variant={!selectedFramework ? "default" : "outline"}
              className="h-7 text-[11px]"
            >
              <Link href={buildHref({ framework: null, page: 1 })}>All</Link>
            </Button>
            {ALL_FRAMEWORK_CODES.map((fw) => {
              const isActive = selectedFramework === fw;
              return (
                <Button
                  key={fw}
                  asChild
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  aria-pressed={isActive}
                >
                  <Link
                    href={buildHref({
                      framework: isActive ? null : fw,
                      page: 1,
                    })}
                  >
                    {fw}
                  </Link>
                </Button>
              );
            })}
          </div>

          {/* Status toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div
              role="toolbar"
              aria-label="Status filter"
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </span>
              {(["active", "dismissed", "all"] as const).map((s) => {
                const isActive = selectedStatus === s;
                return (
                  <Button
                    key={s}
                    asChild
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    className="h-7 text-[11px]"
                    aria-pressed={isActive}
                  >
                    <Link href={buildHref({ status: s, page: 1 })}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Link>
                  </Button>
                );
              })}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {totalCount.toLocaleString("en-US")} alert
              {totalCount === 1 ? "" : "s"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {selectedSeverity || selectedFramework || selectedStatus !== "active"
                ? "No alerts match these filters."
                : "No regulatory alerts yet. As new rules and guidance are published, tailored summaries will appear here."}
            </div>
          ) : (
            <ul className="divide-y">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={severityVariant(a.severity)}
                        className="text-[10px]"
                      >
                        {severityLabel(a.severity)}
                      </Badge>
                      {a.matchedFrameworks.map((fw) => (
                        <Badge
                          key={fw}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {fw}
                        </Badge>
                      ))}
                      {a.dismissedAt && (
                        <Badge variant="secondary" className="text-[10px]">
                          Dismissed
                        </Badge>
                      )}
                      {!a.dismissedAt && a.acknowledgedAt && (
                        <Badge variant="outline" className="text-[10px]">
                          Acknowledged
                        </Badge>
                      )}
                    </div>
                    <Link
                      href={`/audit/regulatory/${a.id}` as Route}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {a.article.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {a.article.source.name}
                      {a.article.publishDate
                        ? ` · ${formatPracticeDate(a.article.publishDate, tz)}`
                        : ""}
                      {" · Created "}
                      {formatPracticeDate(a.createdAt, tz)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/audit/regulatory/${a.id}` as Route}>
                      View
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between">
          <div>
            {hasPrev && (
              <Button asChild size="sm" variant="outline">
                <Link href={buildHref({ page: page - 1 })}>Previous</Link>
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Page {page} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
          </p>
          <div>
            {hasNext && (
              <Button asChild size="sm" variant="outline">
                <Link href={buildHref({ page: page + 1 })}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
