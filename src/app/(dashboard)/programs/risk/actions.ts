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
import { projectSraQuestionAnswered } from "@/lib/events/projections/sraQuestionAnswered";
import { projectSraSubmitted } from "@/lib/events/projections/sraSubmitted";
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

  // Phase 5 — also emit SRA_SUBMITTED with the same totals so new
  // projections (auto-RiskItem creation in PR 5) can listen to one
  // event without re-processing the legacy SRA_COMPLETED schema. The
  // SRA_SUBMITTED projection is currently a no-op; SRA_COMPLETED is
  // still the source of truth for flipping isDraft + rederiving HIPAA_SRA.
  const submittedPayload = {
    assessmentId,
    overallScore,
    addressedCount,
    totalCount,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "SRA_SUBMITTED",
      payload: submittedPayload,
    },
    async (tx) =>
      projectSraSubmitted(tx, {
        practiceId: pu.practiceId,
        payload: submittedPayload,
      }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — granular SRA answer save.
//
// The new 80q wizard saves on every radio change / notes blur via an
// 800ms debounced call to this action. The first call (when no
// assessmentId is supplied) materialises a fresh draft via the
// projection's create-on-missing path and returns the new id; the
// wizard then sends subsequent answers with that id.
//
// SRA_QUESTION_ANSWERED replaces the all-or-nothing SRA_DRAFT_SAVED for
// partial-save support. SRA_DRAFT_SAVED is kept supported (legacy
// SraWizard tests still drive it; the registry still exposes it) but
// new wizard code should prefer this action.
// ─────────────────────────────────────────────────────────────────────────────

const SingleAnswerInput = z.object({
  assessmentId: z.string().min(1).optional(),
  questionCode: z.string().min(1),
  answer: z.enum(["YES", "NO", "PARTIAL", "NA"]),
  notes: z.string().max(2000).nullable().optional(),
});

export interface AnswerSraQuestionResult {
  ok: true;
  assessmentId: string;
}
export interface AnswerSraQuestionError {
  ok: false;
  error: string;
}

export async function answerSraQuestionAction(
  input: z.infer<typeof SingleAnswerInput>,
): Promise<AnswerSraQuestionResult | AnswerSraQuestionError> {
  try {
    const user = await requireUser();
    // Audit HIPAA C-2: same gate as completeSraAction +
    // saveSraDraftAction — granular saves materialise a draft that the
    // wizard later promotes via completeSraAction; STAFF-authored
    // drafts would bypass the OWNER/ADMIN role check.
    const pu = await requireRole("ADMIN");
    const parsed = SingleAnswerInput.parse(input);

    await validateQuestionCodes([parsed.questionCode]);

    // IDOR guard: when the wizard is resuming an existing draft, verify
    // the draft belongs to the caller's practice BEFORE emitting the
    // event. Defense-in-depth — the projection also checks this via
    // assertProjectionPracticeOwned.
    let assessmentId = parsed.assessmentId;
    if (assessmentId) {
      const existing = await db.practiceSraAssessment.findUnique({
        where: { id: assessmentId },
        select: { practiceId: true, isDraft: true },
      });
      if (!existing || existing.practiceId !== pu.practiceId) {
        return { ok: false, error: "Assessment not found" };
      }
      if (!existing.isDraft) {
        return {
          ok: false,
          error: "Assessment already submitted; start a new SRA",
        };
      }
    } else {
      // First answer in a brand-new draft. The projection's
      // create-on-missing path will materialise the row.
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
        type: "SRA_QUESTION_ANSWERED",
        payload,
      },
      async (tx) =>
        projectSraQuestionAnswered(tx, {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          payload,
        }),
    );

    revalidatePath("/programs/risk");

    return { ok: true, assessmentId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
