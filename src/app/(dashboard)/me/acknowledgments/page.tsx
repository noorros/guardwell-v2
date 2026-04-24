// src/app/(dashboard)/me/acknowledgments/page.tsx
//
// Per-user surface listing every adopted policy in the practice + the
// signed-in user's acknowledgment status for each. Three buckets:
//   - Pending: never signed (or signed an older version)
//   - Signed current: up to date
//   - Includes prerequisite-completion status so users see what they
//     need to do before they can sign

import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { POLICY_METADATA } from "@/lib/compliance/policies";
import { getRequiredCourseCodesForPolicy } from "@/lib/compliance/policy-prereqs";

export const metadata = { title: "My acknowledgments" };
export const dynamic = "force-dynamic";

export default async function MyAcknowledgmentsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const user = await requireUser();

  // All adopted (non-retired) policies in the practice.
  const policies = await db.practicePolicy.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ policyCode: "asc" }],
    select: {
      id: true,
      policyCode: true,
      version: true,
    },
  });

  // User's acks for these policies (any version).
  const acks =
    policies.length > 0
      ? await db.policyAcknowledgment.findMany({
          where: {
            practicePolicyId: { in: policies.map((p) => p.id) },
            userId: user.id,
          },
          orderBy: { policyVersion: "desc" },
          select: {
            practicePolicyId: true,
            policyVersion: true,
            acknowledgedAt: true,
          },
        })
      : [];
  const bestByPolicy = new Map<
    string,
    { policyVersion: number; acknowledgedAt: Date }
  >();
  for (const a of acks) {
    if (!bestByPolicy.has(a.practicePolicyId)) {
      bestByPolicy.set(a.practicePolicyId, {
        policyVersion: a.policyVersion,
        acknowledgedAt: a.acknowledgedAt,
      });
    }
  }

  // For each policy, look up its title + prereq courses + the user's
  // completion state for those courses.
  const allCourseCodes = new Set<string>();
  for (const p of policies) {
    for (const code of getRequiredCourseCodesForPolicy(p.policyCode)) {
      allCourseCodes.add(code);
    }
  }
  const courses =
    allCourseCodes.size > 0
      ? await db.trainingCourse.findMany({
          where: { code: { in: Array.from(allCourseCodes) } },
          select: { id: true, code: true, title: true },
        })
      : [];
  const courseByCode = new Map(courses.map((c) => [c.code, c]));
  const completedCourseIds = new Set(
    courses.length === 0
      ? []
      : (
          await db.trainingCompletion.findMany({
            where: {
              userId: user.id,
              practiceId: pu.practiceId,
              courseId: { in: courses.map((c) => c.id) },
              passed: true,
              expiresAt: { gt: new Date() },
            },
            distinct: ["userId", "courseId"],
            select: { courseId: true },
          })
        ).map((c) => c.courseId),
  );

  // Resolve titles for adopted policies. Look up the PolicyTemplate
  // catalog for any non-core codes.
  const nonCoreCodes = policies
    .map((p) => p.policyCode)
    .filter(
      (code) =>
        !(POLICY_METADATA as Record<string, unknown>)[code],
    );
  const templates =
    nonCoreCodes.length > 0
      ? await db.policyTemplate.findMany({
          where: { code: { in: nonCoreCodes } },
          select: { code: true, title: true, framework: true },
        })
      : [];
  const tplByCode = new Map(templates.map((t) => [t.code, t]));

  // Bucket the policies for rendering.
  type Row = {
    id: string;
    policyCode: string;
    title: string;
    framework: string;
    version: number;
    status: "CURRENT" | "STALE" | "MISSING";
    bestVersion?: number;
    bestAt?: Date;
    pendingPrereqs: Array<{ courseCode: string; courseTitle: string }>;
  };
  const rows: Row[] = policies.map((p) => {
    const best = bestByPolicy.get(p.id);
    const status: Row["status"] = !best
      ? "MISSING"
      : best.policyVersion === p.version
        ? "CURRENT"
        : "STALE";
    const coreMeta = (POLICY_METADATA as Record<string, unknown>)[
      p.policyCode
    ] as { title: string; framework: string } | undefined;
    const tpl = tplByCode.get(p.policyCode);
    const title = coreMeta?.title ?? tpl?.title ?? p.policyCode;
    const framework = coreMeta?.framework ?? tpl?.framework ?? "OTHER";
    const prereqCodes = getRequiredCourseCodesForPolicy(p.policyCode);
    const pendingPrereqs = prereqCodes
      .map((code) => courseByCode.get(code))
      .filter((c): c is { id: string; code: string; title: string } => !!c)
      .filter((c) => !completedCourseIds.has(c.id))
      .map((c) => ({ courseCode: c.code, courseTitle: c.title }));
    return {
      id: p.id,
      policyCode: p.policyCode,
      title,
      framework,
      version: p.version,
      status,
      bestVersion: best?.policyVersion,
      bestAt: best?.acknowledgedAt,
      pendingPrereqs,
    };
  });

  const pending = rows.filter((r) => r.status !== "CURRENT");
  const current = rows.filter((r) => r.status === "CURRENT");

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My acknowledgments" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            My policy acknowledgments
          </h1>
          <p className="text-sm text-muted-foreground">
            Every adopted policy in your practice + your signature status.
            HIPAA §164.530(b)(2) expects a per-workforce-member attestation
            that you've read and understand each policy.
          </p>
        </div>
      </header>

      <PolicyBucket
        title={`Pending (${pending.length})`}
        emptyText="You're up to date on every adopted policy."
        rows={pending}
        missingTone="var(--gw-color-risk)"
        staleTone="var(--gw-color-needs)"
      />

      <PolicyBucket
        title={`Signed current version (${current.length})`}
        emptyText="No policies signed at the current version yet."
        rows={current}
        missingTone="var(--gw-color-compliant)"
        staleTone="var(--gw-color-compliant)"
      />
    </main>
  );
}

function PolicyBucket({
  title,
  emptyText,
  rows,
  missingTone,
  staleTone,
}: {
  title: string;
  emptyText: string;
  rows: Array<{
    id: string;
    title: string;
    framework: string;
    version: number;
    status: "CURRENT" | "STALE" | "MISSING";
    bestVersion?: number;
    bestAt?: Date;
    pendingPrereqs: Array<{ courseCode: string; courseTitle: string }>;
  }>;
  missingTone: string;
  staleTone: string;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const Icon =
                r.status === "CURRENT"
                  ? CheckCircle2
                  : r.status === "STALE"
                    ? Clock
                    : AlertCircle;
              const tone =
                r.status === "CURRENT"
                  ? "var(--gw-color-compliant)"
                  : r.status === "STALE"
                    ? staleTone
                    : missingTone;
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 p-3 text-xs sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Icon
                      className="mt-0.5 h-4 w-4 flex-shrink-0"
                      style={{ color: tone }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{r.title}</p>
                        <Badge variant="secondary" className="text-[9px]">
                          {r.framework}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[9px]"
                          style={{ color: tone, borderColor: tone }}
                        >
                          {r.status === "CURRENT"
                            ? `v${r.bestVersion}`
                            : r.status === "STALE"
                              ? `Stale: signed v${r.bestVersion}, current v${r.version}`
                              : `Never signed (v${r.version})`}
                        </Badge>
                      </div>
                      {r.pendingPrereqs.length > 0 && (
                        <p className="text-[10px] text-[color:var(--gw-color-needs)]">
                          Prereq{r.pendingPrereqs.length === 1 ? "" : "s"} pending:{" "}
                          {r.pendingPrereqs.map((p) => p.courseTitle).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/programs/policies/${r.id}` as Route}
                    className="self-start rounded-md border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent sm:self-center"
                  >
                    {r.status === "CURRENT" ? "View" : "Sign →"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
