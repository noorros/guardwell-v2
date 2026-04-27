// src/app/(dashboard)/programs/allergy/quiz/page.tsx
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { BookOpen, Syringe } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { QuizRunner } from "../QuizRunner";

export const metadata = { title: "Allergy Quiz · My Programs" };
export const dynamic = "force-dynamic";

export default async function AllergyQuizPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  // Ensure the allergy framework is enabled for this practice
  const framework = await db.practiceFramework.findFirst({
    where: {
      practiceId: pu.practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!framework) {
    redirect("/dashboard" as Route);
  }

  // Fetch active questions ordered by category then displayOrder
  const questions = await db.allergyQuizQuestion.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { displayOrder: "asc" }],
  });

  // Serialize: options is JSON in Prisma, cast to the expected shape
  type QuizOption = { id: string; text: string };
  const serializedQuestions = questions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    options: q.options as QuizOption[],
    correctId: q.correctId,
    explanation: q.explanation ?? null,
    category: q.category,
  }));

  // Generate fresh attemptId per page render
  const attemptId = randomUUID();

  if (serializedQuestions.length === 0) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <Breadcrumb
          items={[
            { label: "My Programs" },
            { label: "Allergy", href: "/programs/allergy" as Route },
            { label: "Quiz" },
          ]}
        />
        <header className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Syringe className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex-1 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Allergy competency quiz</h1>
            <p className="text-sm text-muted-foreground">USP 797 §21 annual assessment</p>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <BookOpen className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-sm font-medium">No quiz questions seeded yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Contact your admin to add questions.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Allergy", href: "/programs/allergy" as Route },
          { label: "Quiz" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Syringe className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Allergy competency quiz</h1>
          <p className="text-sm text-muted-foreground">
            {serializedQuestions.length} question{serializedQuestions.length !== 1 ? "s" : ""} —
            passing score is 80%. Your answers are saved at the end.
          </p>
        </div>
      </header>
      <QuizRunner
        attemptId={attemptId}
        questions={serializedQuestions}
      />
    </main>
  );
}
