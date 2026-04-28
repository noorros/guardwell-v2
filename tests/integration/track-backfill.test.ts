// tests/integration/track-backfill.test.ts
//
// Phase 0 / Task 1: when a Compliance Track is freshly generated for a
// practice that ALREADY has matching COMPLIANT ComplianceItems, the
// generation projection backfills the matching tasks to completed.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-bf-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Backfill Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

const PROFILE_BASELINE = {
  hasInHouseLab: false,
  dispensesControlledSubstances: false,
  medicareParticipant: false,
  billsMedicaid: false,
  subjectToMacraMips: false,
  sendsAutomatedPatientMessages: false,
  compoundsAllergens: false,
} as const;

describe("Compliance Track backfill at generation", () => {
  it("auto-completes tasks whose requirementCode is already COMPLIANT when track is generated", async () => {
    const { user, practice } = await seedFreshPractice();

    // Pre-seed a COMPLIANT ComplianceItem for HIPAA_PRIVACY_OFFICER
    // BEFORE the track is generated. The framework + requirement may
    // already exist from prior seed runs; upsert keeps this resilient.
    const framework = await db.regulatoryFramework.upsert({
      where: { code: "HIPAA" },
      update: {},
      create: {
        code: "HIPAA",
        name: "HIPAA",
        description: "test",
        jurisdiction: "federal",
        weightDefault: 0.25,
        scoringStrategy: "STANDARD_CHECKLIST",
        sortOrder: 10,
      },
    });
    const requirement = await db.regulatoryRequirement.upsert({
      where: {
        frameworkId_code: {
          frameworkId: framework.id,
          code: "HIPAA_PRIVACY_OFFICER",
        },
      },
      update: { acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"] },
      create: {
        frameworkId: framework.id,
        code: "HIPAA_PRIVACY_OFFICER",
        title: "Privacy Officer",
        severity: "CRITICAL",
        weight: 1.5,
        description: "Designate a Privacy Officer.",
        acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"],
        sortOrder: 10,
      },
    });
    await db.complianceItem.upsert({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: requirement.id,
        },
      },
      update: { status: "COMPLIANT" },
      create: {
        practiceId: practice.id,
        requirementId: requirement.id,
        status: "COMPLIANT",
      },
    });

    // Now generate the track for the first time.
    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    // The Privacy Officer task should be COMPLETED (backfill ran).
    const task = await db.practiceTrackTask.findFirst({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(task).not.toBeNull();
    expect(task?.completedAt).not.toBeNull();

    // A TRACK_TASK_COMPLETED event with reason "DERIVED" was logged.
    const completionEvents = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "TRACK_TASK_COMPLETED",
      },
    });
    expect(completionEvents.length).toBeGreaterThanOrEqual(1);
    const reasons = completionEvents.map(
      (e) => (e.payload as { reason?: string })?.reason ?? null,
    );
    expect(reasons).toContain("DERIVED");
  });

  it("leaves tasks without a requirementCode untouched at generation", async () => {
    const { user, practice } = await seedFreshPractice();

    const payload = {
      ...PROFILE_BASELINE,
      specialtyCategory: "PRIMARY_CARE" as const,
      providerCount: 1,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    // Tasks without requirementCode (e.g., "Verify staff licenses…")
    // remain open even if some other COMPLIANT state exists. Pick the
    // canonical "no requirementCode" task from COMMON_WEEK_4.
    const noCodeTask = await db.practiceTrackTask.findFirst({
      where: {
        practiceId: practice.id,
        requirementCode: null,
      },
    });
    expect(noCodeTask).not.toBeNull();
    expect(noCodeTask?.completedAt).toBeNull();
  });
});
