// src/lib/events/projections/practiceReminderSettings.test.ts
//
// Phase 7 PR 8 — projection unit tests. We call the projection inside an
// ad-hoc db.$transaction so the assertions exercise the data plane
// directly (the appendEventAndApply transactional wrapper is exercised
// by the integration test under tests/integration/reminders-action.test.ts).
//
// Mirrors the training.test.ts pattern: per-test inline seed creates a
// User + Practice + PracticeUser, then runs the projection.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { projectPracticeReminderSettingsUpdated } from "./practiceReminderSettings";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `prm-${Math.random().toString(36).slice(2, 10)}`,
      email: `prm-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Reminder Settings Proj Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { practice, user };
}

describe("projectPracticeReminderSettingsUpdated", () => {
  it("writes afterJson to Practice.reminderSettings", async () => {
    const { practice, user } = await seed();
    const after = {
      credentials: [120, 90, 30, 7],
      training: [14, 7],
    };
    await db.$transaction(async (tx) => {
      await projectPracticeReminderSettingsUpdated(tx, {
        practiceId: practice.id,
        actorUserId: user.id,
        payload: {
          changedCategories: ["credentials", "training"],
          beforeJson: null,
          afterJson: after,
        },
      });
    });
    const row = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
    });
    expect(row.reminderSettings).toEqual(after);
  });

  it("clears reminderSettings to null when afterJson is null", async () => {
    const { practice, user } = await seed();
    // First write a non-null override.
    await db.practice.update({
      where: { id: practice.id },
      data: { reminderSettings: { credentials: [60, 30] } },
    });
    await db.$transaction(async (tx) => {
      await projectPracticeReminderSettingsUpdated(tx, {
        practiceId: practice.id,
        actorUserId: user.id,
        payload: {
          changedCategories: ["credentials"],
          beforeJson: { credentials: [60, 30] },
          afterJson: null,
        },
      });
    });
    const row = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
    });
    expect(row.reminderSettings).toBeNull();
  });

  it("is idempotent on replay (writing same payload twice lands the same value)", async () => {
    const { practice, user } = await seed();
    const after = { policies: [60, 30, 14] };
    for (let i = 0; i < 2; i++) {
      await db.$transaction(async (tx) => {
        await projectPracticeReminderSettingsUpdated(tx, {
          practiceId: practice.id,
          actorUserId: user.id,
          payload: {
            changedCategories: ["policies"],
            beforeJson: i === 0 ? null : after,
            afterJson: after,
          },
        });
      });
    }
    const row = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
    });
    expect(row.reminderSettings).toEqual(after);
  });
});
