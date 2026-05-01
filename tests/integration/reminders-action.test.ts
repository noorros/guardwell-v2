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
import { DEFAULT_LEAD_TIMES } from "@/lib/notifications/leadTimes";

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
      // 1826 is > 1825 -> Zod rejects (I-2 boundary check)
      { reminderSettings: { credentials: [1826, 30] } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("accepts 1825 (5-year boundary, CMS revalidation)", async () => {
    // 1825 is the new max so CMS Medicare/Medicaid 5-year revalidation
    // can have a 1-year-out (or earlier) milestone. This is the I-2
    // boundary on the accept side.
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      { reminderSettings: { cmsEnrollment: [1825, 365, 90] } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toContain("cmsEnrollment");
    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    expect(
      (updated.reminderSettings as Record<string, number[]>).cmsEnrollment,
    ).toEqual([1825, 365, 90]);
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

  // ----- I-1 default-filtering -----------------------------------------
  // The form always submits all 9 categories, hydrated with defaults
  // for any unset key. Without server-side filtering, a no-op Save
  // would pin a practice to today's defaults forever. The semantic we
  // want: missing key in JSON = "follow current defaults"; explicit
  // value = "override".

  it("I-1: saving values that match defaults persists no overrides + writes no event", async () => {
    // The form hydrates with DEFAULT_LEAD_TIMES on a practice with
    // null reminderSettings. Submitting that exact shape (user clicked
    // Save without changing anything) must result in nothing
    // persisted + no audit event.
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: DEFAULT_LEAD_TIMES.credentials,
          training: DEFAULT_LEAD_TIMES.training,
          trainingExpiring: DEFAULT_LEAD_TIMES.trainingExpiring,
          policies: DEFAULT_LEAD_TIMES.policies,
          policyReview: DEFAULT_LEAD_TIMES.policyReview,
          baa: DEFAULT_LEAD_TIMES.baa,
          incidents: DEFAULT_LEAD_TIMES.incidents,
          deaInventory: DEFAULT_LEAD_TIMES.deaInventory,
          cmsEnrollment: DEFAULT_LEAD_TIMES.cmsEnrollment,
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual([]);

    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    // Practice.reminderSettings stays null — no overrides persisted.
    expect(updated.reminderSettings).toBeNull();

    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_REMINDER_SETTINGS_UPDATED" },
    });
    expect(events.length).toBe(0);
  });

  it("I-1: saving an explicit override (different from defaults) persists ONLY that key", async () => {
    // User edits credentials only; the form still submits all 9 with
    // the other 8 matching defaults. Persisted JSON should contain
    // only the credentials key.
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: [120, 90, 60, 30], // explicit override
          training: DEFAULT_LEAD_TIMES.training,
          trainingExpiring: DEFAULT_LEAD_TIMES.trainingExpiring,
          policies: DEFAULT_LEAD_TIMES.policies,
          policyReview: DEFAULT_LEAD_TIMES.policyReview,
          baa: DEFAULT_LEAD_TIMES.baa,
          incidents: DEFAULT_LEAD_TIMES.incidents,
          deaInventory: DEFAULT_LEAD_TIMES.deaInventory,
          cmsEnrollment: DEFAULT_LEAD_TIMES.cmsEnrollment,
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual(["credentials"]);

    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    expect(updated.reminderSettings).toEqual({
      credentials: [120, 90, 60, 30],
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
    expect(payload.afterJson).toEqual({ credentials: [120, 90, 60, 30] });
  });

  it("I-1: clearing an override (saving defaults for a previously-overridden category) removes the key", async () => {
    // Seed: practice has an explicit credentials override.
    await db.practice.update({
      where: { id: practiceId },
      data: { reminderSettings: { credentials: [120, 90, 60, 30] } },
    });
    // User reverts credentials to defaults — submits the full 9-cat
    // payload with credentials matching DEFAULT_LEAD_TIMES.credentials.
    // We expect: credentials key removed from column + change logged.
    const result = await handleSaveReminderSettings(
      { practiceId, actorUserId: userId },
      {
        reminderSettings: {
          credentials: DEFAULT_LEAD_TIMES.credentials,
          training: DEFAULT_LEAD_TIMES.training,
          trainingExpiring: DEFAULT_LEAD_TIMES.trainingExpiring,
          policies: DEFAULT_LEAD_TIMES.policies,
          policyReview: DEFAULT_LEAD_TIMES.policyReview,
          baa: DEFAULT_LEAD_TIMES.baa,
          incidents: DEFAULT_LEAD_TIMES.incidents,
          deaInventory: DEFAULT_LEAD_TIMES.deaInventory,
          cmsEnrollment: DEFAULT_LEAD_TIMES.cmsEnrollment,
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedCategories).toEqual(["credentials"]);

    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    // Column cleared back to null — no remaining overrides.
    expect(updated.reminderSettings).toBeNull();

    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_REMINDER_SETTINGS_UPDATED" },
    });
    expect(events.length).toBe(1);
    const payload = events[0]!.payload as {
      changedCategories: string[];
      beforeJson: unknown;
      afterJson: unknown;
    };
    expect(payload.changedCategories).toEqual(["credentials"]);
    expect(payload.beforeJson).toEqual({ credentials: [120, 90, 60, 30] });
    expect(payload.afterJson).toBeNull();
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
