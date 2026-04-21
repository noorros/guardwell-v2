// src/app/(dashboard)/programs/training/[courseId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuizRunner } from "./QuizRunner";

interface PageProps {
  params: Promise<{ courseId: string }>;
}

export default async function CoursePage({ params }: PageProps) {
  const { courseId } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const course = await db.trainingCourse.findUnique({
    where: { id: courseId },
    include: { quizQuestions: { orderBy: { order: "asc" } } },
  });
  if (!course) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Training", href: "/programs/training" },
          { label: course.title },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
          {course.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {course.description}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {course.quizQuestions.length} quiz questions · pass {course.passingScore}%
            {course.durationMinutes ? ` · ~${course.durationMinutes} min` : ""}
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="p-6">
          <div
            className="prose prose-sm max-w-none text-foreground [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:my-2 [&_li]:my-1 [&_p]:my-2 [&_.callout]:my-4 [&_.callout]:rounded-md [&_.callout]:border [&_.callout]:bg-muted/40 [&_.callout]:p-3 [&_.callout-warning]:border-yellow-500/40 [&_.callout-example]:border-blue-500/40"
            dangerouslySetInnerHTML={{ __html: course.lessonContent }}
          />
        </CardContent>
      </Card>

      <QuizRunner
        courseId={course.id}
        passingScore={course.passingScore}
        questions={course.quizQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          order: q.order,
        }))}
      />

      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/programs/training" as Route}>← Back to Training</Link>
        </Button>
      </div>
    </main>
  );
}
