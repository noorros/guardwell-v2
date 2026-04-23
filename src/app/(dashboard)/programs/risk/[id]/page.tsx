// src/app/(dashboard)/programs/risk/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SraAssessmentBadge } from "../SraAssessmentBadge";

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

const ANSWER_VARIANT: Record<
  string,
  { color: string; border: string }
> = {
  YES: {
    color: "var(--gw-color-compliant)",
    border: "var(--gw-color-compliant)",
  },
  PARTIAL: { color: "var(--gw-color-warn)", border: "var(--gw-color-warn)" },
  NO: {
    color: "var(--gw-color-at-risk)",
    border: "var(--gw-color-at-risk)",
  },
  NA: { color: "var(--gw-color-muted)", border: "var(--gw-color-muted)" },
};

export default async function SraDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const assessment = await db.practiceSraAssessment.findUnique({
    where: { id },
    include: {
      answers: {
        include: { question: true },
      },
    },
  });
  if (!assessment || assessment.practiceId !== pu.practiceId) notFound();
  // Drafts don't have a detail view — redirect users back to the wizard
  // so they can continue editing instead of seeing a half-finished page.
  if (assessment.isDraft || assessment.completedAt === null) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <Breadcrumb
          items={[
            { label: "My Programs" },
            { label: "Risk", href: "/programs/risk" as Route },
            { label: "Draft" },
          ]}
        />
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm font-medium">This SRA is still a draft.</p>
            <p className="text-xs text-muted-foreground">
              Finish answering the remaining safeguards before viewing the completed report.
            </p>
            <Button asChild size="sm">
              <Link href={`/programs/risk/new?draftId=${assessment.id}` as Route}>
                Resume SRA
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Sort answers by category, subcategory, and sortOrder for a predictable read.
  const sorted = [...assessment.answers].sort((a, b) => {
    const ca = a.question.category;
    const cb = b.question.category;
    if (ca !== cb) return ca.localeCompare(cb);
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
          { label: "Risk", href: "/programs/risk" as Route },
          { label: "Assessment" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Completed SRA</h1>
          <div className="flex flex-wrap gap-2">
            <SraAssessmentBadge
              completedAt={assessment.completedAt.toISOString()}
              overallScore={assessment.overallScore}
              fresh={isFresh}
            />
            <Badge variant="secondary" className="text-[10px]">
              {assessment.addressedCount} / {assessment.totalCount} addressed
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
                      {a.question.category.replaceAll("_", " ")}
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
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {a.question.subcategory}
                    </p>
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
          <Link href={"/programs/risk" as Route}>← Back to Risk</Link>
        </Button>
      </div>
    </main>
  );
}
