// src/app/(dashboard)/programs/tech-assessment/new/page.tsx
import type { Route } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import {
  TechWizard,
  type TechWizardInitialState,
  type TechWizardQuestion,
} from "./TechWizard";
import type { RiskWeight, TechCategory } from "@/lib/risk/types";

export const metadata = { title: "New Tech Assessment · My Programs" };
export const dynamic = "force-dynamic";

type Answer = "YES" | "NO" | "PARTIAL" | "NA";

export default async function NewTechAssessmentPage({
  searchParams,
}: {
  searchParams?: Promise<{ draftId?: string }>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const sp = (await searchParams) ?? {};

  const [questionRows, draft] = await Promise.all([
    db.techAssessmentQuestion.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: {
        id: true,
        code: true,
        category: true,
        sortOrder: true,
        riskWeight: true,
        title: true,
        description: true,
        guidance: true,
        sraQuestionCode: true,
      },
    }),
    sp.draftId
      ? db.techAssessment.findFirst({
          where: {
            id: sp.draftId,
            practiceId: pu.practiceId,
            isDraft: true,
          },
          include: {
            answers: { include: { question: { select: { code: true } } } },
          },
        })
      : Promise.resolve(null),
  ]);

  const questions: TechWizardQuestion[] = questionRows.map((q) => ({
    id: q.id,
    code: q.code,
    category: q.category as TechCategory,
    sortOrder: q.sortOrder,
    riskWeight: q.riskWeight as RiskWeight,
    title: q.title,
    description: q.description,
    guidance: q.guidance,
    sraQuestionCode: q.sraQuestionCode,
  }));

  let initialState: TechWizardInitialState | undefined;
  if (draft) {
    const answersByCode: Record<string, { answer: Answer; notes: string | null }> = {};
    for (const a of draft.answers) {
      answersByCode[a.question.code] = {
        answer: a.answer as Answer,
        notes: a.notes ?? null,
      };
    }
    initialState = { assessmentId: draft.id, answers: answersByCode };
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Tech Assessment", href: "/programs/tech-assessment" as Route },
          { label: draft ? "Resume draft" : "New" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {draft
              ? "Resume Technical Security Assessment"
              : "Technical Security Assessment"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questions.length} controls across 6 categories. Answers save
            automatically as you go — it&apos;s safe to close the tab and come
            back later.
          </p>
        </div>
        <Link
          href={"/programs/tech-assessment" as Route}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </Link>
      </header>

      <TechWizard questions={questions} initialState={initialState} />
    </main>
  );
}
