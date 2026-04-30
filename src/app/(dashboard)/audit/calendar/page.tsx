// src/app/(dashboard)/audit/calendar/page.tsx
//
// Compliance calendar — one place to scan every upcoming deadline
// across the practice. Aggregates 8 different deadline sources
// (training, BAAs, credentials, policy reviews, backup verification,
// phishing drills, document destruction, SRA refresh) into one
// chronological list, bucketed by time-to-due.

import Link from "next/link";
import type { Route } from "next";
import {
  CalendarDays,
  GraduationCap,
  Building2,
  IdCard,
  FileText,
  Database,
  Mail,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  loadUpcomingDeadlines,
  bucketDeadlines,
  type UpcomingDeadline,
  type DeadlineSeverity,
} from "@/lib/calendar/upcoming";
import { formatPracticeDate } from "@/lib/audit/format";

export const metadata = { title: "Compliance calendar · Audit" };
export const dynamic = "force-dynamic";

const KIND_ICONS: Record<UpcomingDeadline["kind"], typeof CalendarDays> = {
  TRAINING: GraduationCap,
  BAA: Building2,
  CREDENTIAL: IdCard,
  POLICY_REVIEW: FileText,
  BACKUP_VERIFICATION: Database,
  PHISHING_DRILL: Mail,
  DOCUMENT_DESTRUCTION: Trash2,
  SRA_REFRESH: ShieldAlert,
};

const KIND_LABELS: Record<UpcomingDeadline["kind"], string> = {
  TRAINING: "Training",
  BAA: "BAA",
  CREDENTIAL: "Credential",
  POLICY_REVIEW: "Policy review",
  BACKUP_VERIFICATION: "Backup test",
  PHISHING_DRILL: "Phishing drill",
  DOCUMENT_DESTRUCTION: "Document destruction",
  SRA_REFRESH: "SRA refresh",
};

const SEVERITY_COLORS: Record<DeadlineSeverity, string> = {
  OVERDUE: "var(--gw-color-risk)",
  URGENT: "var(--gw-color-needs)",
  UPCOMING: "var(--gw-color-setup)",
};

function daysFromNow(date: Date): { absDays: number; relative: string } {
  const diffMs = date.getTime() - Date.now();
  const absDays = Math.round(Math.abs(diffMs) / (24 * 60 * 60 * 1000));
  if (diffMs < 0) {
    return {
      absDays,
      relative: `${absDays} day${absDays === 1 ? "" : "s"} overdue`,
    };
  }
  if (absDays === 0) return { absDays, relative: "due today" };
  return {
    absDays,
    relative: `due in ${absDays} day${absDays === 1 ? "" : "s"}`,
  };
}

export default async function CompliancecalendarPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const tz = pu.practice.timezone ?? "UTC";

  const deadlines = await loadUpcomingDeadlines(db, pu.practiceId, {
    horizonDays: 365, // surface up to a year out
  });
  const buckets = bucketDeadlines(deadlines);

  // Counts by severity for the header summary chips.
  const overdueCount = deadlines.filter((d) => d.severity === "OVERDUE").length;
  const urgentCount = deadlines.filter((d) => d.severity === "URGENT").length;
  const upcomingCount = deadlines.filter(
    (d) => d.severity === "UPCOMING",
  ).length;

  // Counts by kind for the right-rail summary.
  const byKind = new Map<UpcomingDeadline["kind"], number>();
  for (const d of deadlines) {
    byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "Audit & Insights" }, { label: "Calendar" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Compliance calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Every upcoming deadline across the practice in one chronological
            list. Pulls from training expirations, BAA renewals, credential
            expirations, policy reviews, backup verification cadence, phishing
            drills, document destruction cadence, and SRA refresh.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Overdue
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{
                color:
                  overdueCount > 0
                    ? "var(--gw-color-risk)"
                    : "var(--gw-color-compliant)",
              }}
            >
              {overdueCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Due in next 30 days
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{
                color:
                  urgentCount > 0
                    ? "var(--gw-color-needs)"
                    : "var(--gw-color-compliant)",
              }}
            >
              {urgentCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Upcoming (next year)
            </p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {upcomingCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {deadlines.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-semibold text-foreground">
              No upcoming deadlines.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing on the horizon — either you're all caught up or the
              practice has not yet adopted policies, completed training, or
              tracked vendors. Start at{" "}
              <Link
                href={"/programs/track" as Route}
                className="text-foreground underline hover:no-underline"
              >
                /programs/track
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="space-y-4">
            {buckets.map((b) => {
              if (b.items.length === 0) return null;
              return (
                <Card key={b.key}>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between border-b px-4 py-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {b.label}
                      </h2>
                      <span className="text-[10px] text-muted-foreground">
                        {b.items.length} item{b.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="divide-y">
                      {b.items.map((d) => {
                        const Icon = KIND_ICONS[d.kind];
                        const dueIso = formatPracticeDate(d.dueAt, tz);
                        const { relative } = daysFromNow(d.dueAt);
                        return (
                          <li
                            key={`${d.kind}-${d.sourceId}`}
                            className="flex items-start gap-3 p-3"
                          >
                            <Icon
                              className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-foreground">
                                  {d.label}
                                </p>
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {KIND_LABELS[d.kind]}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {dueIso} ·{" "}
                                <span
                                  style={{
                                    color: SEVERITY_COLORS[d.severity],
                                  }}
                                >
                                  {relative}
                                </span>
                                {d.detail ? ` · ${d.detail}` : ""}
                              </p>
                            </div>
                            <Link
                              href={d.detailHref as Route}
                              className="self-center rounded-md border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent"
                            >
                              Open
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {/* Right-rail: counts by kind */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                By category
              </h3>
              <ul className="space-y-1">
                {Array.from(byKind.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, count]) => {
                    const Icon = KIND_ICONS[kind];
                    return (
                      <li
                        key={kind}
                        className="flex items-center justify-between gap-2 rounded-md border bg-background/40 px-2 py-1.5 text-xs"
                      >
                        <span className="flex items-center gap-1.5 truncate text-foreground">
                          <Icon
                            className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {KIND_LABELS[kind]}
                        </span>
                        <span className="font-medium tabular-nums">
                          {count}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
