// src/app/(dashboard)/programs/policies/[id]/acknowledgments/page.tsx
//
// Workforce-grid view of who has signed the current version of a
// specific policy. Three states per row: SIGNED CURRENT (green), STALE
// (acknowledged an older version), MISSING (never signed).

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Users, ChevronLeft, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { POLICY_METADATA } from "@/lib/compliance/policies";

export const dynamic = "force-dynamic";

export default async function PolicyAcknowledgmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

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

  // All active workforce + their best acknowledgment for this policy.
  const workforce = await db.practiceUser.findMany({
    where: { practiceId: pu.practiceId, removedAt: null },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });

  const userIds = workforce.map((w) => w.user.id);
  const acks =
    userIds.length > 0
      ? await db.policyAcknowledgment.findMany({
          where: {
            practicePolicyId: policy.id,
            userId: { in: userIds },
          },
          orderBy: { acknowledgedAt: "desc" },
          select: {
            userId: true,
            policyVersion: true,
            signatureText: true,
            acknowledgedAt: true,
          },
        })
      : [];
  // Best (highest-version) ack per user.
  const bestByUser = new Map<
    string,
    { policyVersion: number; acknowledgedAt: Date; signatureText: string }
  >();
  for (const a of acks) {
    const existing = bestByUser.get(a.userId);
    if (!existing || a.policyVersion > existing.policyVersion) {
      bestByUser.set(a.userId, {
        policyVersion: a.policyVersion,
        acknowledgedAt: a.acknowledgedAt,
        signatureText: a.signatureText,
      });
    }
  }

  let signedCurrent = 0;
  let stale = 0;
  let missing = 0;
  for (const wu of workforce) {
    const best = bestByUser.get(wu.user.id);
    if (!best) missing += 1;
    else if (best.policyVersion === policy.version) signedCurrent += 1;
    else stale += 1;
  }
  const total = workforce.length;
  const coveragePct = total === 0 ? 0 : Math.round((signedCurrent / total) * 100);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Policies", href: "/programs/policies" },
          { label: title ?? policy.policyCode, href: `/programs/policies/${policy.id}` },
          { label: "Workforce signatures" },
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
          <Users className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Workforce signatures
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-user acknowledgment status for {title}{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {framework}
            </Badge>{" "}
            — currently <strong>v{policy.version}</strong>.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Signed current version
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{ color: "var(--gw-color-compliant)" }}
            >
              {signedCurrent}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {total}
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {coveragePct}% coverage
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Stale (older version)
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{
                color:
                  stale > 0
                    ? "var(--gw-color-needs)"
                    : "var(--gw-color-compliant)",
              }}
            >
              {stale}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Never signed
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{
                color:
                  missing > 0
                    ? "var(--gw-color-risk)"
                    : "var(--gw-color-compliant)",
              }}
            >
              {missing}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              All workforce ({total})
            </h2>
          </div>
          <ul className="divide-y">
            {workforce.map((wu) => {
              const best = bestByUser.get(wu.user.id);
              const status =
                !best
                  ? "MISSING"
                  : best.policyVersion === policy.version
                    ? "CURRENT"
                    : "STALE";
              const Icon =
                status === "CURRENT"
                  ? CheckCircle2
                  : status === "STALE"
                    ? Clock
                    : AlertCircle;
              const tone =
                status === "CURRENT"
                  ? "var(--gw-color-compliant)"
                  : status === "STALE"
                    ? "var(--gw-color-needs)"
                    : "var(--gw-color-risk)";
              const fullName =
                [wu.user.firstName, wu.user.lastName].filter(Boolean).join(" ").trim() ||
                wu.user.email;
              return (
                <li
                  key={wu.id}
                  className="flex items-start gap-3 p-3 text-xs"
                >
                  <Icon
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                    style={{ color: tone }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{fullName}</p>
                      <Badge variant="outline" className="text-[9px]">
                        {wu.role}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[9px]"
                        style={{ color: tone, borderColor: tone }}
                      >
                        {status === "CURRENT"
                          ? `Signed v${best!.policyVersion}`
                          : status === "STALE"
                            ? `Stale: signed v${best!.policyVersion}`
                            : "Never signed"}
                      </Badge>
                    </div>
                    {best && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        Signed{" "}
                        {best.acknowledgedAt
                          .toISOString()
                          .slice(0, 16)
                          .replace("T", " ")}{" "}
                        · "{best.signatureText}"
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
