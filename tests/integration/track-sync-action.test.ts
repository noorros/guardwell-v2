// tests/integration/track-sync-action.test.ts
//
// Phase 0 / Task 2: syncTrackFromEvidenceAction re-runs the backfill
// against current ComplianceItem state, idempotent on repeat.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";
import { syncTrackTasksFromEvidence } from "@/app/(dashboard)/programs/track/sync-internals";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-sync-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Sync Test", primaryState: "AZ" },
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

describe("syncTrackTasksFromEvidence", () => {
  it("closes a task whose ComplianceItem flipped to COMPLIANT after track creation", async () => {
    const { user, practice } = await seedFreshPractice();

    // Generate track first (no COMPLIANT items yet).
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

    // Now seed a COMPLIANT item DIRECTLY (simulating drift — bypasses
    // the rederive path that would normally also auto-complete).
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

    // Sanity: the task is still open before sync.
    const before = await db.practiceTrackTask.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(before.completedAt).toBeNull();

    // Sync.
    const result = await syncTrackTasksFromEvidence(practice.id);
    expect(result.closed).toBe(1);

    // Task is now closed with reason DERIVED.
    const after = await db.practiceTrackTask.findFirstOrThrow({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(after.completedAt).not.toBeNull();
  });

  it("is idempotent on repeat calls", async () => {
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

    const first = await syncTrackTasksFromEvidence(practice.id);
    const second = await syncTrackTasksFromEvidence(practice.id);
    expect(first.closed).toBe(0);
    expect(second.closed).toBe(0);
  });

  it("returns { closed: 0 } when the practice has no track yet", async () => {
    const { practice } = await seedFreshPractice();
    const result = await syncTrackTasksFromEvidence(practice.id);
    expect(result.closed).toBe(0);
  });
});
