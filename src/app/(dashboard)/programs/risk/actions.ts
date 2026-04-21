// src/app/(dashboard)/programs/risk/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import { db } from "@/lib/db";

const AnswerInput = z.object({
  questionCode: z.string().min(1),
  answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
  notes: z.string().max(2000).nullable().optional(),
});

const Input = z.object({
  answers: z.array(AnswerInput).min(1),
});

export interface SraSubmitResult {
  assessmentId: string;
  overallScore: number;
  addressedCount: number;
  totalCount: number;
}

export async function completeSraAction(
  input: z.infer<typeof Input>,
): Promise<SraSubmitResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  // Validate every answered question exists.
  const questions = await db.sraQuestion.findMany({
    where: { code: { in: parsed.answers.map((a) => a.questionCode) } },
    select: { code: true },
  });
  const knownCodes = new Set(questions.map((q) => q.code));
  const bad = parsed.answers.filter((a) => !knownCodes.has(a.questionCode));
  if (bad.length > 0) {
    throw new Error(`Unknown SRA question codes: ${bad.map((b) => b.questionCode).join(", ")}`);
  }

  const totalCount = parsed.answers.length;
  const addressedCount = parsed.answers.filter(
    (a) => a.answer === "YES" || a.answer === "NA",
  ).length;
  const overallScore = Math.round((addressedCount / totalCount) * 100);

  const assessmentId = randomUUID();
  const payload = {
    assessmentId,
    completedByUserId: user.id,
    overallScore,
    addressedCount,
    totalCount,
    answers: parsed.answers.map((a) => ({
      questionCode: a.questionCode,
      answer: a.answer,
      notes: a.notes ?? null,
    })),
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "SRA_COMPLETED",
      payload,
    },
    async (tx) => projectSraCompleted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/risk");
  revalidatePath("/modules/hipaa");

  return { assessmentId, overallScore, addressedCount, totalCount };
}
