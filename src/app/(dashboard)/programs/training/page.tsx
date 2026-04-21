// src/app/(dashboard)/programs/training/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrainingStatusBadge } from "./TrainingStatusBadge";

export const metadata = { title: "Training · My Programs" };

export default async function TrainingPage() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) return null;

  const courses = await db.trainingCourse.findMany({
    where: { isRequired: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      type: true,
      durationMinutes: true,
      passingScore: true,
      _count: { select: { quizQuestions: true } },
    },
  });

  const completions = await db.trainingCompletion.findMany({
    where: {
      practiceId: pu.practiceId,
      userId: user.id,
      courseId: { in: courses.map((c) => c.id) },
    },
    orderBy: { completedAt: "desc" },
    select: {
      courseId: true,
      score: true,
      passed: true,
      completedAt: true,
      expiresAt: true,
    },
  });

  // Latest completion per course for the current user.
  const latestByCourse = new Map<
    string,
    (typeof completions)[number]
  >();
  for (const c of completions) {
    if (!latestByCourse.has(c.courseId)) latestByCourse.set(c.courseId, c);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Training" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete required training to satisfy HIPAA workforce-training
            obligations. Your completions auto-update the matching HIPAA
            requirements on your module page.
          </p>
        </div>
      </header>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No required training courses are configured yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {courses.map((course) => {
                const latest = latestByCourse.get(course.id);
                return (
                  <li
                    key={course.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {course.title}
                        </p>
                        <Badge variant="secondary" className="text-[10px]">
                          {course.type}
                        </Badge>
                        <TrainingStatusBadge latest={latest ?? null} />
                      </div>
                      {course.description && (
                        <p className="text-xs text-muted-foreground">
                          {course.description}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {course._count.quizQuestions} questions · pass {course.passingScore}% ·
                        {course.durationMinutes ? ` ~${course.durationMinutes} min` : " self-paced"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant={latest?.passed && new Date(latest.expiresAt) > new Date() ? "outline" : "default"}>
                        <Link
                          href={
                            `/programs/training/${course.id}` as Route
                          }
                        >
                          {latest?.passed ? "Retake" : "Start"}
                        </Link>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
