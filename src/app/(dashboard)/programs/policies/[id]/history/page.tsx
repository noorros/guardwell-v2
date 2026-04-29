// src/app/(dashboard)/programs/policies/[id]/history/page.tsx
//
// Version history + diff view for an adopted policy. Lists every
// PolicyVersion newest-first with a "show diff vs previous version"
// toggle (driven by ?diff=N URL query). Renders a unified line diff
// using src/lib/policy/diff.ts.

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { History, ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { POLICY_METADATA } from "@/lib/compliance/policies";
import { diffLines } from "@/lib/policy/diff";
import { formatPracticeDate } from "@/lib/audit/format";

export const dynamic = "force-dynamic";

export default async function PolicyHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ diff?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const pu = await getPracticeUser();
  if (!pu) return null;
  const tz = pu.practice.timezone ?? "UTC";

  const policy = await db.practicePolicy.findUnique({
    where: { id },
    select: {
      id: true,
      practiceId: true,
      policyCode: true,
      version: true,
    },
  });
  if (!policy || policy.practiceId !== pu.practiceId) {
    notFound();
  }

  const coreMeta = (POLICY_METADATA as Record<string, unknown>)[
    policy.policyCode
  ] as { title: string; framework: string } | undefined;
  let title = coreMeta?.title;
  let framework = coreMeta?.framework;
  if (!title) {
    const tpl = await db.policyTemplate.findUnique({
      where: { code: policy.policyCode },
      select: { title: true, framework: true },
    });
    title = tpl?.title ?? policy.policyCode;
    framework = tpl?.framework ?? "OTHER";
  }

  const versions = await db.policyVersion.findMany({
    where: { practicePolicyId: policy.id },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      content: true,
      savedAt: true,
      savedByUserId: true,
      changeNote: true,
    },
  });

  // Lookup actor names so we can show who saved each version.
  const actorIds = Array.from(
    new Set(versions.map((v) => v.savedByUserId).filter((x): x is string => !!x)),
  );
  const actors =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  // Parse the ?diff=N query — N is the NEW version. We diff vs N-1.
  const diffNew = sp.diff ? Number.parseInt(sp.diff, 10) : null;
  const diffPair =
    diffNew && Number.isFinite(diffNew) && diffNew >= 2
      ? {
          newVer: versions.find((v) => v.version === diffNew),
          oldVer: versions.find((v) => v.version === diffNew - 1),
        }
      : null;

  const renderedDiff =
    diffPair && diffPair.newVer && diffPair.oldVer
      ? diffLines(
          diffPair.oldVer.content ?? "",
          diffPair.newVer.content ?? "",
        )
      : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Policies", href: "/programs/policies" },
          { label: title ?? policy.policyCode, href: `/programs/policies/${policy.id}` },
          { label: "History" },
        ]}
      />
      <div>
        <Link
          href={`/programs/policies/${policy.id}` as Route}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          Back to policy editor
        </Link>
      </div>
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <History className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Version history
          </h1>
          <p className="text-sm text-muted-foreground">
            {title}{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {framework}
            </Badge>{" "}
            ·{" "}
            <span className="text-muted-foreground">
              {versions.length} version{versions.length === 1 ? "" : "s"}{" "}
              · current v{policy.version}
            </span>
          </p>
        </div>
      </header>

      {renderedDiff && diffPair?.newVer && diffPair?.oldVer && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Diff: v{diffPair.oldVer.version} → v{diffPair.newVer.version}
              </h2>
              <Link
                href={`/programs/policies/${policy.id}/history` as Route}
                className="text-[11px] text-foreground underline hover:no-underline"
              >
                Close diff
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {renderedDiff.addedLineCount} line
              {renderedDiff.addedLineCount === 1 ? "" : "s"} added ·{" "}
              {renderedDiff.removedLineCount} removed ·{" "}
              {renderedDiff.unchangedLineCount} unchanged
            </p>
            <pre className="max-h-[600px] overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed">
              {renderedDiff.lines.map((line, idx) => {
                const sign =
                  line.kind === "ADD"
                    ? "+"
                    : line.kind === "REMOVE"
                      ? "-"
                      : " ";
                const color =
                  line.kind === "ADD"
                    ? "var(--gw-color-compliant)"
                    : line.kind === "REMOVE"
                      ? "var(--gw-color-risk)"
                      : "var(--muted-foreground)";
                const bg =
                  line.kind === "ADD"
                    ? "color-mix(in oklch, var(--gw-color-compliant) 12%, transparent)"
                    : line.kind === "REMOVE"
                      ? "color-mix(in oklch, var(--gw-color-risk) 12%, transparent)"
                      : "transparent";
                return (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: bg,
                      color: line.kind === "EQUAL" ? color : undefined,
                    }}
                  >
                    <span
                      className="inline-block w-3 select-none"
                      style={{ color }}
                    >
                      {sign}
                    </span>
                    <span>{line.text}</span>
                  </div>
                );
              })}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              All versions (newest first)
            </h2>
          </div>
          <ul className="divide-y">
            {versions.map((v) => {
              const actor = v.savedByUserId
                ? actorById.get(v.savedByUserId)
                : null;
              const actorLabel = actor
                ? [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
                  actor.email
                : v.version === 1
                  ? "Initial adoption"
                  : "System";
              const canDiff = v.version >= 2;
              const isCurrent = v.version === policy.version;
              return (
                <li
                  key={v.id}
                  className="flex flex-col gap-1 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        v{v.version}
                      </Badge>
                      {isCurrent && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            color: "var(--gw-color-compliant)",
                            borderColor: "var(--gw-color-compliant)",
                          }}
                        >
                          Current
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        {formatPracticeDate(v.savedAt, tz)} ·{" "}
                        {(v.content?.length ?? 0).toLocaleString()} chars
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {actorLabel}
                      {v.changeNote ? ` · ${v.changeNote}` : ""}
                    </p>
                  </div>
                  {canDiff && (
                    <Link
                      href={
                        `/programs/policies/${policy.id}/history?diff=${v.version}` as Route
                      }
                      className="self-start rounded-md border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent sm:self-center"
                    >
                      Diff vs v{v.version - 1}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
