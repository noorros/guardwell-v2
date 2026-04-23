// tests/integration/track-generation.test.ts
//
// End-to-end coverage for Compliance Track auto-generation +
// auto-completion via the rederive hook.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

async function seedFreshPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `track-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Track Test", primaryState: "AZ" },
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
} as const;

describe("Compliance Track auto-generation", () => {
  it("creates a track + tasks the first time PRACTICE_PROFILE_UPDATED fires", async () => {
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
    const track = await db.practiceTrack.findUnique({
      where: { practiceId: practice.id },
      include: { tasks: true },
    });
    expect(track?.templateCode).toBe("GENERAL_PRIMARY_CARE");
    expect(track?.tasks.length).toBeGreaterThan(0);
  });

  it("does NOT regenerate the track on a second PRACTICE_PROFILE_UPDATED", async () => {
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
    const firstGenerated = (
      await db.practiceTrack.findUniqueOrThrow({
        where: { practiceId: practice.id },
      })
    ).generatedAt;

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload: { ...payload, billsMedicaid: true },
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload: { ...payload, billsMedicaid: true },
        }),
    );
    const second = await db.practiceTrack.findUniqueOrThrow({
      where: { practiceId: practice.id },
    });
    expect(second.generatedAt.getTime()).toBe(firstGenerated.getTime());
  });

  it("auto-completes track tasks whose requirementCode flips to COMPLIANT", async () => {
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

    // Designate a Privacy Officer + seed the requirement so rederive
    // can find a target.
    const pu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id, practiceId: practice.id },
    });
    await db.practiceUser.update({
      where: { id: pu.id },
      data: { isPrivacyOfficer: true },
    });
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
    // IMPORTANT: use the canonical seed's evidence code
    // (`OFFICER_DESIGNATION:PRIVACY`) so upsert doesn't overwrite the
    // seeded value and break other test files. Upsert is idempotent on
    // this code, so running this in parallel with the real HIPAA seed
    // is safe.
    await db.regulatoryRequirement.upsert({
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
    await db.practiceFramework.upsert({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
      update: { enabled: true },
      create: {
        practiceId: practice.id,
        frameworkId: framework.id,
        enabled: true,
      },
    });

    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(
        tx,
        practice.id,
        "OFFICER_DESIGNATION:PRIVACY",
      );
    });

    const completedTask = await db.practiceTrackTask.findFirst({
      where: {
        practiceId: practice.id,
        requirementCode: "HIPAA_PRIVACY_OFFICER",
      },
    });
    expect(completedTask?.completedAt).not.toBeNull();
  });
});
