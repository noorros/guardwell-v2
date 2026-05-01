// src/app/(dashboard)/programs/tech-assessment/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectTechAssessmentQuestionAnswered } from "@/lib/events/projections/techAssessmentQuestionAnswered";
import { projectTechAssessmentSubmitted } from "@/lib/events/projections/techAssessmentSubmitted";
import { db } from "@/lib/db";
import { computeSraScore } from "@/lib/sra/scoring";
import type { RiskWeight } from "@/lib/risk/types";

const AnswerInput = z.object({
  questionCode: z.string().min(1),
  answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
  notes: z.string().max(2000).nullable().optional(),
});

const SingleAnswerInput = z.object({
  assessmentId: z.string().min(1).optional(),
  questionCode: z.string().min(1),
  answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
  notes: z.string().max(2000).nullable().optional(),
});

const CompleteInput = z.object({
  assessmentId: z.string().min(1),
  answers: z.array(AnswerInput).min(1),
});

export interface AnswerTechQuestionResult {
  ok: true;
  assessmentId: string;
}
export interface AnswerTechQuestionError {
  ok: false;
  error: string;
}

export interface CompleteTechAssessmentResult {
  ok: true;
  assessmentId: string;
  overallScore: number;
  addressedCount: number;
  totalCount: number;
}
export interface CompleteTechAssessmentError {
  ok: false;
  error: string;
}

async function validateQuestionCodes(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const known = await db.techAssessmentQuestion.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const knownSet = new Set(known.map((q) => q.code));
  const bad = codes.filter((c) => !knownSet.has(c));
  if (bad.length > 0) {
    throw new Error(
      `Unknown Tech Assessment question codes: ${bad.join(", ")}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 PR 4 — granular Tech Assessment answer save.
//
// The 35q wizard saves on every radio change / notes blur via an 800ms
// debounced call to this action. The wizard pre-allocates a client-side
// UUID on mount and supplies it on every save (C2 fix from PR 3); the
// projection's create-on-missing path materialises a fresh draft on the
// first event, then upserts the answer row on subsequent calls.
// ─────────────────────────────────────────────────────────────────────────────

export async function answerTechQuestionAction(
  input: z.infer<typeof SingleAnswerInput>,
): Promise<AnswerTechQuestionResult | AnswerTechQuestionError> {
  try {
    const user = await requireUser();
    // Tech Assessment promotes a draft into a completed assessment via
    // completeTechAssessmentAction without re-auth; STAFF-authored
    // drafts would bypass the OWNER/ADMIN gate. Same precedent as the
    // SRA wizard (audit HIPAA C-2).
    const pu = await requireRole("ADMIN");
    const parsed = SingleAnswerInput.parse(input);

    await validateQuestionCodes([parsed.questionCode]);

    // IDOR guard: when the wizard supplies an assessmentId that already
    // exists, verify the draft belongs to the caller's practice BEFORE
    // emitting the event. Defense-in-depth — the projection also checks
    // this via assertProjectionPracticeOwned. The C2 wizard fix means
    // the FIRST save's UUID has no row yet — that's fine; the
    // projection's create-on-missing path materialises the draft tied
    // to the caller's practice.
    let assessmentId = parsed.assessmentId;
    if (assessmentId) {
      const existing = await db.techAssessment.findUnique({
        where: { id: assessmentId },
        select: { practiceId: true, isDraft: true, completedAt: true },
      });
      if (existing && existing.practiceId !== pu.practiceId) {
        return { ok: false, error: "Assessment not found" };
      }
      if (existing && (!existing.isDraft || existing.completedAt !== null)) {
        return {
          ok: false,
          error: "Assessment already submitted; start a new Tech Assessment",
        };
      }
      // existing === null is OK here — projection will create the row.
    } else {
      // Legacy path (caller didn't supply an id) — mint one now so the
      // projection's create-on-missing branch fires.
      assessmentId = randomUUID();
    }

    const payload = {
      assessmentId,
      questionCode: parsed.questionCode,
      answer: parsed.answer,
      notes: parsed.notes ?? null,
    };

    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "TECH_ASSESSMENT_QUESTION_ANSWERED",
        payload,
      },
      async (tx) =>
        projectTechAssessmentQuestionAnswered(tx, {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          payload,
        }),
    );

    revalidatePath("/programs/tech-assessment");

    return { ok: true, assessmentId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 PR 4 — Tech Assessment submit.
//
// Promotes the draft to completed, computes the weighted 0-100 score
// from each answer's riskWeight via the shared computeSraScore helper
// (Tech Assessment reuses SraAnswer + the same scoring formula).
// ─────────────────────────────────────────────────────────────────────────────

export async function completeTechAssessmentAction(
  input: z.infer<typeof CompleteInput>,
): Promise<CompleteTechAssessmentResult | CompleteTechAssessmentError> {
  try {
    const user = await requireUser();
    const pu = await requireRole("ADMIN");
    const parsed = CompleteInput.parse(input);

    await validateQuestionCodes(parsed.answers.map((a) => a.questionCode));

    // Verify ownership + not-already-submitted before emitting the
    // submit event. The projection enforces both again, but a fast-path
    // rejection here gives the wizard a clean ok=false response instead
    // of a thrown error from inside the transaction.
    const existing = await db.techAssessment.findUnique({
      where: { id: parsed.assessmentId },
      select: { practiceId: true, isDraft: true, completedAt: true },
    });
    if (existing) {
      if (existing.practiceId !== pu.practiceId) {
        return { ok: false, error: "Assessment not found" };
      }
      if (!existing.isDraft || existing.completedAt !== null) {
        return { ok: false, error: "Assessment already submitted" };
      }
    }
    // existing === null is OK — first answer-then-submit path; the
    // QUESTION_ANSWERED loop below materialises the draft.

    // Resolve riskWeight per code so we can score.
    const codes = parsed.answers.map((a) => a.questionCode);
    const questions = await db.techAssessmentQuestion.findMany({
      where: { code: { in: codes } },
      select: { code: true, riskWeight: true },
    });
    const weightByCode = new Map<string, RiskWeight>(
      questions.map((q) => [q.code, q.riskWeight as RiskWeight]),
    );
    const flat = parsed.answers.map((a) => ({
      questionCode: a.questionCode,
      answer: a.answer,
      riskWeight: weightByCode.get(a.questionCode) ?? ("MEDIUM" as RiskWeight),
    }));
    const score = computeSraScore(flat);

    // Save every answer (idempotent — projection upserts). This covers
    // the rare case where the caller submits without ever having
    // round-tripped through answerTechQuestionAction (e.g. headless
    // batch import) and ensures the answers in the DB match the score
    // we're stamping below.
    for (const a of parsed.answers) {
      const answerPayload = {
        assessmentId: parsed.assessmentId,
        questionCode: a.questionCode,
        answer: a.answer,
        notes: a.notes ?? null,
      };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "TECH_ASSESSMENT_QUESTION_ANSWERED",
          payload: answerPayload,
        },
        async (tx) =>
          projectTechAssessmentQuestionAnswered(tx, {
            practiceId: pu.practiceId,
            actorUserId: user.id,
            payload: answerPayload,
          }),
      );
    }

    // Promote to completed.
    const submittedPayload = {
      assessmentId: parsed.assessmentId,
      overallScore: score.overallScore,
      addressedCount: score.addressedCount,
      totalCount: score.totalCount,
    };
    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "TECH_ASSESSMENT_SUBMITTED",
        payload: submittedPayload,
      },
      async (tx) =>
        projectTechAssessmentSubmitted(tx, {
          practiceId: pu.practiceId,
          payload: submittedPayload,
        }),
    );

    revalidatePath("/programs/tech-assessment");
    revalidatePath(`/programs/tech-assessment/${parsed.assessmentId}`);

    return {
      ok: true,
      assessmentId: parsed.assessmentId,
      overallScore: score.overallScore,
      addressedCount: score.addressedCount,
      totalCount: score.totalCount,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
