// src/app/(dashboard)/audit/regulatory/[alertId]/page.tsx
//
// Phase 8 PR 6 — Regulatory alert detail. Server-rendered. Loads ONE
// alert with its article + actions; IDOR-checks via practiceId.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { Bell, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPracticeDate } from "@/lib/audit/format";
import {
  regulatorySeverityBadgeVariant,
  regulatorySeverityLabel,
} from "@/lib/regulatory/types";
import { AlertActions } from "../AlertActions";

export const metadata = { title: "Regulatory alert · Audit" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ alertId: string }>;
}

export default async function RegulatoryAlertDetailPage({ params }: PageProps) {
  const { alertId } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;
  const tz = pu.practice.timezone ?? "UTC";

  const alert = await db.regulatoryAlert.findUnique({
    where: { id: alertId },
    include: {
      article: {
        select: {
          title: true,
          url: true,
          summary: true,
          publishDate: true,
          source: { select: { name: true } },
        },
      },
      actions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!alert || alert.practiceId !== pu.practiceId) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "Audit & Insights" },
          {
            label: "Regulatory alerts",
            href: "/audit/regulatory" as Route,
          },
          { label: alert.article.title.slice(0, 60) },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Bell className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {alert.article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={regulatorySeverityBadgeVariant(alert.severity)}
              className="text-[10px]"
            >
              {regulatorySeverityLabel(alert.severity)}
            </Badge>
            {alert.matchedFrameworks.map((fw) => (
              <Badge key={fw} variant="outline" className="text-[10px]">
                {fw}
              </Badge>
            ))}
            <span>{alert.article.source.name}</span>
            {alert.article.publishDate && (
              <span>
                Published {formatPracticeDate(alert.article.publishDate, tz)}
              </span>
            )}
            <span>Created {formatPracticeDate(alert.createdAt, tz)}</span>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Summary</h2>
          <p className="whitespace-pre-line text-sm leading-6 text-foreground">
            {alert.alertBody}
          </p>
          <a
            href={alert.article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Read the original source
          </a>
        </CardContent>
      </Card>

      {alert.recommendedActions.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <h2 className="text-sm font-semibold">Recommended actions</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {alert.recommendedActions.map((action, i) => (
                <li key={`${i}-${action.slice(0, 20)}`}>{action}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Actions</h2>
          <AlertActions
            alertId={alert.id}
            acknowledgedAtIso={alert.acknowledgedAt?.toISOString() ?? null}
            dismissedAtIso={alert.dismissedAt?.toISOString() ?? null}
          />
          {alert.actions.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Saved actions
              </h3>
              <ul className="space-y-2">
                {alert.actions.map((action) => (
                  <li
                    key={action.id}
                    className="rounded-md border bg-muted/30 p-2 text-sm"
                  >
                    <p className="text-foreground">{action.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Status: {action.completionStatus}
                      {action.dueDate
                        ? ` · Due ${formatPracticeDate(action.dueDate, tz)}`
                        : ""}
                      {` · Added ${formatPracticeDate(action.createdAt, tz)}`}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Link
        href={"/audit/regulatory" as Route}
        className="inline-block text-xs text-muted-foreground hover:underline"
      >
        Back to all alerts
      </Link>
    </main>
  );
}
