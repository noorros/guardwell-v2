// tests/integration/credential-ceu-projection.test.ts
//
// Projection tests for CEU + reminder-config events introduced in
// chunk 5 Phase A. Mirror the dea-projection.test.ts pattern.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectCeuActivityLogged,
  projectCeuActivityRemoved,
  projectCredentialReminderConfigUpdated,
} from "@/lib/events/projections/credential";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `ceu-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "CEU Projection Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  // Create a credential type + credential for the activity to attach to
  const credType = await db.credentialType.create({
    data: {
      code: `TEST_TYPE_${Math.random().toString(36).slice(2, 8)}`,
      name: "Test Credential Type",
      category: "BOARD_CERTIFICATION",
      ceuRequirementHours: 30,
      ceuRequirementWindowMonths: 60,
    },
  });
  const credential = await db.credential.create({
    data: {
      practiceId: practice.id,
      credentialTypeId: credType.id,
      title: "Test holder · CMA",
      issueDate: new Date("2024-01-01T00:00:00Z"),
      expiryDate: new Date("2029-01-01T00:00:00Z"),
    },
  });
  return { user, practice, credential };
}

describe("CEU + reminder-config projections", () => {
  it("CEU_ACTIVITY_LOGGED creates a row with computed fields", async () => {
    const { user, practice, credential } = await seed();
    const ceuActivityId = randomUUID();
    const payload = {
      ceuActivityId,
      credentialId: credential.id,
      activityName: "AAMA: Pharmacology Refresher",
      provider: "AAMA Online",
      activityDate: new Date("2026-04-15T10:00:00Z").toISOString(),
      hoursAwarded: 4.5,
      category: "Pharmacology",
      certificateEvidenceId: null,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CEU_ACTIVITY_LOGGED",
        payload,
      },
      async (tx) =>
        projectCeuActivityLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const row = await db.ceuActivity.findUnique({
      where: { id: ceuActivityId },
    });
    expect(row).not.toBeNull();
    expect(row?.activityName).toBe("AAMA: Pharmacology Refresher");
    expect(row?.hoursAwarded).toBe(4.5);
    expect(row?.retiredAt).toBeNull();
  });

  it("CEU_ACTIVITY_REMOVED soft-deletes by setting retiredAt", async () => {
    const { user, practice, credential } = await seed();
    // Create a CEU directly so we have something to remove
    const activity = await db.ceuActivity.create({
      data: {
        practiceId: practice.id,
        credentialId: credential.id,
        activityName: "To be removed",
        activityDate: new Date("2026-03-01T00:00:00Z"),
        hoursAwarded: 2,
      },
    });

    const payload = {
      ceuActivityId: activity.id,
      removedReason: "Duplicate entry",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CEU_ACTIVITY_REMOVED",
        payload,
      },
      async (tx) =>
        projectCeuActivityRemoved(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const row = await db.ceuActivity.findUnique({ where: { id: activity.id } });
    expect(row?.retiredAt).not.toBeNull();
  });

  it("CREDENTIAL_REMINDER_CONFIG_UPDATED upserts the row", async () => {
    const { user, practice, credential } = await seed();
    const configId = randomUUID();
    const payload = {
      configId,
      credentialId: credential.id,
      enabled: true,
      milestoneDays: [120, 60, 14],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CREDENTIAL_REMINDER_CONFIG_UPDATED",
        payload,
      },
      async (tx) =>
        projectCredentialReminderConfigUpdated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const row = await db.credentialReminderConfig.findUnique({
      where: { credentialId: credential.id },
    });
    expect(row?.enabled).toBe(true);
    expect(row?.milestoneDays).toEqual([120, 60, 14]);

    // Re-emit with different milestoneDays — upsert should update
    const updatePayload = {
      ...payload,
      milestoneDays: [90, 30, 7],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "CREDENTIAL_REMINDER_CONFIG_UPDATED",
        payload: updatePayload,
      },
      async (tx) =>
        projectCredentialReminderConfigUpdated(tx, {
          practiceId: practice.id,
          payload: updatePayload,
        }),
    );

    const updated = await db.credentialReminderConfig.findUnique({
      where: { credentialId: credential.id },
    });
    expect(updated?.milestoneDays).toEqual([90, 30, 7]);
  });
});
