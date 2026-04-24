// src/app/(dashboard)/programs/policies/[id]/page.tsx
//
// Policy detail + content editor. Shows the adopted PracticePolicy
// metadata at the top + a large markdown editor below. Save bumps
// version and sets lastReviewedAt = now.

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { FileText, ChevronLeft, History } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { POLICY_METADATA, type PolicyCode } from "@/lib/compliance/policies";
import { getRequiredCourseCodesForPolicy } from "@/lib/compliance/policy-prereqs";
import { requireUser } from "@/lib/auth";
import { PolicyEditor } from "./PolicyEditor";
import { AcknowledgeForm } from "./AcknowledgeForm";

export const dynamic = "force-dynamic";

const REVIEW_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;
  const user = await requireUser();

  const policy = await db.practicePolicy.findUnique({
    where: { id },
    select: {
      id: true,
      practiceId: true,
      policyCode: true,
      content: true,
      version: true,
      adoptedAt: true,
      lastReviewedAt: true,
      retiredAt: true,
    },
  });
  if (!policy || policy.practiceId !== pu.practiceId) {
    notFound();
  }

  // Resolve display title + framework. Prefer the canonical
  // POLICY_METADATA entry (for the 9 core codes), fall back to the
  // PolicyTemplate catalog (for the 130-template codes).
  const coreMeta = (POLICY_METADATA as Record<string, unknown>)[
    policy.policyCode
  ] as
    | { title: string; framework: string; description: string }
    | undefined;
  let title = coreMeta?.title;
  let framework = coreMeta?.framework;
  let description = coreMeta?.description;
  if (!title) {
    const tpl = await db.policyTemplate.findUnique({
      where: { code: policy.policyCode },
      select: { title: true, framework: true, description: true },
    });
    title = tpl?.title ?? policy.policyCode;
    framework = tpl?.framework ?? "OTHER";
    description = tpl?.description;
  }

  // Days-until / days-since the next required review (365d window).
  let reviewLabel: string | null = null;
  let reviewColor: string | null = null;
  if (policy.lastReviewedAt) {
    const dueAt = new Date(
      policy.lastReviewedAt.getTime() + REVIEW_WINDOW_MS,
    );
    const diffDays = Math.ceil(
      (dueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays < 0) {
      reviewLabel = `Review overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`;
      reviewColor = "var(--gw-color-risk)";
    } else if (diffDays <= 60) {
      reviewLabel = `Review due in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
      reviewColor = "var(--gw-color-needs)";
    } else {
      reviewLabel = `Next review in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
      reviewColor = "var(--gw-color-compliant)";
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Policies", href: "/programs/policies" },
          { label: title ?? policy.policyCode },
        ]}
      />
      <div>
        <Link
          href={"/programs/policies" as Route}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          Back to all policies
        </Link>
      </div>
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary" className="text-[10px]">
              {framework}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              v{policy.version}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Adopted {policy.adoptedAt.toISOString().slice(0, 10)}
            </Badge>
            {policy.lastReviewedAt && (
              <Badge variant="outline" className="text-[10px]">
                Last reviewed {policy.lastReviewedAt.toISOString().slice(0, 10)}
              </Badge>
            )}
            {reviewLabel && (
              <span
                className="text-[11px]"
                style={{ color: reviewColor ?? undefined }}
              >
                · {reviewLabel}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Acknowledgment block — per-user signature gate */}
      {await renderAcknowledgeBlock({
        practicePolicyId: policy.id,
        policyCode: policy.policyCode,
        policyVersion: policy.version,
        policyTitle: title ?? policy.policyCode,
        userId: user.id,
        userFirstName: user.firstName ?? null,
        userLastName: user.lastName ?? null,
        userEmail: user.email,
        practiceId: pu.practiceId,
      })}

      <Card>
        <CardContent className="space-y-2 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Policy content</h2>
            <div className="flex gap-3">
              <Link
                href={`/programs/policies/${policy.id}/acknowledgments` as Route}
                className="inline-flex items-center gap-1 text-[11px] text-foreground underline hover:no-underline"
              >
                Workforce signatures
              </Link>
              <Link
                href={`/programs/policies/${policy.id}/history` as Route}
                className="inline-flex items-center gap-1 text-[11px] text-foreground underline hover:no-underline"
              >
                <History className="h-3 w-3" aria-hidden="true" />
                Version history
              </Link>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Edit in Markdown. The body is rendered into your audit
            packet PDFs as-is. Save bumps the version and counts as
            your annual review attestation.
          </p>
          <PolicyEditor
            practicePolicyId={policy.id}
            initialContent={policy.content ?? ""}
            policyTitle={title ?? policy.policyCode}
          />
        </CardContent>
      </Card>
    </main>
  );
}

async function renderAcknowledgeBlock(args: {
  practicePolicyId: string;
  policyCode: string;
  policyVersion: number;
  policyTitle: string;
  userId: string;
  userFirstName: string | null;
  userLastName: string | null;
  userEmail: string;
  practiceId: string;
}) {
  // Already-acked-this-version lookup.
  const existing = await db.policyAcknowledgment.findUnique({
    where: {
      practicePolicyId_userId_policyVersion: {
        practicePolicyId: args.practicePolicyId,
        userId: args.userId,
        policyVersion: args.policyVersion,
      },
    },
    select: { acknowledgedAt: true },
  });

  // Resolve prerequisite courses + the user's completion state for each.
  const requiredCourseCodes = getRequiredCourseCodesForPolicy(args.policyCode);
  const courses =
    requiredCourseCodes.length > 0
      ? await db.trainingCourse.findMany({
          where: { code: { in: requiredCourseCodes } },
          select: { id: true, code: true, title: true },
        })
      : [];
  const completions =
    courses.length > 0
      ? await db.trainingCompletion.findMany({
          where: {
            userId: args.userId,
            practiceId: args.practiceId,
            courseId: { in: courses.map((c) => c.id) },
            passed: true,
            expiresAt: { gt: new Date() },
          },
          distinct: ["userId", "courseId"],
          select: { courseId: true },
        })
      : [];
  const completedSet = new Set(completions.map((c) => c.courseId));
  const prerequisites = courses.map((c) => ({
    courseCode: c.code,
    courseTitle: c.title,
    completed: completedSet.has(c.id),
  }));

  const fullName = [args.userFirstName, args.userLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const defaultSignature = `I, ${fullName || args.userEmail}, have read and will comply with the ${args.policyTitle}.`;

  return (
    <AcknowledgeForm
      practicePolicyId={args.practicePolicyId}
      policyTitle={args.policyTitle}
      policyVersion={args.policyVersion}
      alreadyAcknowledged={!!existing}
      acknowledgedAt={existing?.acknowledgedAt?.toISOString() ?? null}
      prerequisites={prerequisites}
      defaultSignature={defaultSignature}
    />
  );
}
