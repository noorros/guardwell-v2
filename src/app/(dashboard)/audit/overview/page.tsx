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
import { LayoutDashboard, AlertTriangle, Clock } from "lucide-react";
import {
  ScoreSparkline,
  computeDailyCompliantCounts,
  type StatusFlipEvent,
} from "@/components/gw/ScoreSparkline";
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
import { computeOverallScore } from "@/lib/compliance/overallScore";
import { formatEventForActivityLog } from "@/lib/audit/format-event";
import { formatPracticeDate } from "@/lib/audit/format";
import { ActivityTimestamp } from "../activity/ActivityTimestamp";

export const metadata = { title: "Overview · Audit" };
export const dynamic = "force-dynamic";

const OCR_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const SRA_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 8;
// Look-ahead window for the "Upcoming deadlines" widget. 30 calendar
// days is the standard professional warning horizon for credential and
// training expirations — enough lead time to schedule the renewal action
// without flooding the page with months of distant items.
const UPCOMING_WINDOW_DAYS = 30;
const UPCOMING_WINDOW_MS = UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 6;
// 30-day sparkline window for the score-trend mini graph.
const SPARKLINE_DAYS = 30;
const SPARKLINE_WINDOW_MS = SPARKLINE_DAYS * 24 * 60 * 60 * 1000;

export default async function AuditOverviewPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const jurisdictions = getPracticeJurisdictions(pu.practice);
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const upcomingHorizon = new Date(Date.now() + UPCOMING_WINDOW_MS);
  const [
    practiceFrameworks,
    applicableRequirements,
    allComplianceItems,
    recentEvents,
    unresolvedMajorBreach,
    unresolvedBreachCount,
    openIncidentCount,
    latestSra,
    expiringCredentials,
    expiringBaas,
    expiringTrainings,
    breachesAwaitingHhs,
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
    // Credentials expiring in the next UPCOMING_WINDOW_DAYS (or already
    // expired). retiredAt: null filters out credentials the user already
    // dismissed.
    db.credential.findMany({
      where: {
        practiceId: pu.practiceId,
        retiredAt: null,
        expiryDate: { not: null, lte: upcomingHorizon },
      },
      orderBy: { expiryDate: "asc" },
      take: UPCOMING_LIMIT,
      select: { id: true, title: true, expiryDate: true },
    }),
    // BAAs expiring in window. processesPhi=true mirrors the BAA derivation
    // rule's scope.
    db.vendor.findMany({
      where: {
        practiceId: pu.practiceId,
        retiredAt: null,
        processesPhi: true,
        baaExpiresAt: { not: null, lte: upcomingHorizon },
      },
      orderBy: { baaExpiresAt: "asc" },
      take: UPCOMING_LIMIT,
      select: { id: true, name: true, baaExpiresAt: true },
    }),
    // Training completions expiring in window — distinct courses (a
    // course-level row not user-level row to avoid noise from multi-staff
    // practices). Aggregated server-side to one row per (courseCode).
    db.trainingCompletion.findMany({
      where: {
        practiceId: pu.practiceId,
        passed: true,
        expiresAt: { lte: upcomingHorizon },
      },
      orderBy: { expiresAt: "asc" },
      take: UPCOMING_LIMIT,
      select: {
        id: true,
        expiresAt: true,
        course: { select: { code: true, title: true } },
      },
    }),
    // Unresolved breaches whose 60-day HHS deadline falls in the window.
    db.incident.findMany({
      where: {
        practiceId: pu.practiceId,
        isBreach: true,
        ocrNotifiedAt: null,
      },
      orderBy: { discoveredAt: "asc" },
      take: UPCOMING_LIMIT,
      select: { id: true, title: true, discoveredAt: true },
    }),
  ]);

  const applicableIdSet = new Set(applicableRequirements.map((r) => r.id));
  // Aggregate totals filtered by the practice's jurisdictions so the
  // denominator matches what /modules/[code] shows. The actual score
  // computation is delegated to computeOverallScore() below — the
  // canonical helper shared with the AI Concierge's get_dashboard_snapshot.
  const totalApplicable = applicableRequirements.length;
  const compliantApplicable: number = allComplianceItems.filter(
    (ci) => ci.status === "COMPLIANT" && applicableIdSet.has(ci.requirementId),
  ).length;

  // 30-day score-trend events. Computed AFTER compliantApplicable since
  // the sparkline reverse-derives daily counts from the current count.
  // Filter to status flips that touched COMPLIANT on either side — those
  // are the only ones that affect the count.
  const sparklineSinceMs = Date.now() - SPARKLINE_WINDOW_MS;
  const recentFlipEvents = await db.eventLog.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "REQUIREMENT_STATUS_UPDATED",
      createdAt: { gte: new Date(sparklineSinceMs) },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, payload: true },
  });
  const flipEvents: StatusFlipEvent[] = recentFlipEvents.flatMap((e) => {
    const payload = e.payload as {
      previousStatus?: string | null;
      nextStatus?: string;
    } | null;
    if (!payload?.nextStatus) return [];
    return [
      {
        createdAt: e.createdAt,
        previousStatus: payload.previousStatus ?? null,
        nextStatus: payload.nextStatus,
      },
    ];
  });
  const sparklinePoints = computeDailyCompliantCounts(
    compliantApplicable,
    flipEvents,
    SPARKLINE_DAYS,
  );
  const trendDelta =
    sparklinePoints.length > 1
      ? sparklinePoints[sparklinePoints.length - 1]! - sparklinePoints[0]!
      : 0;
  const gapApplicable = allComplianceItems.filter(
    (ci) => ci.status === "GAP" && applicableIdSet.has(ci.requirementId),
  ).length;
  const { score: overallScore } = await computeOverallScore(pu.practiceId);
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

  // Build the unified upcoming-deadlines feed. Each entry is a row with a
  // label, a human-readable due date, a link to the relevant detail page,
  // and a color-token to visually emphasize already-overdue items.
  interface UpcomingItem {
    key: string;
    kind: "credential" | "baa" | "training" | "breach-hhs";
    label: string;
    dueDate: Date;
    href: Route;
  }
  const upcoming: UpcomingItem[] = [];
  for (const c of expiringCredentials) {
    if (c.expiryDate)
      upcoming.push({
        key: `cred-${c.id}`,
        kind: "credential",
        label: `Credential — ${c.title}`,
        dueDate: c.expiryDate,
        href: "/programs/credentials" as Route,
      });
  }
  for (const v of expiringBaas) {
    if (v.baaExpiresAt)
      upcoming.push({
        key: `baa-${v.id}`,
        kind: "baa",
        label: `BAA — ${v.name}`,
        dueDate: v.baaExpiresAt,
        href: "/programs/vendors" as Route,
      });
  }
  // Aggregate trainings by course code so a 12-staff practice doesn't see
  // the same expiring course 12 times.
  const trainingByCourse = new Map<
    string,
    { earliest: Date; title: string }
  >();
  for (const t of expiringTrainings) {
    const existing = trainingByCourse.get(t.course.code);
    if (!existing || t.expiresAt < existing.earliest) {
      trainingByCourse.set(t.course.code, {
        earliest: t.expiresAt,
        title: t.course.title,
      });
    }
  }
  for (const [code, info] of trainingByCourse) {
    upcoming.push({
      key: `training-${code}`,
      kind: "training",
      label: `Training — ${info.title}`,
      dueDate: info.earliest,
      href: "/programs/training" as Route,
    });
  }
  for (const b of breachesAwaitingHhs) {
    upcoming.push({
      key: `breach-${b.id}`,
      kind: "breach-hhs",
      label: `HHS notification — ${b.title}`,
      dueDate: new Date(b.discoveredAt.getTime() + OCR_WINDOW_MS),
      href: `/programs/incidents/${b.id}` as Route,
    });
  }
  upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const upcomingTrimmed = upcoming.slice(0, UPCOMING_LIMIT);

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
        <a
          href="/api/audit/compliance-report"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          Download PDF
        </a>
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
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-sm font-semibold">Overall score</h3>
              <p className="text-xs text-muted-foreground">
                {compliantApplicable} of {totalApplicable} applicable
                requirements met
              </p>
              <div className="flex items-center gap-2 pt-1">
                <ScoreSparkline
                  points={sparklinePoints}
                  width={110}
                  height={26}
                  color={
                    trendDelta < 0
                      ? "var(--gw-color-risk)"
                      : trendDelta === 0
                        ? "var(--gw-color-setup)"
                        : "var(--gw-color-compliant)"
                  }
                  ariaLabel={`30-day compliance trend: ${trendDelta > 0 ? `up ${trendDelta}` : trendDelta < 0 ? `down ${Math.abs(trendDelta)}` : "flat"}`}
                />
                <span
                  className="text-[11px] tabular-nums"
                  style={{
                    color:
                      trendDelta < 0
                        ? "var(--gw-color-risk)"
                        : trendDelta > 0
                          ? "var(--gw-color-compliant)"
                          : "var(--muted-foreground)",
                  }}
                >
                  {trendDelta > 0
                    ? `+${trendDelta}`
                    : trendDelta < 0
                      ? `${trendDelta}`
                      : "—"}
                  {" "}<span className="text-muted-foreground">in 30d</span>
                </span>
              </div>
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

      <section>
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Upcoming deadlines (next {UPCOMING_WINDOW_DAYS} days)
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {upcoming.length} item{upcoming.length === 1 ? "" : "s"}
              </span>
            </div>
            {upcomingTrimmed.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                Nothing due in the next {UPCOMING_WINDOW_DAYS} days. ✓
              </div>
            ) : (
              <ul className="divide-y">
                {upcomingTrimmed.map((item) => {
                  const daysOut = Math.ceil(
                    (item.dueDate.getTime() - now) /
                      (24 * 60 * 60 * 1000),
                  );
                  const isOverdue = daysOut < 0;
                  const tone = isOverdue
                    ? "var(--gw-color-risk)"
                    : daysOut <= 7
                      ? "var(--gw-color-needs)"
                      : "var(--gw-color-setup)";
                  const dateText = formatPracticeDate(
                    item.dueDate,
                    pu.practice.timezone,
                  );
                  const relText = isOverdue
                    ? `${Math.abs(daysOut)}d overdue`
                    : daysOut === 0
                      ? "due today"
                      : `in ${daysOut}d`;
                  return (
                    <li
                      key={item.key}
                      className="flex items-center justify-between p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={item.href}
                          className="truncate text-sm font-medium text-foreground hover:underline"
                        >
                          {item.label}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {dateText} · {relText}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{ color: tone, borderColor: tone }}
                      >
                        {item.kind === "breach-hhs"
                          ? "HHS"
                          : item.kind === "baa"
                            ? "BAA"
                            : item.kind === "credential"
                              ? "Cred"
                              : "Training"}
                      </Badge>
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
                  const fmt = formatEventForActivityLog(
                    {
                      type: evt.type,
                      payload: evt.payload,
                    },
                    pu.role,
                  );
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
