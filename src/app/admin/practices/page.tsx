// src/app/admin/practices/page.tsx
//
// Practices list — search + filter by subscription status + per-row
// health snapshot. Click into per-practice detail for overrides.

import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const SUB_TONE: Record<string, string> = {
  ACTIVE: "var(--gw-color-compliant)",
  TRIALING: "var(--gw-color-setup)",
  PAST_DUE: "var(--gw-color-needs)",
  CANCELED: "var(--gw-color-risk)",
};

const STATUS_FILTERS = ["ALL", "ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"];

export default async function AdminPracticesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const query = sp.q?.trim() ?? "";
  const status = sp.status && STATUS_FILTERS.includes(sp.status) ? sp.status : "ALL";

  const practices = await db.practice.findMany({
    where: {
      deletedAt: null,
      ...(status !== "ALL" ? { subscriptionStatus: status } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              {
                practiceUsers: {
                  some: { user: { email: { contains: query, mode: "insensitive" } } },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { practiceUsers: true, events: true } },
      practiceUsers: {
        where: { role: "OWNER" },
        select: { user: { select: { email: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Practices</h1>
          <p className="text-sm text-muted-foreground">
            {practices.length} of {practices.length === 100 ? "100+" : practices.length} matching
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          <form method="GET" action="/admin/practices" className="flex flex-wrap items-end gap-2">
            <label className="flex-1 space-y-1 text-xs font-medium text-foreground">
              Search (name or owner email)
              <input
                name="q"
                type="text"
                defaultValue={query}
                placeholder="e.g. Saguaro Family"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground">
              Subscription
              <select
                name="status"
                defaultValue={status}
                className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {(query || status !== "ALL") && (
              <Button asChild size="sm" variant="ghost">
                <Link href={"/admin/practices" as Route}>Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {practices.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No practices match these filters.
            </div>
          ) : (
            <ul className="divide-y">
              {practices.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/practices/${p.id}` as Route}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {p.name}
                      </Link>
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{
                          color: SUB_TONE[p.subscriptionStatus] ?? "var(--gw-color-setup)",
                          borderColor: SUB_TONE[p.subscriptionStatus] ?? "var(--gw-color-setup)",
                        }}
                      >
                        {p.subscriptionStatus}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {p.primaryState}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {p.practiceUsers[0]?.user.email ?? "(no owner)"} ·{" "}
                      {p._count.practiceUsers} user
                      {p._count.practiceUsers === 1 ? "" : "s"} ·{" "}
                      {p._count.events} events · created{" "}
                      {p.createdAt.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/practices/${p.id}` as Route}>View</Link>
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
