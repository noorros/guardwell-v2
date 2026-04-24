// src/app/onboarding/first-run/Step3Training.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import {
  QuizRunner,
  type QuizQuestion,
} from "@/app/(dashboard)/programs/training/[courseId]/QuizRunner";

export interface Step3TrainingProps {
  course: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    passingScore: number;
    quizQuestions: QuizQuestion[];
  } | null;
  onComplete: () => void;
}

export function Step3Training({ course, onComplete }: Step3TrainingProps) {
  const [passed, setPassed] = useState(false);

  if (!course) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          HIPAA Basics course missing from the catalog. Contact support.
        </p>
        <Button onClick={onComplete} variant="ghost">
          Skip this step
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 3 · 10 minutes
        </p>
        <h2 className="text-xl font-semibold">Take HIPAA Basics yourself</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          OCR expects every workforce member to complete HIPAA training. Pass at
          {" "}{course.passingScore}% to satisfy HIPAA_WORKFORCE_TRAINING for yourself.
        </p>
        {course.description && (
          <p className="mt-2 text-xs text-muted-foreground">{course.description}</p>
        )}
      </div>
      <div className="rounded-md border bg-muted/30 p-4">
        <QuizRunner
          courseId={course.id}
          passingScore={course.passingScore}
          questions={course.quizQuestions}
          onPass={() => setPassed(true)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Prefer the full lesson?{" "}
        <Link
          href={`/programs/training/${course.id}` as Route}
          className="underline"
          target="_blank"
        >
          Open the course in a new tab
        </Link>
        {" "}— quiz state is shared.
      </p>
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!passed}>
          Continue → Invite your team
        </Button>
      </div>
    </div>
  );
}
