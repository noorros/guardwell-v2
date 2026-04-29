// tests/integration/projection-cross-tenant-guards.test.ts
//
// Audit C-1 cross-area sweep (HIPAA + Credentials + Allergy code reviews,
// 2026-04-29): projections that upsert/update on a globally-unique cuid
// must verify the existing row belongs to the caller's practiceId BEFORE
// mutating. Without this check, a forged event payload can mutate
// another tenant's data.
//
// Reference guard pattern: `src/lib/events/projections/sraDraftSaved.ts:52`
// (HIPAA — only projection that already had the check).
//
// Each test seeds Practice A and Practice B, creates a row owned by B,
// then asserts that a projection call carrying Practice A's practiceId +
// B's row id is REFUSED with a "different practice" error. ADR-0001
// expects projection-level safety because future cron / batch / backfill
// paths emit events outside the action layer.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import {
  projectCredentialUpserted,
  projectCredentialRemoved,
  projectCeuActivityLogged,
  projectCeuActivityRemoved,
  projectCredentialReminderConfigUpdated,
} from "@/lib/events/projections/credential";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
} from "@/lib/events/projections/allergyCompetency";
import { randomUUID } from "node:crypto";

async function seedTwoPractices() {
  const userA = await db.user.create({
    data: {
      firebaseUid: `xt-a-${Math.random().toString(36).slice(2, 10)}`,
      email: `xt-a-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const userB = await db.user.create({
    data: {
      firebaseUid: `xt-b-${Math.random().toString(36).slice(2, 10)}`,
      email: `xt-b-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practiceA = await db.practice.create({
    data: { name: "Practice A (xt)", primaryState: "AZ" },
  });
  const practiceB = await db.practice.create({
    data: { name: "Practice B (xt)", primaryState: "AZ" },
  });
  const puA = await db.practiceUser.create({
    data: { userId: userA.id, practiceId: practiceA.id, role: "OWNER" },
  });
  const puB = await db.practiceUser.create({
    data: { userId: userB.id, practiceId: practiceB.id, role: "OWNER" },
  });
  return { userA, userB, practiceA, practiceB, puA, puB };
}

async function seedSraQuestion() {
  await db.sraQuestion.upsert({
    where: { code: "XT_GUARD_Q" },
    update: {},
    create: {
      code: "XT_GUARD_Q",
      category: "ADMINISTRATIVE",
      subcategory: "Cross-tenant",
      title: "Cross-tenant guard test question",
      description: "Used by projection-cross-tenant-guards.test.ts.",
      lookFor: [],
      sortOrder: 999,
    },
  });
}

async function seedCredentialType(code: string) {
  return db.credentialType.upsert({
    where: { code },
    update: {},
    create: {
      code,
      category: "CLINICAL_LICENSE",
      name: code,
    },
  });
}

describe("projection cross-tenant guards (audit C-1)", () => {
  it("projectSraCompleted refuses a forged practiceId", async () => {
    await seedSraQuestion();
    const { practiceA, practiceB, puB } = await seedTwoPractices();
    const assessmentId = `xt-sra-${randomUUID()}`;

    // Seed an assessment owned by Practice B.
    await db.practiceSraAssessment.create({
      data: {
        id: assessmentId,
        practiceId: practiceB.id,
        completedByUserId: puB.userId,
        completedAt: new Date(),
        overallScore: 80,
        addressedCount: 1,
        totalCount: 1,
        isDraft: false,
      },
    });

    // Practice A tries to project a "completion" against B's assessmentId.
    await expect(
      projectSraCompleted(db as never, {
        practiceId: practiceA.id,
        payload: {
          assessmentId,
          completedByUserId: puB.userId,
          overallScore: 100,
          addressedCount: 1,
          totalCount: 1,
          answers: [{ questionCode: "XT_GUARD_Q", answer: "YES", notes: null }],
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCredentialUpserted refuses a forged practiceId", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await seedCredentialType(
      `XT_CRED_TYPE_${Math.random().toString(36).slice(2, 8)}`,
    );
    const credentialId = `xt-cred-${randomUUID()}`;
    await db.credential.create({
      data: {
        id: credentialId,
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });

    await expect(
      projectCredentialUpserted(db as never, {
        practiceId: practiceA.id,
        payload: {
          credentialId,
          credentialTypeCode: credType.code,
          title: "Pwned by A",
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCredentialRemoved refuses a forged practiceId", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await seedCredentialType(
      `XT_CRED_TYPE2_${Math.random().toString(36).slice(2, 8)}`,
    );
    const credentialId = `xt-cred-rm-${randomUUID()}`;
    await db.credential.create({
      data: {
        id: credentialId,
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });

    await expect(
      projectCredentialRemoved(db as never, {
        practiceId: practiceA.id,
        payload: { credentialId },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCeuActivityLogged refuses creating a CEU against another practice's credential", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await seedCredentialType(
      `XT_CRED_TYPE3_${Math.random().toString(36).slice(2, 8)}`,
    );
    const credentialId = `xt-cred-ceu-${randomUUID()}`;
    await db.credential.create({
      data: {
        id: credentialId,
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });

    await expect(
      projectCeuActivityLogged(db as never, {
        practiceId: practiceA.id,
        payload: {
          ceuActivityId: `xt-ceu-${randomUUID()}`,
          credentialId,
          activityName: "Pwned",
          activityDate: new Date().toISOString(),
          hoursAwarded: 1,
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCeuActivityRemoved refuses retiring another practice's CEU activity", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await seedCredentialType(
      `XT_CRED_TYPE4_${Math.random().toString(36).slice(2, 8)}`,
    );
    const credentialId = `xt-cred-${randomUUID()}`;
    await db.credential.create({
      data: {
        id: credentialId,
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });
    const ceuActivityId = `xt-ceu-rm-${randomUUID()}`;
    await db.ceuActivity.create({
      data: {
        id: ceuActivityId,
        practiceId: practiceB.id,
        credentialId,
        activityName: "B's CEU",
        activityDate: new Date(),
        hoursAwarded: 1,
      },
    });

    await expect(
      projectCeuActivityRemoved(db as never, {
        practiceId: practiceA.id,
        payload: { ceuActivityId },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCredentialReminderConfigUpdated refuses configuring another practice's credential", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await seedCredentialType(
      `XT_CRED_TYPE5_${Math.random().toString(36).slice(2, 8)}`,
    );
    const credentialId = `xt-cred-reminder-${randomUUID()}`;
    await db.credential.create({
      data: {
        id: credentialId,
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });

    await expect(
      projectCredentialReminderConfigUpdated(db as never, {
        practiceId: practiceA.id,
        payload: {
          configId: `xt-rc-${randomUUID()}`,
          credentialId,
          enabled: true,
          milestoneDays: [90, 60, 30, 7],
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyEquipmentCheckLogged refuses overwriting another practice's check", async () => {
    const { practiceA, practiceB, puB } = await seedTwoPractices();
    const equipmentCheckId = `xt-eq-${randomUUID()}`;
    await db.allergyEquipmentCheck.create({
      data: {
        id: equipmentCheckId,
        practiceId: practiceB.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedById: puB.id,
        checkedAt: new Date(),
        temperatureC: 4.5,
      },
    });

    await expect(
      projectAllergyEquipmentCheckLogged(db as never, {
        practiceId: practiceA.id,
        payload: {
          equipmentCheckId,
          checkType: "REFRIGERATOR_TEMP",
          checkedByUserId: puB.id,
          checkedAt: new Date().toISOString(),
          temperatureC: 99,
          notes: "pwned",
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyDrillLogged refuses overwriting another practice's drill", async () => {
    const { practiceA, practiceB, puB } = await seedTwoPractices();
    const drillId = `xt-drill-${randomUUID()}`;
    await db.allergyDrill.create({
      data: {
        id: drillId,
        practiceId: practiceB.id,
        conductedById: puB.id,
        conductedAt: new Date(),
        scenario: "B's drill",
        participantIds: [puB.id],
      },
    });

    await expect(
      projectAllergyDrillLogged(db as never, {
        practiceId: practiceA.id,
        payload: {
          drillId,
          conductedByUserId: puB.id,
          conductedAt: new Date().toISOString(),
          scenario: "Pwned",
          participantIds: [puB.id],
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyQuizCompleted refuses an event for another practice's compounder", async () => {
    const { practiceA, practiceB, puB } = await seedTwoPractices();

    await expect(
      projectAllergyQuizCompleted(db as never, {
        practiceId: practiceA.id,
        payload: {
          attemptId: `xt-quiz-${randomUUID()}`,
          practiceUserId: puB.id, // B's compounder, A's practice
          year: new Date().getFullYear(),
          score: 100,
          passed: true,
          correctAnswers: 1,
          totalQuestions: 1,
          answers: [],
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyFingertipTestPassed refuses an event for another practice's compounder", async () => {
    const { practiceA, practiceB, puA, puB } = await seedTwoPractices();
    void practiceB;

    await expect(
      projectAllergyFingertipTestPassed(db as never, {
        practiceId: practiceA.id,
        payload: {
          practiceUserId: puB.id, // B's compounder, A's practice
          year: new Date().getFullYear(),
          attestedByUserId: puA.id,
          notes: null,
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyMediaFillPassed refuses an event for another practice's compounder", async () => {
    const { practiceA, practiceB, puA, puB } = await seedTwoPractices();
    void practiceB;

    await expect(
      projectAllergyMediaFillPassed(db as never, {
        practiceId: practiceA.id,
        payload: {
          practiceUserId: puB.id, // B's compounder, A's practice
          year: new Date().getFullYear(),
          attestedByUserId: puA.id,
          notes: null,
        },
      }),
    ).rejects.toThrow(/different practice/i);
  });
});
