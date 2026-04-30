// tests/integration/projection-cross-tenant-guards.test.ts
//
// Audit C-1 cross-area sweep (HIPAA + Credentials + Allergy code reviews,
// 2026-04-29). Each test seeds Practice A + Practice B, creates a row
// owned by B, then asserts a forged Practice-A call carrying B's row id
// is REFUSED. Projections that exercise an upsert "create" path on a
// brand-new id remain allowed; only an existing row in another practice
// is the attack vector this guard closes.

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
  projectAllergyCompoundingLogged,
  projectAllergyRequirementToggled,
} from "@/lib/events/projections/allergyCompetency";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import {
  projectCredentialUpserted,
  projectCredentialRemoved,
  projectCeuActivityLogged,
  projectCeuActivityRemoved,
  projectCredentialReminderConfigUpdated,
} from "@/lib/events/projections/credential";
import { projectSraCompleted } from "@/lib/events/projections/sraCompleted";
import { projectSraDraftSaved } from "@/lib/events/projections/sraDraftSaved";

interface TwoPracticeSetup {
  practiceA: { id: string };
  practiceB: { id: string };
  practiceBUser: { id: string }; // PracticeUser in B (for allergy practiceUserId guards)
  userA: { id: string };
  userB: { id: string };
}

async function seedTwoPractices(): Promise<TwoPracticeSetup> {
  const userA = await db.user.create({
    data: {
      firebaseUid: `gA-${Math.random().toString(36).slice(2, 10)}`,
      email: `gA-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const userB = await db.user.create({
    data: {
      firebaseUid: `gB-${Math.random().toString(36).slice(2, 10)}`,
      email: `gB-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practiceA = await db.practice.create({
    data: { name: "Guard A Practice", primaryState: "AZ" },
  });
  const practiceB = await db.practice.create({
    data: { name: "Guard B Practice", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: userA.id, practiceId: practiceA.id, role: "OWNER" },
  });
  const practiceBUser = await db.practiceUser.create({
    data: { userId: userB.id, practiceId: practiceB.id, role: "STAFF" },
  });
  return { practiceA, practiceB, practiceBUser, userA, userB };
}

beforeEach(async () => {
  // tests/setup.ts handles full DB cleanup between tests
});

describe("Audit C-1 cross-tenant projection guards", () => {
  // ────────────────────────────────────────────────────────────────────
  // SRA — completed + draft
  // ────────────────────────────────────────────────────────────────────

  it("projectSraCompleted refuses an assessmentId owned by another practice", async () => {
    const { practiceA, practiceB, userB } = await seedTwoPractices();
    // Seed an SRA assessment in Practice B.
    const bAssessment = await db.practiceSraAssessment.create({
      data: {
        practiceId: practiceB.id,
        completedByUserId: userB.id,
        isDraft: true,
        currentStep: 1,
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectSraCompleted(tx, {
          practiceId: practiceA.id,
          payload: {
            assessmentId: bAssessment.id,
            completedByUserId: userB.id,
            overallScore: 100,
            addressedCount: 0,
            totalCount: 0,
            answers: [],
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectSraDraftSaved refuses an assessmentId owned by another practice", async () => {
    const { practiceA, practiceB, userB } = await seedTwoPractices();
    const bAssessment = await db.practiceSraAssessment.create({
      data: {
        practiceId: practiceB.id,
        completedByUserId: userB.id,
        isDraft: true,
        currentStep: 1,
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectSraDraftSaved(tx, {
          practiceId: practiceA.id,
          actorUserId: userB.id,
          payload: {
            assessmentId: bAssessment.id,
            currentStep: 2,
            answers: [],
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // Credentials — 5 sites
  // ────────────────────────────────────────────────────────────────────

  it("projectCredentialUpserted refuses a credentialId owned by another practice", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await db.credentialType.upsert({
      where: { code: "GUARD_TEST_TYPE_UPS" },
      update: {},
      create: {
        code: "GUARD_TEST_TYPE_UPS",
        name: "Guard Test Type",
        category: "CLINICAL_LICENSE",
      },
    });
    const bCred = await db.credential.create({
      data: {
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectCredentialUpserted(tx, {
          practiceId: practiceA.id,
          payload: {
            credentialId: bCred.id,
            credentialTypeCode: credType.code,
            holderId: null,
            title: "Pwned title",
            licenseNumber: null,
            issuingBody: null,
            issueDate: null,
            expiryDate: null,
            notes: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCredentialRemoved refuses a credentialId owned by another practice", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await db.credentialType.upsert({
      where: { code: "GUARD_TEST_TYPE_RM" },
      update: {},
      create: {
        code: "GUARD_TEST_TYPE_RM",
        name: "Guard Test Type RM",
        category: "CLINICAL_LICENSE",
      },
    });
    const bCred = await db.credential.create({
      data: {
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectCredentialRemoved(tx, {
          practiceId: practiceA.id,
          payload: { credentialId: bCred.id },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCeuActivityLogged refuses a credentialId owned by another practice", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await db.credentialType.upsert({
      where: { code: "GUARD_TEST_TYPE_CEU" },
      update: {},
      create: {
        code: "GUARD_TEST_TYPE_CEU",
        name: "Guard Test Type CEU",
        category: "CLINICAL_LICENSE",
      },
    });
    const bCred = await db.credential.create({
      data: {
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential for CEU",
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectCeuActivityLogged(tx, {
          practiceId: practiceA.id,
          payload: {
            ceuActivityId: `forged-${Math.random().toString(36).slice(2, 10)}`,
            credentialId: bCred.id,
            activityName: "Forged activity",
            provider: null,
            activityDate: new Date().toISOString(),
            hoursAwarded: 1,
            category: null,
            certificateEvidenceId: null,
            notes: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCeuActivityRemoved refuses a ceuActivityId owned by another practice", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await db.credentialType.upsert({
      where: { code: "GUARD_TEST_TYPE_CEU_RM" },
      update: {},
      create: {
        code: "GUARD_TEST_TYPE_CEU_RM",
        name: "Guard Test Type CEU RM",
        category: "CLINICAL_LICENSE",
      },
    });
    const bCred = await db.credential.create({
      data: {
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });
    const bCeu = await db.ceuActivity.create({
      data: {
        practiceId: practiceB.id,
        credentialId: bCred.id,
        activityName: "B's CEU activity",
        activityDate: new Date(),
        hoursAwarded: 1,
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectCeuActivityRemoved(tx, {
          practiceId: practiceA.id,
          payload: { ceuActivityId: bCeu.id, removedReason: null },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectCredentialReminderConfigUpdated refuses a credentialId owned by another practice", async () => {
    const { practiceA, practiceB } = await seedTwoPractices();
    const credType = await db.credentialType.upsert({
      where: { code: "GUARD_TEST_TYPE_REMINDER" },
      update: {},
      create: {
        code: "GUARD_TEST_TYPE_REMINDER",
        name: "Guard Test Type Reminder",
        category: "CLINICAL_LICENSE",
      },
    });
    const bCred = await db.credential.create({
      data: {
        practiceId: practiceB.id,
        credentialTypeId: credType.id,
        title: "B's credential",
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectCredentialReminderConfigUpdated(tx, {
          practiceId: practiceA.id,
          payload: {
            configId: `forged-cfg-${Math.random().toString(36).slice(2, 10)}`,
            credentialId: bCred.id,
            enabled: true,
            milestoneDays: [30],
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // Allergy — 5 sites + 2 audit-#9 additions
  // ────────────────────────────────────────────────────────────────────

  it("projectAllergyEquipmentCheckLogged refuses an equipmentCheckId owned by another practice", async () => {
    const { practiceA, practiceB, practiceBUser, userB } = await seedTwoPractices();
    const bCheck = await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practiceB.id,
        checkedById: practiceBUser.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date(),
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyEquipmentCheckLogged(tx, {
          practiceId: practiceA.id,
          payload: {
            equipmentCheckId: bCheck.id,
            checkType: "EMERGENCY_KIT",
            checkedByUserId: userB.id,
            checkedAt: new Date().toISOString(),
            epiExpiryDate: null,
            epiLotNumber: null,
            allItemsPresent: true,
            itemsReplaced: null,
            temperatureC: null,
            inRange: null,
            notes: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyDrillLogged refuses a drillId owned by another practice", async () => {
    const { practiceA, practiceB, userB, practiceBUser } = await seedTwoPractices();
    const bDrill = await db.allergyDrill.create({
      data: {
        practiceId: practiceB.id,
        conductedById: practiceBUser.id,
        conductedAt: new Date(),
        scenario: "B's drill",
        participantIds: [practiceBUser.id],
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyDrillLogged(tx, {
          practiceId: practiceA.id,
          payload: {
            drillId: bDrill.id,
            conductedByUserId: userB.id,
            conductedAt: new Date().toISOString(),
            scenario: "Forged scenario",
            participantIds: [],
            durationMinutes: null,
            observations: null,
            correctiveActions: null,
            nextDrillDue: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyQuizCompleted refuses a practiceUserId owned by another practice", async () => {
    const { practiceA, practiceB, practiceBUser } = await seedTwoPractices();
    void practiceB;
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practiceA.id,
          payload: {
            attemptId: `forged-${Math.random().toString(36).slice(2, 10)}`,
            practiceUserId: practiceBUser.id,
            year: new Date().getFullYear(),
            score: 100,
            passed: true,
            correctAnswers: 5,
            totalQuestions: 5,
            answers: [],
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyQuizCompleted refuses an attemptId owned by another practice", async () => {
    const { practiceA, practiceB, practiceBUser } = await seedTwoPractices();
    // Seed an attempt in Practice B.
    const bAttempt = await db.allergyQuizAttempt.create({
      data: {
        practiceId: practiceB.id,
        practiceUserId: practiceBUser.id,
        year: new Date().getFullYear(),
        completedAt: new Date(),
        score: 80,
        passed: true,
        totalQuestions: 5,
        correctAnswers: 4,
      },
    });
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyQuizCompleted(tx, {
          practiceId: practiceA.id,
          payload: {
            attemptId: bAttempt.id,
            practiceUserId: practiceBUser.id, // Will hit attemptId guard first
            year: new Date().getFullYear(),
            score: 100,
            passed: true,
            correctAnswers: 5,
            totalQuestions: 5,
            answers: [],
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyFingertipTestPassed refuses a practiceUserId owned by another practice", async () => {
    const { practiceA, practiceBUser, userB } = await seedTwoPractices();
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practiceA.id,
          payload: {
            practiceUserId: practiceBUser.id,
            year: new Date().getFullYear(),
            attestedByUserId: userB.id,
            notes: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyMediaFillPassed refuses a practiceUserId owned by another practice", async () => {
    const { practiceA, practiceBUser, userB } = await seedTwoPractices();
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practiceA.id,
          payload: {
            practiceUserId: practiceBUser.id,
            year: new Date().getFullYear(),
            attestedByUserId: userB.id,
            notes: null,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyCompoundingLogged refuses a practiceUserId owned by another practice (audit #9 projection)", async () => {
    const { practiceA, practiceBUser } = await seedTwoPractices();
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyCompoundingLogged(tx, {
          practiceId: practiceA.id,
          payload: {
            practiceUserId: practiceBUser.id,
            year: new Date().getFullYear(),
            loggedByPracticeUserId: practiceBUser.id,
            loggedAt: new Date().toISOString(),
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });

  it("projectAllergyRequirementToggled refuses a practiceUserId owned by another practice (audit #9 projection)", async () => {
    const { practiceA, practiceBUser } = await seedTwoPractices();
    await expect(
      db.$transaction(async (tx) =>
        projectAllergyRequirementToggled(tx, {
          practiceId: practiceA.id,
          payload: {
            practiceUserId: practiceBUser.id,
            required: true,
            previousValue: false,
            toggledByPracticeUserId: practiceBUser.id,
          },
        }),
      ),
    ).rejects.toThrow(/different practice/i);
  });
});
