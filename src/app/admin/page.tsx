// src/app/admin/page.tsx
//
// Admin dashboard — top-level health snapshot of the platform.
// Customer-facing growth metrics + per-practice health.

import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const RECENT_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export default async function AdminDashboardPage() {
  // Server component — purity rule's rerender concern doesn't apply.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const recentCutoff = new Date(now - RECENT_HORIZON_MS);

  const [
    totalPractices,
    activePractices,
    pastDue,
    canceled,
    trialing,
    practicesCreatedRecent,
    eventsRecent,
    totalUsers,
  ] = await Promise.all([
    db.practice.count({ where: { deletedAt: null } }),
    db.practice.count({
      where: { deletedAt: null, subscriptionStatus: "ACTIVE" },
    }),
    db.practice.count({
      where: { deletedAt: null, subscriptionStatus: "PAST_DUE" },
    }),
    db.practice.count({
      where: { deletedAt: null, subscriptionStatus: "CANCELED" },
    }),
    db.practice.count({
      where: { deletedAt: null, subscriptionStatus: "TRIALING" },
    }),
    db.practice.count({
      where: { deletedAt: null, createdAt: { gte: recentCutoff } },
    }),
    db.eventLog.count({
      where: { createdAt: { gte: recentCutoff } },
    }),
    db.user.count({ where: { deletedAt: null } }),
  ]);

  const stats: Array<{ label: string; value: number; tone?: string }> = [
    { label: "Total practices", value: totalPractices },
    { label: "Active subs", value: activePractices, tone: "var(--gw-color-compliant)" },
    { label: "Trialing", value: trialing, tone: "var(--gw-color-setup)" },
    { label: "Past due", value: pastDue, tone: "var(--gw-color-needs)" },
    { label: "Canceled", value: canceled, tone: "var(--gw-color-risk)" },
    { label: "Total users", value: totalUsers },
    { label: "New practices (30d)", value: practicesCreatedRecent },
    { label: "Events (30d)", value: eventsRecent },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Internal-only platform snapshot. Use Practices for per-customer
          health + manual operations.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p
                className="text-2xl font-semibold tabular-nums"
                style={s.tone ? { color: s.tone } : undefined}
              >
                {s.value.toLocaleString("en-US")}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h2 className="text-sm font-semibold">Quick links</h2>
          <ul className="space-y-1 text-xs">
            <li>
              <Link
                href={"/admin/practices" as Route}
                className="text-foreground hover:underline"
              >
                Practices list
              </Link>{" "}
              <span className="text-muted-foreground">— search, view per-practice health, override subscription</span>
            </li>
          </ul>
          <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="mr-2 text-[9px]">
              Coming
            </Badge>
            Lead intake, waitlist promotion, regulatory-update authoring will
            land here as customer demand emerges. Per
            v1-ideas-survey.md §1.9.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
