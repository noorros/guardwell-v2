// tests/integration/practice-profile.test.ts
//
// Covers the PRACTICE_PROFILE_UPDATED projection end-to-end:
//   - Upserts PracticeComplianceProfile row
//   - Flips PracticeFramework.enabled per the applicability matrix
//   - Non-applicable frameworks get soft-disabled (scoreCache preserved)
//   - Toggling back on re-enables without scrubbing score state

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";

async function seedFrameworks() {
  const rows = [
    { code: "HIPAA", sortOrder: 10 },
    { code: "OSHA", sortOrder: 20 },
    { code: "OIG", sortOrder: 30 },
    { code: "CLIA", sortOrder: 40 },
    { code: "DEA", sortOrder: 50 },
    { code: "CMS", sortOrder: 60 },
    { code: "MACRA", sortOrder: 70 },
    { code: "TCPA", sortOrder: 80 },
  ];
  for (const r of rows) {
    await db.regulatoryFramework.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code,
        name: r.code,
        description: "test",
        jurisdiction: "federal",
        weightDefault: 0.1,
        scoringStrategy: "STANDARD_CHECKLIST",
        sortOrder: r.sortOrder,
      },
    });
  }
}

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `prof-${Math.random().toString(36).slice(2, 10)}`,
      email: `prof-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Profile Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("PRACTICE_PROFILE_UPDATED projection", () => {
  beforeEach(async () => {
    await seedFrameworks();
  });

  it("Creates the profile row and enables HIPAA/OSHA/OIG baseline", async () => {
    const { user, practice } = await seedPractice();
    const payload = {
      hasInHouseLab: false,
      dispensesControlledSubstances: false,
      medicareParticipant: false,
      billsMedicaid: false,
      subjectToMacraMips: false,
      sendsAutomatedPatientMessages: false,
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

    const profile = await db.practiceComplianceProfile.findUnique({
      where: { practiceId: practice.id },
    });
    expect(profile).not.toBeNull();

    // Baseline frameworks enabled. Filter to the known federal set so
    // leftover state-overlay or test-scaffolding frameworks don't fail
    // the assertion — the projection defaults unknown codes to enabled
    // on purpose.
    const KNOWN_FEDERAL = new Set([
      "HIPAA",
      "OSHA",
      "OIG",
      "CLIA",
      "DEA",
      "CMS",
      "MACRA",
      "TCPA",
    ]);
    const enabled = await db.practiceFramework.findMany({
      where: { practiceId: practice.id, enabled: true },
      include: { framework: { select: { code: true } } },
    });
    const codes = enabled
      .map((e) => e.framework.code)
      .filter((c) => KNOWN_FEDERAL.has(c))
      .sort();
    expect(codes).toEqual(["HIPAA", "OIG", "OSHA"]);
  });

  it("Turns on CLIA when hasInHouseLab=true", async () => {
    const { user, practice } = await seedPractice();
    const payload = {
      hasInHouseLab: true,
      dispensesControlledSubstances: false,
      medicareParticipant: false,
      billsMedicaid: false,
      subjectToMacraMips: false,
      sendsAutomatedPatientMessages: false,
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
    const cliaRow = await db.practiceFramework.findFirst({
      where: { practiceId: practice.id, framework: { code: "CLIA" } },
    });
    expect(cliaRow?.enabled).toBe(true);
  });

  it("Medicare participation OR Medicaid billing enables CMS", async () => {
    const { user, practice } = await seedPractice();
    const payload = {
      hasInHouseLab: false,
      dispensesControlledSubstances: false,
      medicareParticipant: false,
      billsMedicaid: true,
      subjectToMacraMips: false,
      sendsAutomatedPatientMessages: false,
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
    const cms = await db.practiceFramework.findFirst({
      where: { practiceId: practice.id, framework: { code: "CMS" } },
    });
    expect(cms?.enabled).toBe(true);
  });

  it("Toggling a framework off preserves scoreCache (soft disable)", async () => {
    const { user, practice } = await seedPractice();
    // Enable all.
    const enableAll = {
      hasInHouseLab: true,
      dispensesControlledSubstances: true,
      medicareParticipant: true,
      billsMedicaid: true,
      subjectToMacraMips: true,
      sendsAutomatedPatientMessages: true,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload: enableAll,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload: enableAll,
        }),
    );
    // Force a score on CLIA so we can check preservation.
    const cliaFramework = await db.regulatoryFramework.findUnique({
      where: { code: "CLIA" },
    });
    await db.practiceFramework.update({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: cliaFramework!.id,
        },
      },
      data: { scoreCache: 75, scoreLabel: "Good" },
    });

    // Toggle CLIA off.
    const disableClia = { ...enableAll, hasInHouseLab: false };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_PROFILE_UPDATED",
        payload: disableClia,
      },
      async (tx) =>
        projectPracticeProfileUpdated(tx, {
          practiceId: practice.id,
          payload: disableClia,
        }),
    );

    const row = await db.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: cliaFramework!.id,
        },
      },
    });
    expect(row?.enabled).toBe(false);
    expect(row?.disabledAt).not.toBeNull();
    expect(row?.scoreCache).toBe(75); // preserved
  });
});
