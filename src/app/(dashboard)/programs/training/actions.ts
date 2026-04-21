// src/app/(dashboard)/programs/training/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectTrainingCompleted } from "@/lib/events/projections/trainingCompleted";
import { db } from "@/lib/db";

const Input = z.object({
  courseId: z.string().min(1),
  answers: z.array(z.number().int().min(0)),
});

export interface QuizResult {
  score: number;      // 0–100
  passed: boolean;
  correctCount: number;
  totalCount: number;
  passingScore: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function submitQuizAction(
  input: z.infer<typeof Input>,
): Promise<QuizResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  const course = await db.trainingCourse.findUnique({
    where: { id: parsed.courseId },
    include: { quizQuestions: { orderBy: { order: "asc" } } },
  });
  if (!course) throw new Error("Course not found");
  if (parsed.answers.length !== course.quizQuestions.length) {
    throw new Error(
      `Expected ${course.quizQuestions.length} answers, got ${parsed.answers.length}`,
    );
  }

  const correctCount = course.quizQuestions.reduce((acc, q, i) => {
    return acc + (parsed.answers[i] === q.correctIndex ? 1 : 0);
  }, 0);
  const totalCount = course.quizQuestions.length;
  const score = Math.round((correctCount / totalCount) * 100);
  const passed = score >= course.passingScore;

  const trainingCompletionId = randomUUID();
  const expiresAt = new Date(Date.now() + 365 * DAY_MS);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRAINING_COMPLETED",
      payload: {
        trainingCompletionId,
        userId: user.id,
        courseId: course.id,
        courseCode: course.code,
        courseVersion: course.version,
        score,
        passed,
        expiresAt: expiresAt.toISOString(),
      },
    },
    async (tx) =>
      projectTrainingCompleted(tx, {
        practiceId: pu.practiceId,
        payload: {
          trainingCompletionId,
          userId: user.id,
          courseId: course.id,
          courseCode: course.code,
          courseVersion: course.version,
          score,
          passed,
          expiresAt: expiresAt.toISOString(),
        },
      }),
  );

  revalidatePath("/programs/training");
  revalidatePath(`/programs/training/${course.id}`);
  revalidatePath("/modules/hipaa");

  return {
    score,
    passed,
    correctCount,
    totalCount,
    passingScore: course.passingScore,
  };
}
