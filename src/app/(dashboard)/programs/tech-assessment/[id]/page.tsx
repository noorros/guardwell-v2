// src/app/(dashboard)/programs/tech-assessment/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PageProps {
  params: Promise<{ id: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ANSWER_LABEL: Record<string, string> = {
  YES: "Yes — addressed",
  PARTIAL: "Partial",
  NO: "No — gap",
  NA: "N/A",
};

const ANSWER_VARIANT: Record<string, { color: string; border: string }> = {
  YES: {
    color: "var(--gw-color-compliant)",
    border: "var(--gw-color-compliant)",
  },
  PARTIAL: { color: "var(--gw-color-warn)", border: "var(--gw-color-warn)" },
  NO: { color: "var(--gw-color-at-risk)", border: "var(--gw-color-at-risk)" },
  NA: { color: "var(--gw-color-muted)", border: "var(--gw-color-muted)" },
};

const CATEGORY_ORDER = [
  "NETWORK",
  "ENDPOINT",
  "CLOUD",
  "ACCESS",
  "MONITORING",
  "BACKUP",
] as const;

export default async function TechAssessmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const assessment = await db.techAssessment.findUnique({
    where: { id },
    include: {
      answers: {
        include: { question: true },
      },
    },
  });
  if (!assessment || assessment.practiceId !== pu.practiceId) notFound();

  // Drafts don't have a detail view — redirect users back to the wizard
  // so they can keep editing instead of seeing a half-finished page.
  if (assessment.isDraft || assessment.completedAt === null) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <Breadcrumb
          items={[
            { label: "My Programs" },
            { label: "Tech Assessment", href: "/programs/tech-assessment" as Route },
            { label: "Draft" },
          ]}
        />
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm font-medium">
              This Tech Assessment is still a draft.
            </p>
            <p className="text-xs text-muted-foreground">
              Finish answering the remaining controls before viewing the
              completed report.
            </p>
            <Button asChild size="sm">
              <Link
                href={`/programs/tech-assessment/new?draftId=${assessment.id}` as Route}
              >
                Resume assessment
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Sort answers by category (canonical order) and sortOrder.
  const categoryRank = new Map<string, number>(
    CATEGORY_ORDER.map((c, i) => [c, i]),
  );
  const sorted = [...assessment.answers].sort((a, b) => {
    const ca = categoryRank.get(a.question.category) ?? 99;
    const cb = categoryRank.get(b.question.category) ?? 99;
    if (ca !== cb) return ca - cb;
    return a.question.sortOrder - b.question.sortOrder;
  });

  const now = new Date();
  const isFresh =
    now.getTime() - assessment.completedAt.getTime() < 365 * DAY_MS;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Tech Assessment", href: "/programs/tech-assessment" as Route },
          { label: "Assessment" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Completed Tech Assessment
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={isFresh ? "secondary" : "outline"}
              className="text-[10px]"
            >
              Score {assessment.overallScore} · {isFresh ? "Fresh" : "Stale"}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {assessment.addressedCount} / {assessment.totalCount} addressed
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {assessment.completedAt.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </Badge>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {sorted.map((a) => {
              const variant = ANSWER_VARIANT[a.answer] ?? ANSWER_VARIANT.NA!;
              return (
                <li key={a.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {a.question.category}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{
                        color: variant.color,
                        borderColor: variant.border,
                      }}
                    >
                      {ANSWER_LABEL[a.answer] ?? a.answer}
                    </Badge>
                    {a.question.sraQuestionCode && (
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Feeds {a.question.sraQuestionCode}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {a.question.title}
                  </p>
                  {a.notes && (
                    <p className="text-xs text-muted-foreground">
                      Notes: {a.notes}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/programs/tech-assessment" as Route}>
            ← Back to Tech Assessment
          </Link>
        </Button>
      </div>
    </main>
  );
}
