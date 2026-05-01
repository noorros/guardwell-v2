// tests/integration/sra-completion.test.ts
//
// End-to-end: emit SRA_COMPLETED with a full answers payload, assert
// PracticeSraAssessment + answers are persisted, HIPAA_SRA flips to
// COMPLIANT, and expiry after 365 days returns it to GAP.
//
// Phase 5 PR 7 — also pins that the legacy hipaaSraRule still flips to
// COMPLIANT when an SRA is finalized via the NEW Phase 5 wizard event
// sequence (SRA_QUESTION_ANSWERED * N -> SRA_COMPLETED -> SRA_SUBMITTED),
// not just the legacy single-shot SRA_COMPLETED path.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import { projectSraQuestionAnswered } from "@/lib/events/projections/sraQuestionAnswered";
import { projectSraSubmitted } from "@/lib/events/projections/sraSubmitted";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

async function triggerRederive(practiceId: string) {
  await db.$transaction(async (tx) => {
    await rederiveRequirementStatus(tx, practiceId, "SRA_COMPLETED");
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithSra() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  // The HIPAA_SRA derivation rule now requires ≥1 PHI-processing
  // TechAsset on file (asset-inventory gate). Seed one so the rule's
  // asset gate isn't the test's failure mode.
  await db.techAsset.create({
    data: {
      practiceId: practice.id,
      name: "Test EHR",
      assetType: "EMR",
      processesPhi: true,
      encryption: "FULL_DISK",
    },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "HIPAA" },
    include: { requirements: true },
  });
  const sraReq = framework.requirements.find((r) => r.code === "HIPAA_SRA");
  if (!sraReq) throw new Error("HIPAA_SRA missing — run db:seed:hipaa");
  const questions = await db.sraQuestion.findMany({
    orderBy: { sortOrder: "asc" },
  });
  if (questions.length < 5) {
    throw new Error("SRA questions missing — run db:seed:sra");
  }
  return { user, practice, sraReq, questions };
}

type Answer = "YES" | "NO" | "PARTIAL" | "NA";

async function completeSra(
  practiceId: string,
  userId: string,
  questionCodes: string[],
  answers: Answer[],
  overrides: { assessmentId?: string; completedAt?: Date } = {},
) {
  if (questionCodes.length !== answers.length) {
    throw new Error("codes and answers must match length");
  }
  const addressedCount = answers.filter((a) => a === "YES" || a === "NA").length;
  const totalCount = answers.length;
  const overallScore = Math.round((addressedCount / totalCount) * 100);

  const assessmentId = overrides.assessmentId ?? randomUUID();
  const payload = {
    assessmentId,
    completedByUserId: userId,
    overallScore,
    addressedCount,
    totalCount,
    answers: questionCodes.map((code, i) => ({
      questionCode: code,
      answer: answers[i]!,
      notes: null,
    })),
  };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "SRA_COMPLETED",
      payload,
    },
    async (tx) => projectSraCompleted(tx, { practiceId, payload }),
  );

  // Optional: backdate the completion for expiry tests.
  if (overrides.completedAt) {
    await db.practiceSraAssessment.update({
      where: { id: assessmentId },
      data: { completedAt: overrides.completedAt },
    });
  }

  return { assessmentId, overallScore, addressedCount, totalCount };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("SRA_COMPLETED → HIPAA_SRA derivation", () => {
  it("completing an SRA creates the assessment + answer rows and flips HIPAA_SRA to COMPLIANT", async () => {
    const { user, practice, sraReq, questions } = await seedPracticeWithSra();
    const codes = questions.slice(0, 5).map((q) => q.code);
    const answers: Answer[] = ["YES", "YES", "YES", "PARTIAL", "NA"];

    const res = await completeSra(practice.id, user.id, codes, answers);

    // Assessment + answers persisted.
    const assessment = await db.practiceSraAssessment.findUniqueOrThrow({
      where: { id: res.assessmentId },
      include: { answers: true },
    });
    expect(assessment.practiceId).toBe(practice.id);
    expect(assessment.completedByUserId).toBe(user.id);
    expect(assessment.overallScore).toBe(80); // 4 addressed / 5 = 80
    expect(assessment.addressedCount).toBe(4);
    expect(assessment.totalCount).toBe(5);
    expect(assessment.answers).toHaveLength(5);

    // Derivation fired.
    expect(await statusOf(practice.id, sraReq.id)).toBe("COMPLIANT");
  });

  it("unknown question code is rejected by the projection", async () => {
    const { user, practice } = await seedPracticeWithSra();
    await expect(
      completeSra(practice.id, user.id, ["NOT_A_REAL_CODE"], ["YES"]),
    ).rejects.toThrow(/Unknown SRA question codes/);
  });

  it("an expired SRA (backdated > 365 days) does NOT satisfy HIPAA_SRA", async () => {
    const { user, practice, sraReq, questions } = await seedPracticeWithSra();
    const codes = questions.slice(0, 3).map((q) => q.code);
    await completeSra(practice.id, user.id, codes, ["YES", "YES", "YES"], {
      completedAt: new Date(Date.now() - 400 * DAY_MS),
    });
    // After backdating the assessment post-projection, trigger a fresh
    // rederive so the rule sees the updated completedAt. (In production
    // this is a non-issue — completedAt is always "now" at event time.)
    await triggerRederive(practice.id);
    expect(await statusOf(practice.id, sraReq.id)).toBe("GAP");
  });

  it("re-running a fresh SRA after expiry flips HIPAA_SRA back to COMPLIANT", async () => {
    const { user, practice, sraReq, questions } = await seedPracticeWithSra();
    const codes = questions.slice(0, 3).map((q) => q.code);

    // Expired SRA.
    await completeSra(practice.id, user.id, codes, ["YES", "YES", "YES"], {
      completedAt: new Date(Date.now() - 400 * DAY_MS),
    });
    await triggerRederive(practice.id);
    expect(await statusOf(practice.id, sraReq.id)).toBe("GAP");

    // Fresh SRA today → COMPLIANT.
    await completeSra(practice.id, user.id, codes, ["YES", "YES", "YES"]);
    expect(await statusOf(practice.id, sraReq.id)).toBe("COMPLIANT");
  });

  it("hipaaSraRule flips HIPAA_SRA to COMPLIANT after the Phase 5 wizard event sequence", async () => {
    // Phase 5 PR 7 regression: Phase 5 PR 1 added 3 columns to
    // SraQuestion (riskWeight + category + addressingControls) and PR 3
    // rewrote the wizard to save granularly via SRA_QUESTION_ANSWERED
    // and finalize via the SRA_COMPLETED + SRA_SUBMITTED pair. The
    // hipaaSraRule reads PracticeSraAssessment.completedAt — unchanged
    // by Phase 5 — so the rule must still flip to COMPLIANT.
    //
    // This test exercises the NEW path end-to-end (granular saves into
    // a draft, then finalize) so a future regression in the projection
    // chain would be caught here, not only in the legacy
    // single-shot-completed test above.
    const { user, practice, sraReq, questions } = await seedPracticeWithSra();
    const codes = questions.slice(0, 3).map((q) => q.code);
    const answers: Answer[] = ["YES", "YES", "PARTIAL"];

    // Step 1 — granular SRA_QUESTION_ANSWERED creates a draft + answer
    // rows lazily (mirrors what answerSraQuestionAction does on each
    // wizard radio change).
    const assessmentId = randomUUID();
    for (const [i, code] of codes.entries()) {
      const answerPayload = {
        assessmentId,
        questionCode: code,
        answer: answers[i]!,
        notes: null,
      };
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "SRA_QUESTION_ANSWERED",
          payload: answerPayload,
        },
        async (tx) =>
          projectSraQuestionAnswered(tx, {
            practiceId: practice.id,
            actorUserId: user.id,
            payload: answerPayload,
          }),
      );
    }

    // Confirm draft state — rule has not been triggered yet because
    // SRA_QUESTION_ANSWERED projects no compliance derivation. Status
    // is NOT_STARTED until the SRA_COMPLETED projection runs.
    const draft = await db.practiceSraAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    expect(draft.isDraft).toBe(true);
    expect(draft.completedAt).toBeNull();
    expect(await statusOf(practice.id, sraReq.id)).toBe("NOT_STARTED");

    // Step 2 — finalize via SRA_COMPLETED. The projection promotes the
    // draft, writes answer rows from the payload (overwriting the
    // granular saves), and rederives HIPAA_SRA in the same transaction.
    const addressedCount = answers.filter(
      (a) => a === "YES" || a === "NA",
    ).length;
    const totalCount = answers.length;
    const overallScore = Math.round((addressedCount / totalCount) * 100);
    const completedPayload = {
      assessmentId,
      completedByUserId: user.id,
      overallScore,
      addressedCount,
      totalCount,
      answers: codes.map((code, i) => ({
        questionCode: code,
        answer: answers[i]!,
        notes: null,
      })),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "SRA_COMPLETED",
        payload: completedPayload,
      },
      async (tx) =>
        projectSraCompleted(tx, {
          practiceId: practice.id,
          payload: completedPayload,
        }),
    );

    // Step 3 — Phase 5 also fires SRA_SUBMITTED for the auto-RiskItem
    // fan-out. This event MUST NOT regress the requirement status; the
    // sraSubmitted projection only creates RiskItem rows.
    const submittedPayload = {
      assessmentId,
      overallScore,
      addressedCount,
      totalCount,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "SRA_SUBMITTED",
        payload: submittedPayload,
      },
      async (tx) =>
        projectSraSubmitted(tx, {
          practiceId: practice.id,
          payload: submittedPayload,
        }),
    );

    // Final state — assessment promoted, rule flipped, RiskItem
    // generated for the PARTIAL answer.
    const finalAssessment = await db.practiceSraAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    expect(finalAssessment.isDraft).toBe(false);
    expect(finalAssessment.completedAt).toBeInstanceOf(Date);
    expect(await statusOf(practice.id, sraReq.id)).toBe("COMPLIANT");
    const risks = await db.riskItem.findMany({
      where: { practiceId: practice.id, source: "SRA" },
    });
    // 1 PARTIAL answer -> 1 RiskItem.
    expect(risks).toHaveLength(1);
    expect(risks[0]!.sourceCode).toBe(codes[2]);
  });
});
