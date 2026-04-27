// tests/integration/onboarding-drip.test.ts
//
// End-to-end for runOnboardingDrip:
//   - sends day-1 email when on day 1
//   - is idempotent (second run sends nothing more)
//   - sends day-3 next when time advances
//   - skips practices with no OWNER
//   - filters out CANCELED + INCOMPLETE subscriptions

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { runOnboardingDrip } from "@/lib/onboarding/run-drip";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function suffix() {
  return Math.random().toString(36).slice(2, 10);
}

async function seedTrialingPractice(args: {
  trialEndsInDays: number;
  status?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
  withOwner?: boolean;
  firstRunCompleted?: boolean;
}) {
  const owner = args.withOwner === false
    ? null
    : await db.user.create({
        data: {
          firebaseUid: `drip-${suffix()}`,
          email: `drip-${suffix()}@test.test`,
        },
      });
  const practice = await db.practice.create({
    data: {
      name: `Drip Test Clinic ${suffix()}`,
      primaryState: "AZ",
      subscriptionStatus: args.status ?? "TRIALING",
      trialEndsAt: new Date(Date.now() + args.trialEndsInDays * ONE_DAY_MS),
      firstRunCompletedAt: args.firstRunCompleted ? new Date() : null,
    },
  });
  if (owner) {
    await db.practiceUser.create({
      data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
    });
  }
  return { owner, practice };
}

describe("runOnboardingDrip", () => {
  it("sends day-1 email when within 1-day window", async () => {
    const { practice } = await seedTrialingPractice({ trialEndsInDays: 6 });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.emailsAttempted).toBe(1);
    const sent = await db.onboardingDripSent.findMany({
      where: { practiceId: practice.id },
    });
    expect(sent.map((s) => s.day)).toEqual([1]);
  });

  it("is idempotent — re-running with no time change does nothing more", async () => {
    const { practice } = await seedTrialingPractice({ trialEndsInDays: 6 });
    await runOnboardingDrip({ practiceId: practice.id });
    const second = await runOnboardingDrip({ practiceId: practice.id });
    expect(second.emailsAttempted).toBe(0);
    const sent = await db.onboardingDripSent.findMany({
      where: { practiceId: practice.id },
    });
    expect(sent).toHaveLength(1);
  });

  it("sends multiple due days in one run (catch-up)", async () => {
    // Day 5 of trial → days 1, 3, 5 should all fire.
    const { practice } = await seedTrialingPractice({ trialEndsInDays: 2 });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.emailsAttempted).toBe(3);
    const sent = await db.onboardingDripSent.findMany({
      where: { practiceId: practice.id },
      orderBy: { day: "asc" },
    });
    expect(sent.map((s) => s.day)).toEqual([1, 3, 5]);
  });

  it("only sends day 3 when day 1 is already recorded and on day 3", async () => {
    const { practice } = await seedTrialingPractice({ trialEndsInDays: 4 });
    await db.onboardingDripSent.create({
      data: {
        practiceId: practice.id,
        day: 1,
        recipientEmail: "owner-prev@test.test",
        emailDelivered: true,
      },
    });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.emailsAttempted).toBe(1);
    const sent = await db.onboardingDripSent.findMany({
      where: { practiceId: practice.id },
      orderBy: { day: "asc" },
    });
    expect(sent.map((s) => s.day)).toEqual([1, 3]);
  });

  it("skips practices with no OWNER", async () => {
    const { practice } = await seedTrialingPractice({
      trialEndsInDays: 6,
      withOwner: false,
    });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.emailsAttempted).toBe(0);
    expect(result.errors.some((e) => /no OWNER/i.test(e.message))).toBe(true);
  });

  it("skips CANCELED subscriptions", async () => {
    const { practice } = await seedTrialingPractice({
      trialEndsInDays: 6,
      status: "CANCELED",
    });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.practicesScanned).toBe(0); // pre-filter excludes CANCELED
    expect(result.emailsAttempted).toBe(0);
  });

  it("skips INCOMPLETE subscriptions", async () => {
    const { practice } = await seedTrialingPractice({
      trialEndsInDays: 6,
      status: "INCOMPLETE",
    });
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.practicesScanned).toBe(0);
    expect(result.emailsAttempted).toBe(0);
  });

  it("includes ACTIVE subscriptions for day 10 (post-trial)", async () => {
    const { practice } = await seedTrialingPractice({
      trialEndsInDays: -3,
      status: "ACTIVE",
    });
    // Pretend days 1/3/5/7 already went out during trial.
    for (const day of [1, 3, 5, 7]) {
      await db.onboardingDripSent.create({
        data: {
          practiceId: practice.id,
          day,
          recipientEmail: "owner@test.test",
          emailDelivered: true,
        },
      });
    }
    const result = await runOnboardingDrip({ practiceId: practice.id });
    expect(result.emailsAttempted).toBe(1);
    const sent = await db.onboardingDripSent.findMany({
      where: { practiceId: practice.id },
      orderBy: { day: "asc" },
    });
    expect(sent.map((s) => s.day)).toEqual([1, 3, 5, 7, 10]);
  });
});
