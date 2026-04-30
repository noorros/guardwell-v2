// src/app/(dashboard)/programs/training/[courseId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CourseRunner } from "./CourseRunner";

interface PageProps {
  params: Promise<{ courseId: string }>;
}

export default async function CoursePage({ params }: PageProps) {
  const { courseId } = await params;
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) return null;

  const course = await db.trainingCourse.findUnique({
    where: { id: courseId },
    include: { quizQuestions: { orderBy: { order: "asc" } } },
  });
  if (!course) notFound();

  // Phase 4 PR 6 (BYOV): if the course has a video, server-side fetch
  // the user's saved progress so the quiz can unlock on a return visit
  // without re-watching. The CourseRunner client wrapper picks up where
  // we leave off and tracks live progress from then on.
  const videoProgress =
    course.videoUrl && course.videoDurationSec
      ? await db.videoProgress.findUnique({
          where: {
            practiceId_userId_courseId: {
              practiceId: pu.practiceId,
              userId: user.id,
              courseId: course.id,
            },
          },
          select: { watchedSeconds: true },
        })
      : null;

  // The video pointer is an Evidence.id; resolve it to a fresh signed
  // GCS URL via the existing /api/evidence/<id>/download route. The
  // browser is redirected (302) on demand by the route — we just hand
  // the route path to <video src> here.
  const videoSrc = course.videoUrl
    ? `/api/evidence/${course.videoUrl}/download`
    : null;

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

      <CourseRunner
        courseId={course.id}
        passingScore={course.passingScore}
        questions={course.quizQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          order: q.order,
        }))}
        videoSrc={videoSrc}
        videoDurationSec={course.videoDurationSec ?? 0}
        initialWatchedSeconds={videoProgress?.watchedSeconds ?? 0}
      />

      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/programs/training" as Route}>← Back to Training</Link>
        </Button>
      </div>
    </main>
  );
}
