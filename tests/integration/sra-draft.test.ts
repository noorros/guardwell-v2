// tests/integration/sra-draft.test.ts
//
// End-to-end for the SRA save-as-you-go lifecycle:
//   draft created → draft resumed + updated → SRA_COMPLETED promotes
//   draft → HIPAA_SRA flips COMPLIANT.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectSraDraftSaved } from "@/lib/events/projections/sraDraftSaved";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";

async function seed(): Promise<{ practiceId: string; userId: string }> {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `sra-draft-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "SRA Draft Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  // Asset-inventory gate: HIPAA_SRA derivation now requires ≥1 PHI
  // asset on file. Seed one so the rule isn't tripped on the gate.
  await db.techAsset.create({
    data: {
      practiceId: practice.id,
      name: "Test EHR",
      assetType: "EMR",
      processesPhi: true,
      encryption: "FULL_DISK",
    },
  });

  // Seed HIPAA framework + the SRA requirement + one SraQuestion so the
  // derivation + projection have something to hit. This mirrors the
  // existing sra-completion.test.ts fixture shape.
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "Health Insurance Portability and Accountability Act",
      jurisdiction: "federal",
      weightDefault: 0.3,
      scoringStrategy: "STANDARD_CHECKLIST",
      sortOrder: 10,
    },
  });
  await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "HIPAA_SRA",
      },
    },
    update: { acceptedEvidenceTypes: ["SRA_COMPLETED"] },
    create: {
      frameworkId: framework.id,
      code: "HIPAA_SRA",
      title: "Security Risk Assessment",
      severity: "CRITICAL",
      weight: 2,
      description: "Annual HIPAA SRA per §164.308(a)(1)(ii)(A).",
      acceptedEvidenceTypes: ["SRA_COMPLETED"],
      sortOrder: 1,
    },
  });
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });

  await db.sraQuestion.upsert({
    where: { code: "DRAFT_TEST_Q" },
    update: {},
    create: {
      code: "DRAFT_TEST_Q",
      category: "ADMINISTRATIVE",
      subcategory: "Security Management Process",
      title: "Test question",
      description: "Draft lifecycle smoke test.",
      lookFor: [],
      sortOrder: 1,
    },
  });

  return { practiceId: practice.id, userId: user.id };
}

describe("SRA draft lifecycle", () => {
  // No explicit cleanup needed — the global afterEach in tests/setup.ts
  // wipes practices, which cascades to PracticeSraAssessment and its
  // answers via onDelete: Cascade. Our own DRAFT_TEST_Q question is
  // upserted so re-runs are safe; we don't remove it because other test
  // files depend on the seeded SraQuestion rows staying intact.

  it("SRA_DRAFT_SAVED creates a draft row with isDraft=true + completedAt=null", async () => {
    const { practiceId, userId } = await seed();
    const assessmentId = "draft-assessment-1";

    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_DRAFT_SAVED",
        payload: {
          assessmentId,
          currentStep: 0,
          answers: [{ questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null }],
        },
      },
      async (tx) =>
        projectSraDraftSaved(tx, {
          practiceId,
          actorUserId: userId,
          payload: {
            assessmentId,
            currentStep: 0,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null },
            ],
          },
        }),
    );

    const assessment = await db.practiceSraAssessment.findUnique({
      where: { id: assessmentId },
      include: { answers: true },
    });
    expect(assessment).not.toBeNull();
    expect(assessment!.isDraft).toBe(true);
    expect(assessment!.completedAt).toBeNull();
    expect(assessment!.currentStep).toBe(0);
    expect(assessment!.answers).toHaveLength(1);
    expect(assessment!.addressedCount).toBe(1);
    expect(assessment!.totalCount).toBe(1);

    // HIPAA_SRA must still be NOT_STARTED / GAP since the draft doesn't
    // count toward the derivation rule.
    const item = await db.complianceItem.findFirst({
      where: {
        practiceId,
        requirement: { code: "HIPAA_SRA" },
      },
    });
    expect(item?.status).not.toBe("COMPLIANT");
  });

  it("successive SRA_DRAFT_SAVED events overwrite the answer set (idempotent by assessmentId)", async () => {
    const { practiceId, userId } = await seed();
    const assessmentId = "draft-assessment-2";

    // Save draft with YES
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_DRAFT_SAVED",
        payload: {
          assessmentId,
          currentStep: 0,
          answers: [{ questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null }],
        },
      },
      async (tx) =>
        projectSraDraftSaved(tx, {
          practiceId,
          actorUserId: userId,
          payload: {
            assessmentId,
            currentStep: 0,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null },
            ],
          },
        }),
    );

    // Save again with NO (user changed their mind) + step bump
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_DRAFT_SAVED",
        payload: {
          assessmentId,
          currentStep: 1,
          answers: [
            { questionCode: "DRAFT_TEST_Q", answer: "NO", notes: "second thought" },
          ],
        },
      },
      async (tx) =>
        projectSraDraftSaved(tx, {
          practiceId,
          actorUserId: userId,
          payload: {
            assessmentId,
            currentStep: 1,
            answers: [
              {
                questionCode: "DRAFT_TEST_Q",
                answer: "NO",
                notes: "second thought",
              },
            ],
          },
        }),
    );

    const assessments = await db.practiceSraAssessment.findMany({
      where: { id: assessmentId },
      include: { answers: true },
    });
    expect(assessments).toHaveLength(1);
    const a = assessments[0]!;
    expect(a.currentStep).toBe(1);
    expect(a.answers).toHaveLength(1);
    expect(a.answers[0]!.answer).toBe("NO");
    expect(a.answers[0]!.notes).toBe("second thought");
    expect(a.addressedCount).toBe(0); // NO doesn't count
  });

  it("SRA_COMPLETED with existing draft id promotes the draft + flips HIPAA_SRA", async () => {
    const { practiceId, userId } = await seed();
    const assessmentId = "draft-assessment-3";

    // Draft first
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_DRAFT_SAVED",
        payload: {
          assessmentId,
          currentStep: 0,
          answers: [{ questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null }],
        },
      },
      async (tx) =>
        projectSraDraftSaved(tx, {
          practiceId,
          actorUserId: userId,
          payload: {
            assessmentId,
            currentStep: 0,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null },
            ],
          },
        }),
    );

    // Promote with same assessmentId
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_COMPLETED",
        payload: {
          assessmentId,
          completedByUserId: userId,
          overallScore: 100,
          addressedCount: 1,
          totalCount: 1,
          answers: [{ questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null }],
        },
      },
      async (tx) =>
        projectSraCompleted(tx, {
          practiceId,
          payload: {
            assessmentId,
            completedByUserId: userId,
            overallScore: 100,
            addressedCount: 1,
            totalCount: 1,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null },
            ],
          },
        }),
    );

    // Still one row, now completed
    const rows = await db.practiceSraAssessment.findMany({
      where: { practiceId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isDraft).toBe(false);
    expect(rows[0]!.completedAt).not.toBeNull();

    // HIPAA_SRA flipped COMPLIANT
    const item = await db.complianceItem.findFirst({
      where: { practiceId, requirement: { code: "HIPAA_SRA" } },
    });
    expect(item?.status).toBe("COMPLIANT");
  });

  it("SRA_DRAFT_SAVED on an already-completed assessment is rejected", async () => {
    const { practiceId, userId } = await seed();
    const assessmentId = "draft-assessment-4";

    // Complete straight away
    await appendEventAndApply(
      {
        practiceId,
        actorUserId: userId,
        type: "SRA_COMPLETED",
        payload: {
          assessmentId,
          completedByUserId: userId,
          overallScore: 100,
          addressedCount: 1,
          totalCount: 1,
          answers: [{ questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null }],
        },
      },
      async (tx) =>
        projectSraCompleted(tx, {
          practiceId,
          payload: {
            assessmentId,
            completedByUserId: userId,
            overallScore: 100,
            addressedCount: 1,
            totalCount: 1,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "YES", notes: null },
            ],
          },
        }),
    );

    // Attempt to "re-draft" that same id — must throw
    await expect(
      appendEventAndApply(
        {
          practiceId,
          actorUserId: userId,
          type: "SRA_DRAFT_SAVED",
          payload: {
            assessmentId,
            currentStep: 1,
            answers: [
              { questionCode: "DRAFT_TEST_Q", answer: "NO", notes: null },
            ],
          },
        },
        async (tx) =>
          projectSraDraftSaved(tx, {
            practiceId,
            actorUserId: userId,
            payload: {
              assessmentId,
              currentStep: 1,
              answers: [
                { questionCode: "DRAFT_TEST_Q", answer: "NO", notes: null },
              ],
            },
          }),
      ),
    ).rejects.toThrow(/already completed/);
  });
});
