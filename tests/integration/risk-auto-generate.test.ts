// tests/integration/risk-auto-generate.test.ts
//
// Phase 5 PR 5 — end-to-end coverage that submitting an SRA or Tech
// Assessment auto-creates RiskItem rows for every NO/PARTIAL answer.
// Verifies the (assessmentId, questionCode) unique constraint dedupes
// on replay.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import { projectSraSubmitted } from "@/lib/events/projections/sraSubmitted";
import { projectTechAssessmentQuestionAnswered } from "@/lib/events/projections/techAssessmentQuestionAnswered";
import { projectTechAssessmentSubmitted } from "@/lib/events/projections/techAssessmentSubmitted";

async function seedPracticeWithUser() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Risk Auto-Gen Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function ensureSeedSra() {
  const count = await db.sraQuestion.count();
  if (count < 5) {
    throw new Error("SRA questions missing — run db:seed:sra");
  }
}

async function ensureSeedTech() {
  const count = await db.techAssessmentQuestion.count();
  if (count < 5) {
    // tests/setup.ts wipes techAssessmentQuestion in beforeAll; seed
    // the minimum here so the tests can run independently.
    await db.techAssessmentQuestion.create({
      data: {
        code: "TA_TEST_HIGH",
        category: "NETWORK",
        title: "Has the practice deployed a NGFW with intrusion prevention?",
        description: "Next-gen firewall with active IPS subscriptions",
        riskWeight: "HIGH",
        sortOrder: 1,
      },
    });
    await db.techAssessmentQuestion.create({
      data: {
        code: "TA_TEST_MED",
        category: "ENDPOINT",
        title: "Endpoint detection + response (EDR) on every workstation?",
        description: "Modern EDR/AV with central management console",
        riskWeight: "MEDIUM",
        sortOrder: 2,
      },
    });
  }
}

describe("SRA_SUBMITTED → auto-RiskItem creation", () => {
  it("creates a RiskItem for every NO/PARTIAL answer", async () => {
    await ensureSeedSra();
    const { user, practice } = await seedPracticeWithUser();
    const questions = await db.sraQuestion.findMany({
      orderBy: { sortOrder: "asc" },
      take: 4,
    });
    if (questions.length < 4) throw new Error("need 4 seed questions");
    const codes = questions.map((q) => q.code);

    // Step 1: SRA_COMPLETED to materialise the assessment + answer rows.
    const assessmentId = randomUUID();
    const completedPayload = {
      assessmentId,
      completedByUserId: user.id,
      overallScore: 50,
      addressedCount: 2,
      totalCount: 4,
      answers: [
        { questionCode: codes[0]!, answer: "YES" as const, notes: null },
        { questionCode: codes[1]!, answer: "NO" as const, notes: null },
        { questionCode: codes[2]!, answer: "PARTIAL" as const, notes: null },
        { questionCode: codes[3]!, answer: "NA" as const, notes: null },
      ],
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

    // Step 2: SRA_SUBMITTED — auto-RiskItem creation.
    const submittedPayload = {
      assessmentId,
      overallScore: 50,
      addressedCount: 2,
      totalCount: 4,
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

    // 2 risk items: one for the NO answer, one for the PARTIAL.
    const risks = await db.riskItem.findMany({
      where: { practiceId: practice.id, source: "SRA" },
      orderBy: { sourceCode: "asc" },
    });
    expect(risks).toHaveLength(2);
    const codesGenerated = risks.map((r) => r.sourceCode).sort();
    expect(codesGenerated).toEqual([codes[1], codes[2]].sort());
    expect(risks.every((r) => r.sourceRefId === assessmentId)).toBe(true);
    expect(risks.every((r) => r.status === "OPEN")).toBe(true);
  });

  it("replay (resubmit same assessment) does NOT create duplicate RiskItem rows", async () => {
    await ensureSeedSra();
    const { user, practice } = await seedPracticeWithUser();
    const questions = await db.sraQuestion.findMany({
      orderBy: { sortOrder: "asc" },
      take: 2,
    });
    const codes = questions.map((q) => q.code);

    const assessmentId = randomUUID();
    const completedPayload = {
      assessmentId,
      completedByUserId: user.id,
      overallScore: 50,
      addressedCount: 1,
      totalCount: 2,
      answers: [
        { questionCode: codes[0]!, answer: "YES" as const, notes: null },
        { questionCode: codes[1]!, answer: "NO" as const, notes: null },
      ],
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

    const submittedPayload = {
      assessmentId,
      overallScore: 50,
      addressedCount: 1,
      totalCount: 2,
    };

    // Fire SRA_SUBMITTED twice.
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

    const risks = await db.riskItem.findMany({
      where: { practiceId: practice.id, source: "SRA" },
    });
    // Still 1 — skipDuplicates dedupes on the (practiceId, source,
    // sourceCode, sourceRefId) unique index.
    expect(risks).toHaveLength(1);
    expect(risks[0]!.sourceCode).toBe(codes[1]);
  });
});

describe("TECH_ASSESSMENT_SUBMITTED → auto-RiskItem creation", () => {
  it("creates a RiskItem for every NO/PARTIAL answer + flips draft to completed", async () => {
    await ensureSeedTech();
    const { user, practice } = await seedPracticeWithUser();
    const questions = await db.techAssessmentQuestion.findMany({
      orderBy: { sortOrder: "asc" },
      take: 2,
    });
    if (questions.length < 2) {
      throw new Error("need 2 tech questions");
    }
    const codes = questions.map((q) => q.code);
    const assessmentId = randomUUID();

    // Step 1: emit TECH_ASSESSMENT_QUESTION_ANSWERED for both questions
    // so the draft + answer rows materialise.
    for (const [i, code] of codes.entries()) {
      const answer: "NO" | "PARTIAL" = i === 0 ? "NO" : "PARTIAL";
      const answerPayload = {
        assessmentId,
        questionCode: code,
        answer,
        notes: null,
      };
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "TECH_ASSESSMENT_QUESTION_ANSWERED",
          payload: answerPayload,
        },
        async (tx) =>
          projectTechAssessmentQuestionAnswered(tx, {
            practiceId: practice.id,
            actorUserId: user.id,
            payload: answerPayload,
          }),
      );
    }

    // Verify draft exists and is in the right state.
    const before = await db.techAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    expect(before.isDraft).toBe(true);
    expect(before.completedAt).toBeNull();

    // Step 2: TECH_ASSESSMENT_SUBMITTED — auto-RiskItem creation +
    // draft promotion.
    const submittedPayload = {
      assessmentId,
      overallScore: 0,
      addressedCount: 0,
      totalCount: 2,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "TECH_ASSESSMENT_SUBMITTED",
        payload: submittedPayload,
      },
      async (tx) =>
        projectTechAssessmentSubmitted(tx, {
          practiceId: practice.id,
          payload: submittedPayload,
        }),
    );

    // Draft promoted to completed.
    const after = await db.techAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    });
    expect(after.isDraft).toBe(false);
    expect(after.completedAt).toBeInstanceOf(Date);

    // 2 risk items: NO + PARTIAL.
    const risks = await db.riskItem.findMany({
      where: { practiceId: practice.id, source: "TECHNICAL_ASSESSMENT" },
      orderBy: { sourceCode: "asc" },
    });
    expect(risks).toHaveLength(2);
    expect(risks.map((r) => r.sourceCode).sort()).toEqual(codes.sort());
    // NO + HIGH weight => HIGH; PARTIAL + MEDIUM => LOW.
    const byCode = new Map(risks.map((r) => [r.sourceCode, r]));
    expect(byCode.get(codes[0]!)?.severity).toBe("HIGH"); // NO + HIGH
    expect(byCode.get(codes[1]!)?.severity).toBe("LOW"); // PARTIAL + MEDIUM
  });
});
