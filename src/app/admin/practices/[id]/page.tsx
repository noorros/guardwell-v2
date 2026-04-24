// src/app/admin/practices/[id]/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PracticeOverrides } from "./PracticeOverrides";

export const dynamic = "force-dynamic";

const RECENT_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminPracticeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const practice = await db.practice.findUnique({
    where: { id },
    include: {
      practiceUsers: {
        include: { user: { select: { email: true } } },
        orderBy: { joinedAt: "asc" },
      },
      complianceProfile: {
        select: {
          specialtyCategory: true,
          providerCount: true,
        },
      },
      enabledFrameworks: {
        where: { enabled: true },
        select: {
          framework: { select: { code: true, shortName: true, name: true } },
          scoreCache: true,
          lastScoredAt: true,
        },
      },
      _count: {
        select: {
          events: true,
          incidents: true,
          practicePolicies: true,
          credentials: true,
          vendors: true,
        },
      },
    },
  });
  if (!practice) notFound();

  // eslint-disable-next-line react-hooks/purity -- Server component.
  const recentCutoff = new Date(Date.now() - RECENT_HORIZON_MS);
  const [recentEventsCount, lastEvent, openIncidentCount] = await Promise.all([
    db.eventLog.count({
      where: { practiceId: id, createdAt: { gte: recentCutoff } },
    }),
    db.eventLog.findFirst({
      where: { practiceId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, type: true },
    }),
    db.incident.count({
      where: {
        practiceId: id,
        status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
      },
    }),
  ]);

  // Customer health computed from existing fields.
  const daysSinceLastEvent = lastEvent
    ? Math.floor(
        // eslint-disable-next-line react-hooks/purity -- Server component.
        (Date.now() - lastEvent.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      )
    : null;
  const healthBucket =
    daysSinceLastEvent === null
      ? "new"
      : daysSinceLastEvent < 7
        ? "active"
        : daysSinceLastEvent < 30
          ? "lapsing"
          : "dormant";
  const healthTone: Record<string, string> = {
    new: "var(--gw-color-setup)",
    active: "var(--gw-color-compliant)",
    lapsing: "var(--gw-color-needs)",
    dormant: "var(--gw-color-risk)",
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <p className="text-[11px] text-muted-foreground">
          <Link
            href={"/admin/practices" as Route}
            className="hover:underline"
          >
            ← Back to practices
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{practice.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge
            variant="outline"
            className="text-[10px]"
            style={{
              color: healthTone[healthBucket],
              borderColor: healthTone[healthBucket],
            }}
          >
            Health: {healthBucket}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {practice.subscriptionStatus}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {practice.primaryState}
          </Badge>
          <span className="text-muted-foreground">
            Created {practice.createdAt.toISOString().slice(0, 10)}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Users" value={practice.practiceUsers.length} />
        <Stat label="Open incidents" value={openIncidentCount} />
        <Stat label="Events (30d)" value={recentEventsCount} />
        <Stat
          label="Days since last event"
          value={daysSinceLastEvent ?? "—"}
        />
      </section>

      <PracticeOverrides
        practiceId={practice.id}
        currentStatus={practice.subscriptionStatus}
        trialEndsAtIso={practice.trialEndsAt?.toISOString() ?? null}
      />

      <Card>
        <CardContent className="space-y-2 p-5">
          <h2 className="text-sm font-semibold">Compliance profile</h2>
          {practice.complianceProfile ? (
            <p className="text-xs text-muted-foreground">
              {practice.complianceProfile.specialtyCategory ?? "Unknown specialty"} ·{" "}
              {practice.complianceProfile.providerCount ?? "?"} providers
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Profile not yet filled out (onboarding incomplete).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Enabled frameworks
            </h2>
          </div>
          {practice.enabledFrameworks.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No frameworks enabled yet.
            </p>
          ) : (
            <ul className="divide-y">
              {practice.enabledFrameworks.map((fw) => (
                <li
                  key={fw.framework.code}
                  className="flex items-center justify-between p-3 text-xs"
                >
                  <span>
                    {fw.framework.shortName ?? fw.framework.name}
                  </span>
                  <span className="tabular-nums">
                    {Math.round(fw.scoreCache ?? 0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Users
            </h2>
          </div>
          <ul className="divide-y">
            {practice.practiceUsers.map((pu) => (
              <li
                key={pu.id}
                className="flex items-center justify-between p-3 text-xs"
              >
                <span>{pu.user.email}</span>
                <span className="text-muted-foreground">
                  {pu.role}{pu.removedAt ? " (removed)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
