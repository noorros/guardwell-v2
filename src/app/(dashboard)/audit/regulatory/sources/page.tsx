// src/app/(dashboard)/audit/regulatory/sources/page.tsx
//
// Phase 8 PR 6 — Admin source toggle page. RegulatorySource is a global
// table; toggling it affects every tenant. OWNER-only at the page level
// + OWNER gate on the server action (defense in depth).

import { notFound } from "next/navigation";
import type { Route } from "next";
import { Settings } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPracticeDate } from "@/lib/audit/format";
import { SourceToggle } from "./SourceToggle";

export const metadata = { title: "Regulatory sources · Audit" };
export const dynamic = "force-dynamic";

export default async function RegulatorySourcesPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  // Page-level OWNER gate. Server action also enforces OWNER (defense
  // in depth), but rendering the toggle UI to a non-OWNER would be
  // misleading even though the click would be rejected.
  if (pu.role !== "OWNER") notFound();
  const tz = pu.practice.timezone ?? "UTC";

  const sources = await db.regulatorySource.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "Audit & Insights" },
          {
            label: "Regulatory alerts",
            href: "/audit/regulatory" as Route,
          },
          { label: "Sources" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Settings className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Regulatory sources
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Feeds the regulatory intelligence engine ingests nightly. Disabling
            a source stops it from contributing to future alerts. This affects
            every tenant on the platform.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {sources.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No regulatory sources configured. Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                npm run db:seed:regulatory
              </code>{" "}
              to seed the default catalog.
            </div>
          ) : (
            <ul className="divide-y">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {s.name}
                      </p>
                      <Badge
                        variant={s.isActive ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {s.isActive ? "Active" : "Disabled"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {s.feedType}
                      </Badge>
                      {s.defaultFrameworks.map((fw) => (
                        <Badge
                          key={fw}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {fw}
                        </Badge>
                      ))}
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[11px] text-muted-foreground hover:underline"
                    >
                      {s.url}
                    </a>
                    <p className="text-[11px] text-muted-foreground">
                      {s.lastIngestedAt
                        ? `Last ingested ${formatPracticeDate(s.lastIngestedAt, tz)}`
                        : "Never ingested"}
                    </p>
                  </div>
                  <SourceToggle
                    sourceId={s.id}
                    sourceName={s.name}
                    isActive={s.isActive}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
