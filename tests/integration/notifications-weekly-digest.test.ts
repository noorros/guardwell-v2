// tests/integration/notifications-weekly-digest.test.ts
//
// Phase 7 PR 7 — end-to-end coverage for runWeeklyNotificationDigest
// against the real Postgres test DB.
//
// We mock @/lib/ai (so no real Claude calls) and @/lib/email/send (so no
// real Resend traffic). The runner itself, the preferences resolution,
// the cadence routing, the seven-day window, and the post-send sentinel
// are all real.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/ai", () => ({
  runLlm: vi.fn().mockResolvedValue({
    output: { summary: "test AI summary", topAction: null },
    llmCallId: "call_test",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }),
}));

const sendEmailMock = vi.fn();
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { runWeeklyNotificationDigest } from "@/lib/notifications/run-digest-weekly";

async function seed(opts: {
  cadence?: "INSTANT" | "DAILY" | "WEEKLY" | "NONE";
  notificationCount?: number;
  notificationCreatedAt?: Date;
}) {
  const cadence = opts.cadence ?? "WEEKLY";
  const user = await db.user.create({
    data: {
      firebaseUid: `wknotif-${Math.random().toString(36).slice(2, 10)}`,
      email: `wknotif-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Weekly Digest Test ${cadence}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  await db.notificationPreference.create({
    data: { userId: user.id, cadence },
  });
  const count = opts.notificationCount ?? 0;
  if (count > 0) {
    const createdAt = opts.notificationCreatedAt ?? new Date();
    for (let i = 0; i < count; i++) {
      await db.notification.create({
        data: {
          practiceId: practice.id,
          userId: user.id,
          type: "SRA_DUE",
          severity: "WARNING",
          title: `Test notification ${i}`,
          body: `Test body ${i}`,
          entityKey: `entity-${i}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt,
        },
      });
    }
  }
  return { user, practice };
}

describe("runWeeklyNotificationDigest", () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ delivered: true, providerId: "test-mock" });
  });

  it("delivers a digest to a WEEKLY user with notifications in the 7-day window", async () => {
    const { user } = await seed({ cadence: "WEEKLY", notificationCount: 3 });

    const summary = await runWeeklyNotificationDigest();

    expect(summary.errors).toEqual([]);
    expect(summary.weeklyDigestsAttempted).toBe(1);
    expect(summary.weeklyDigestsDelivered).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]?.[0] as
      | { to: string; subject: string; text: string; html: string }
      | undefined;
    expect(call).toBeTruthy();
    expect(call?.to).toBe(user.email);
    expect(call?.text).toContain("test AI summary");
    // Confirm the notifications were marked emailed (no second send next run).
    const notifs = await db.notification.findMany({ where: { userId: user.id } });
    expect(notifs.every((n) => n.sentViaEmailAt !== null)).toBe(true);
  });

  it("does nothing for a practice that has zero WEEKLY-cadence users", async () => {
    await seed({ cadence: "DAILY", notificationCount: 5 });

    const summary = await runWeeklyNotificationDigest();

    expect(summary.errors).toEqual([]);
    expect(summary.weeklyDigestsAttempted).toBe(0);
    expect(summary.weeklyDigestsDelivered).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("delivers a quiet-week digest when a WEEKLY user has zero unread notifications", async () => {
    await seed({ cadence: "WEEKLY", notificationCount: 0 });

    const summary = await runWeeklyNotificationDigest();

    expect(summary.errors).toEqual([]);
    expect(summary.weeklyDigestsAttempted).toBe(1);
    expect(summary.weeklyDigestsDelivered).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]?.[0] as
      | { subject: string }
      | undefined;
    expect(call?.subject.toLowerCase()).toContain("weekly compliance digest");
  });

  it("counts a delivery=false response as attempted but not delivered (not an error)", async () => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({
      delivered: false,
      providerId: "mock-fail",
    });
    await seed({ cadence: "WEEKLY", notificationCount: 2 });

    const summary = await runWeeklyNotificationDigest();

    expect(summary.errors).toEqual([]);
    expect(summary.weeklyDigestsAttempted).toBe(1);
    expect(summary.weeklyDigestsDelivered).toBe(0);
  });

  it("skips DAILY-cadence users — the weekly run does not touch them", async () => {
    await seed({ cadence: "DAILY", notificationCount: 4 });

    const summary = await runWeeklyNotificationDigest();

    expect(summary.errors).toEqual([]);
    expect(summary.weeklyDigestsAttempted).toBe(0);
    expect(summary.weeklyDigestsDelivered).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
