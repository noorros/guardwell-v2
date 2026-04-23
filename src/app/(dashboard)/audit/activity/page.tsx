// src/app/(dashboard)/audit/activity/page.tsx
//
// Cross-framework activity log — every EventLog row for the practice,
// formatted via formatEventForActivityLog and paginated.
//
// Filters: type (single-select). More filters (actor, framework, date
// range) in a follow-up PR — keep this first cut simple.

import Link from "next/link";
import type { Route } from "next";
import { ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EVENT_TYPES, type EventType } from "@/lib/events/registry";
import { formatEventForActivityLog } from "@/lib/audit/format-event";
import { ActivityTimestamp } from "./ActivityTimestamp";

export const metadata = { title: "Activity log · Audit" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; page?: string }>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const sp = (await searchParams) ?? {};

  const selectedType = EVENT_TYPES.find((t) => t === sp.type) as
    | EventType
    | undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const whereClause = {
    practiceId: pu.practiceId,
    ...(selectedType ? { type: selectedType } : {}),
  };
  const [events, totalCount] = await Promise.all([
    db.eventLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: { actor: { select: { email: true } } },
    }),
    db.eventLog.count({ where: whereClause }),
  ]);

  const hasNext = skip + events.length < totalCount;
  const hasPrev = page > 1;

  const buildHref = (overrides: Partial<{ type: string; page: number }>) => {
    const q = new URLSearchParams();
    const type = overrides.type ?? selectedType ?? "";
    const nextPage = overrides.page ?? page;
    if (type) q.set("type", type);
    if (nextPage > 1) q.set("page", String(nextPage));
    const s = q.toString();
    return (s ? `/audit/activity?${s}` : "/audit/activity") as Route;
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Activity log" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ScrollText className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every compliance event for this practice, newest first. Includes
            policy adoptions, training completions, officer designations,
            incident lifecycle, SRA submissions, credential updates, and
            auto-derived requirement changes.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <form method="GET" action="/audit/activity" className="flex flex-1 flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-foreground">
              Event type
              <select
                name="type"
                defaultValue={selectedType ?? ""}
                className="ml-2 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">All</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
            {selectedType && (
              <Button asChild size="sm" variant="ghost">
                <Link href={"/audit/activity" as Route}>Clear</Link>
              </Button>
            )}
          </form>
          <span className="text-[11px] text-muted-foreground">
            {totalCount.toLocaleString("en-US")} event
            {totalCount === 1 ? "" : "s"}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {selectedType
                ? `No events of type ${selectedType} for this practice.`
                : "No activity yet. As you adopt policies, complete training, report incidents, and exercise other surfaces, they'll show up here."}
            </div>
          ) : (
            <ul className="divide-y">
              {events.map((evt) => {
                const fmt = formatEventForActivityLog({
                  type: evt.type,
                  payload: evt.payload,
                });
                const actor =
                  evt.actor?.email ??
                  (evt.actorUserId === null ? "System" : "—");
                return (
                  <li
                    key={evt.id}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {fmt.verb}
                        </Badge>
                        <p className="truncate text-sm font-medium text-foreground">
                          {fmt.summary}
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {actor}
                        {fmt.detail ? ` · ${fmt.detail}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <ActivityTimestamp iso={evt.createdAt.toISOString()} />
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {evt.type.replace(/_/g, " ").toLowerCase()}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between">
          <div>
            {hasPrev && (
              <Button asChild size="sm" variant="outline">
                <Link href={buildHref({ page: page - 1 })}>← Previous</Link>
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Page {page} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
          </p>
          <div>
            {hasNext && (
              <Button asChild size="sm" variant="outline">
                <Link href={buildHref({ page: page + 1 })}>Next →</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
