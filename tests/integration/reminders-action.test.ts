// tests/integration/reminders-action.test.ts
//
// Phase 7 PR 8 — integration tests for handleSaveReminderSettings (the
// pure helper behind saveReminderSettingsAction). We exercise the helper
// directly so we can pass an explicit {practiceId, actorUserId} ctx
// without needing a Firebase cookie. Same pattern as
// save-practice-profile-action.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  handleSaveReminderSettings,
  saveReminderSettingsAction,
} from "@/app/(dashboard)/settings/reminders/actions";

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

// Mock getCurrentUser so saveReminderSettingsAction's role gate can be
// exercised (STAFF rejection test). Per-test setMockUser switches who
// is "logged in".
let mockUser: { id: string; email: string; firebaseUid: string } | null = null;
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!mockUser) throw new Error("Unauthorized");
    return mockUser;
  },
  getCurrentUser: async () => mockUser,
}));

vi.mock("@/lib/practice-cookie", () => ({
  getSelectedPracticeId: async () => null,
}));

describe("handleSaveReminderSettings", () => {
  let practiceId: string;
  let userId: string;

  beforeEach(async () => {
    const u = await db.user.create({
      data: {
        firebaseUid: `rem-${Math.random().toString(36).slice(2, 10)}`,
        email: `rem-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const p = await db.practice.create({
      data: { name: "Test Practice", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: u.id, practiceId: p.id, role: "OWNER" },
    });
    userId = u.id;
    practiceId = p.id;
    mockUser = null;
  });

  it("writes Practice.reminderSettings + appends event when changed", async () => {
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: [120, 60, 14],
          training: [21, 7],
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual(
      expect.arrayContaining(["credentials", "training"]),
    );

    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    expect(updated.reminderSettings).toEqual({
      credentials: [120, 60, 14],
      training: [21, 7],
    });

    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_REMINDER_SETTINGS_UPDATED" },
    });
    expect(events.length).toBe(1);
    const payload = events[0]!.payload as {
      changedCategories: string[];
      beforeJson: unknown;
      afterJson: unknown;
    };
    expect(payload.changedCategories).toEqual(
      expect.arrayContaining(["credentials", "training"]),
    );
    expect(payload.beforeJson).toBeNull();
    expect(payload.afterJson).toEqual({
      credentials: [120, 60, 14],
      training: [21, 7],
    });
  });

  it("returns empty changedCategories + writes NO event when input matches existing column", async () => {
    // Seed an existing override.
    await db.practice.update({
      where: { id: practiceId },
      data: { reminderSettings: { credentials: [90, 30] } },
    });
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      { reminderSettings: { credentials: [90, 30] } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual([]);

    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_REMINDER_SETTINGS_UPDATED" },
    });
    expect(events.length).toBe(0);
  });

  it("rejects out-of-range milestones (Zod failure)", async () => {
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      // 400 is > 365 -> Zod rejects
      { reminderSettings: { credentials: [400, 30] } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects non-integer milestones at the Zod boundary", async () => {
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      // Zod .int() rejects floats
      { reminderSettings: { credentials: [3.5, 1.2] as unknown as number[] } },
    );
    expect(result.ok).toBe(false);
  });

  it("includes diffs for all changed categories simultaneously", async () => {
    await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: [60, 30],
          training: [14, 7],
          policies: [30, 7],
        },
      },
    );
    // Now change two of the three.
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: [60, 30], // unchanged
          training: [14, 7, 1], // changed
          policies: [60, 7], // changed
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual(
      expect.arrayContaining(["training", "policies"]),
    );
    expect(result.changedCategories).not.toContain("credentials");
  });
});

describe("saveReminderSettingsAction (role gate)", () => {
  let practiceId: string;
  let userId: string;
  let staffUserId: string;

  beforeEach(async () => {
    const u = await db.user.create({
      data: {
        firebaseUid: `rem-owner-${Math.random().toString(36).slice(2, 10)}`,
        email: `rem-owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const staff = await db.user.create({
      data: {
        firebaseUid: `rem-staff-${Math.random().toString(36).slice(2, 10)}`,
        email: `rem-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const p = await db.practice.create({
      data: { name: "Test Practice", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: u.id, practiceId: p.id, role: "OWNER" },
    });
    await db.practiceUser.create({
      data: { userId: staff.id, practiceId: p.id, role: "STAFF" },
    });
    userId = u.id;
    staffUserId = staff.id;
    practiceId = p.id;
    mockUser = null;
  });

  it("rejects STAFF role with an Unauthorized-style error", async () => {
    mockUser = {
      id: staffUserId,
      email: `rem-staff@test.test`,
      firebaseUid: `rem-staff-${Math.random().toString(36).slice(2, 10)}`,
    };
    await expect(
      saveReminderSettingsAction({
        reminderSettings: { credentials: [60] },
      }),
    ).rejects.toThrow();
  });

  it("ADMIN passes the role gate and persists the override", async () => {
    // Promote a fresh user to ADMIN to exercise the gate (OWNER also
    // works — both pass via role hierarchy, but ADMIN is the explicit
    // minimum).
    const admin = await db.user.create({
      data: {
        firebaseUid: `rem-admin-${Math.random().toString(36).slice(2, 10)}`,
        email: `rem-admin-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: admin.id, practiceId, role: "ADMIN" },
    });
    mockUser = {
      id: admin.id,
      email: `rem-admin@test.test`,
      firebaseUid: `rem-admin-${Math.random().toString(36).slice(2, 10)}`,
    };
    const result = await saveReminderSettingsAction({
      reminderSettings: { policies: [45, 14] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toContain("policies");
    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    expect(
      (updated.reminderSettings as Record<string, number[]>).policies,
    ).toEqual([45, 14]);
    // Suppress unused var warnings from the seed block.
    void userId;
  });
});
