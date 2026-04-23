// src/app/(dashboard)/audit/overview/page.tsx
//
// Cross-framework readiness snapshot — what an auditor, compliance
// officer, or owner wants on one page before a survey visit or
// attestation. Sums across frameworks using the same jurisdiction
// filter the individual module pages use so the numbers always match.
//
// Reads only — no mutations. `dynamic = "force-dynamic"` so the numbers
// reflect the latest derivation state on every load.

import Link from "next/link";
import type { Route } from "next";
import { LayoutDashboard, AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { Badge } from "@/components/ui/badge";
import {
  MajorBreachBanner,
  MAJOR_BREACH_THRESHOLD,
} from "@/components/gw/MajorBreachBanner";
import {
  getPracticeJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";
import { formatEventForActivityLog } from "@/lib/audit/format-event";
import { ActivityTimestamp } from "../activity/ActivityTimestamp";

export const metadata = { title: "Overview · Audit" };
export const dynamic = "force-dynamic";

const OCR_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const SRA_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 8;

export default async function AuditOverviewPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const jurisdictions = getPracticeJurisdictions(pu.practice);
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const [
    practiceFrameworks,
    applicableRequirements,
    allComplianceItems,
    recentEvents,
    unresolvedMajorBreach,
    unresolvedBreachCount,
    openIncidentCount,
    latestSra,
  ] = await Promise.all([
    db.practiceFramework.findMany({
      where: {
        practiceId: pu.practiceId,
        enabled: true,
        disabledAt: null,
      },
      include: { framework: true },
      orderBy: { framework: { sortOrder: "asc" } },
    }),
    db.regulatoryRequirement.findMany({
      where: { ...jurisdictionClause },
      select: {
        id: true,
        frameworkId: true,
        severity: true,
      },
    }),
    db.complianceItem.findMany({
      where: { practiceId: pu.practiceId },
      select: { requirementId: true, status: true },
    }),
    db.eventLog.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { createdAt: "desc" },
      take: RECENT_ACTIVITY_LIMIT,
      include: { actor: { select: { email: true } } },
    }),
    db.incident.findFirst({
      where: {
        practiceId: pu.practiceId,
        isBreach: true,
        resolvedAt: null,
        affectedCount: { gte: MAJOR_BREACH_THRESHOLD },
      },
      orderBy: { discoveredAt: "asc" },
    }),
    db.incident.count({
      where: {
        practiceId: pu.practiceId,
        isBreach: true,
        resolvedAt: null,
      },
    }),
    db.incident.count({
      where: {
        practiceId: pu.practiceId,
        status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
      },
    }),
    db.practiceSraAssessment.findFirst({
      where: {
        practiceId: pu.practiceId,
        isDraft: false,
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, overallScore: true },
    }),
  ]);

  const applicableIdSet = new Set(applicableRequirements.map((r) => r.id));
  // Aggregate totals filtered by the practice's jurisdictions so the
  // denominator matches what /modules/[code] shows.
  const totalApplicable = applicableRequirements.length;
  const compliantApplicable = allComplianceItems.filter(
    (ci) => ci.status === "COMPLIANT" && applicableIdSet.has(ci.requirementId),
  ).length;
  const gapApplicable = allComplianceItems.filter(
    (ci) => ci.status === "GAP" && applicableIdSet.has(ci.requirementId),
  ).length;
  const overallScore =
    totalApplicable === 0
      ? 0
      : Math.round((compliantApplicable / totalApplicable) * 100);
  const isAssessed = allComplianceItems.length > 0;

  // Critical gaps — highest-severity requirements currently at GAP.
  const reqById = new Map(applicableRequirements.map((r) => [r.id, r]));
  const criticalGapCount = allComplianceItems.filter((ci) => {
    if (ci.status !== "GAP") return false;
    const req = reqById.get(ci.requirementId);
    return req?.severity === "CRITICAL";
  }).length;

  // SRA freshness
  const now = Date.now();
  const sraFresh =
    latestSra?.completedAt != null &&
    now - latestSra.completedAt.getTime() < SRA_WINDOW_MS;
  const sraDaysOld = latestSra?.completedAt
    ? Math.floor((now - latestSra.completedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const reportingDeadline = unresolvedMajorBreach
    ? new Date(unresolvedMajorBreach.discoveredAt.getTime() + OCR_WINDOW_MS)
    : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Overview" }]}
      />

      {unresolvedMajorBreach && reportingDeadline && (
        <Link
          href={`/programs/incidents/${unresolvedMajorBreach.id}` as Route}
          className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <MajorBreachBanner
            affectedCount={unresolvedMajorBreach.affectedCount ?? 0}
            reportingDeadline={reportingDeadline}
          />
        </Link>
      )}

      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Cross-framework readiness at a glance. Every total on this page
            respects the practice&apos;s jurisdictions — federal + state overlays
            for {jurisdictions.join(", ")}.
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <ScoreRing
              score={overallScore}
              size={72}
              strokeWidth={8}
              assessed={isAssessed}
              label="Overall"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <h3 className="text-sm font-semibold">Overall score</h3>
              <p className="text-xs text-muted-foreground">
                {compliantApplicable} of {totalApplicable} applicable
                requirements met
              </p>
              <p className="text-[11px] text-muted-foreground">
                Across {practiceFrameworks.length} enabled framework
                {practiceFrameworks.length === 1 ? "" : "s"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Critical gaps
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {criticalGapCount}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              High-severity requirements currently at GAP
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Incidents
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {openIncidentCount}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {unresolvedBreachCount} unresolved breach
              {unresolvedBreachCount === 1 ? "" : "es"} · open + under
              investigation
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Framework breakdown
              </h2>
            </div>
            {practiceFrameworks.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No frameworks enabled for this practice.
              </div>
            ) : (
              <ul className="divide-y">
                {practiceFrameworks.map((pf) => {
                  const frameworkReqs = applicableRequirements.filter(
                    (r) => r.frameworkId === pf.frameworkId,
                  );
                  const frameworkItems = allComplianceItems.filter((ci) =>
                    frameworkReqs.some((r) => r.id === ci.requirementId),
                  );
                  const frameworkAssessed = frameworkItems.length > 0;
                  const compliant = frameworkItems.filter(
                    (ci) => ci.status === "COMPLIANT",
                  ).length;
                  const total = frameworkReqs.length;
                  return (
                    <li
                      key={pf.frameworkId}
                      className="flex items-center justify-between p-4"
                    >
                      <div className="flex-1">
                        <Link
                          href={
                            `/modules/${pf.framework.code.toLowerCase()}` as Route
                          }
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {pf.framework.shortName ?? pf.framework.name}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {frameworkAssessed
                            ? `${compliant} of ${total} compliant`
                            : "Not assessed yet"}
                        </p>
                      </div>
                      <ScoreRing
                        score={Math.round(pf.scoreCache ?? 0)}
                        size={48}
                        strokeWidth={6}
                        assessed={frameworkAssessed}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Key obligations
              </h2>
            </div>
            <ul className="divide-y text-sm">
              <li className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">Security Risk Assessment (HIPAA)</p>
                  <p className="text-[11px] text-muted-foreground">
                    {latestSra?.completedAt
                      ? `${latestSra.overallScore}% addressed · ${
                          sraDaysOld ?? 0
                        } day${sraDaysOld === 1 ? "" : "s"} old`
                      : "No SRA on file"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color: sraFresh
                      ? "var(--gw-color-compliant)"
                      : "var(--gw-color-risk)",
                    borderColor: sraFresh
                      ? "var(--gw-color-compliant)"
                      : "var(--gw-color-risk)",
                  }}
                >
                  {sraFresh ? "Fresh" : latestSra ? "Stale" : "Missing"}
                </Badge>
              </li>
              <li className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">Unresolved breaches</p>
                  <p className="text-[11px] text-muted-foreground">
                    Blocks HIPAA_BREACH_RESPONSE while open
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color:
                      unresolvedBreachCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-risk)",
                    borderColor:
                      unresolvedBreachCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-risk)",
                  }}
                >
                  {unresolvedBreachCount}
                </Badge>
              </li>
              <li className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">Critical-severity gaps</p>
                  <p className="text-[11px] text-muted-foreground">
                    Highest-priority requirements still at GAP
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color:
                      criticalGapCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-risk)",
                    borderColor:
                      criticalGapCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-risk)",
                  }}
                >
                  {criticalGapCount}
                </Badge>
              </li>
              <li className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">Active incidents</p>
                  <p className="text-[11px] text-muted-foreground">
                    Open + under investigation
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color:
                      openIncidentCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-needs)",
                    borderColor:
                      openIncidentCount === 0
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-needs)",
                  }}
                >
                  {openIncidentCount}
                </Badge>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent activity
              </h2>
              <Link
                href={"/audit/activity" as Route}
                className="text-[11px] text-muted-foreground hover:underline"
              >
                View all
              </Link>
            </div>
            {recentEvents.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                <AlertTriangle className="mb-2 h-4 w-4" aria-hidden="true" />
                No activity yet.
              </div>
            ) : (
              <ul className="divide-y">
                {recentEvents.map((evt) => {
                  const fmt = formatEventForActivityLog({
                    type: evt.type,
                    payload: evt.payload,
                  });
                  return (
                    <li key={evt.id} className="space-y-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {fmt.verb}
                          </Badge>
                          <p className="truncate text-sm font-medium text-foreground">
                            {fmt.summary}
                          </p>
                        </div>
                        <ActivityTimestamp
                          iso={evt.createdAt.toISOString()}
                        />
                      </div>
                      {fmt.detail && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {fmt.detail}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
