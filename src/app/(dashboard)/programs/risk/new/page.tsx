// src/app/(dashboard)/programs/risk/new/page.tsx
import type { Route } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { SraWizard, type SraWizardInitialState } from "./SraWizard";

export const metadata = { title: "New SRA · My Programs" };

type Answer = "YES" | "NO" | "PARTIAL" | "NA";

export default async function NewSraPage({
  searchParams,
}: {
  searchParams?: Promise<{ draftId?: string }>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const sp = (await searchParams) ?? {};

  const [questions, draft] = await Promise.all([
    db.sraQuestion.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: {
        code: true,
        category: true,
        subcategory: true,
        title: true,
        description: true,
        guidance: true,
        lookFor: true,
      },
    }),
    sp.draftId
      ? db.practiceSraAssessment.findFirst({
          where: {
            id: sp.draftId,
            practiceId: pu.practiceId,
            isDraft: true,
          },
          include: { answers: { include: { question: true } } },
        })
      : Promise.resolve(null),
  ]);

  let initialState: SraWizardInitialState | undefined;
  if (draft) {
    const answerMap: Record<string, Answer> = {};
    const noteMap: Record<string, string> = {};
    for (const a of draft.answers) {
      answerMap[a.question.code] = a.answer as Answer;
      if (a.notes) noteMap[a.question.code] = a.notes;
    }
    initialState = {
      assessmentId: draft.id,
      currentStep: draft.currentStep,
      answers: answerMap,
      notes: noteMap,
    };
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Risk", href: "/programs/risk" as Route },
          { label: draft ? "Resume SRA" : "New SRA" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {draft ? "Resume Security Risk Assessment" : "New Security Risk Assessment"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questions.length} safeguards across 3 categories. Answers save
            automatically as you move between steps — it&apos;s safe to close the
            tab and come back later.
          </p>
        </div>
        <Link
          href={"/programs/risk" as Route}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </Link>
      </header>

      <SraWizard
        questions={questions.map((q) => ({
          code: q.code,
          category: q.category,
          subcategory: q.subcategory,
          title: q.title,
          description: q.description,
          guidance: q.guidance,
          lookFor: q.lookFor,
        }))}
        initialState={initialState}
      />
    </main>
  );
}
