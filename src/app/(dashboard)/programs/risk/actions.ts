// src/app/(dashboard)/programs/risk/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import { projectSraDraftSaved } from "@/lib/events/projections/sraDraftSaved";
import { db } from "@/lib/db";

const AnswerInput = z.object({
  questionCode: z.string().min(1),
  answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
  notes: z.string().max(2000).nullable().optional(),
});

const CompleteInput = z.object({
  assessmentId: z.string().min(1).optional(),
  answers: z.array(AnswerInput).min(1),
});

const DraftInput = z.object({
  assessmentId: z.string().min(1).optional(),
  currentStep: z.number().int().min(0).max(2),
  answers: z.array(AnswerInput),
});

export interface SraSubmitResult {
  assessmentId: string;
  overallScore: number;
  addressedCount: number;
  totalCount: number;
}

export interface SraDraftSaveResult {
  assessmentId: string;
}

async function validateQuestionCodes(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const questions = await db.sraQuestion.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const known = new Set(questions.map((q) => q.code));
  const bad = codes.filter((c) => !known.has(c));
  if (bad.length > 0) {
    throw new Error(`Unknown SRA question codes: ${bad.join(", ")}`);
  }
}

export async function completeSraAction(
  input: z.infer<typeof CompleteInput>,
): Promise<SraSubmitResult> {
  const user = await requireUser();
  // Audit HIPAA C-2: HIPAA §164.308(a)(1)(ii)(A) requires a "thorough,
  // accurate" risk analysis. STAFF/VIEWER must not be able to flip
  // HIPAA_SRA to COMPLIANT — only the OWNER or designated security
  // officer (ADMIN) can complete the SRA on the practice's behalf.
  const pu = await requireRole("ADMIN");
  const parsed = CompleteInput.parse(input);

  await validateQuestionCodes(parsed.answers.map((a) => a.questionCode));

  const totalCount = parsed.answers.length;
  const addressedCount = parsed.answers.filter(
    (a) => a.answer === "YES" || a.answer === "NA",
  ).length;
  const overallScore = Math.round((addressedCount / totalCount) * 100);

  // If the wizard is promoting a draft, reuse that assessment id so the
  // projection upserts rather than creating a second row.
  const assessmentId = parsed.assessmentId ?? randomUUID();
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

export async function saveSraDraftAction(
  input: z.infer<typeof DraftInput>,
): Promise<SraDraftSaveResult> {
  const user = await requireUser();
  // Audit HIPAA C-2: same gate as completeSraAction — drafts must be
  // authored by an OWNER/ADMIN since the wizard promotes a draft into
  // a completed SRA without re-auth and a STAFF-authored draft would
  // bypass the role check.
  const pu = await requireRole("ADMIN");
  const parsed = DraftInput.parse(input);

  await validateQuestionCodes(parsed.answers.map((a) => a.questionCode));

  const assessmentId = parsed.assessmentId ?? randomUUID();
  const payload = {
    assessmentId,
    currentStep: parsed.currentStep,
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
      type: "SRA_DRAFT_SAVED",
      payload,
    },
    async (tx) =>
      projectSraDraftSaved(tx, {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        payload,
      }),
  );

  revalidatePath("/programs/risk");

  return { assessmentId };
}
