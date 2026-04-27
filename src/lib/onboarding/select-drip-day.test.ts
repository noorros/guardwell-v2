import { describe, it, expect } from "vitest";
import { selectDripDays } from "./select-drip-day";
import type { DripDay } from "./drip-content";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function trialEndsIn(daysFromNow: number): Date {
  return new Date(Date.now() + daysFromNow * ONE_DAY_MS);
}

const noneSent = new Set<DripDay>();

describe("selectDripDays", () => {
  describe("ineligibility gates", () => {
    it("returns no days for INCOMPLETE subscriptions", () => {
      const r = selectDripDays({
        subscriptionStatus: "INCOMPLETE",
        trialEndsAt: trialEndsIn(7),
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.ineligibleReason).toMatch(/INCOMPLETE/);
      expect(r.daysDue).toEqual([]);
    });

    it("returns no days for CANCELED subscriptions", () => {
      const r = selectDripDays({
        subscriptionStatus: "CANCELED",
        trialEndsAt: trialEndsIn(7),
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.ineligibleReason).toMatch(/CANCELED/);
      expect(r.daysDue).toEqual([]);
    });

    it("returns no days when trialEndsAt is null", () => {
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: null,
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.ineligibleReason).toMatch(/trialEndsAt/);
      expect(r.daysDue).toEqual([]);
    });

    it("returns no days when more than 14 days post-trial-start", () => {
      const r = selectDripDays({
        subscriptionStatus: "ACTIVE",
        trialEndsAt: trialEndsIn(-15),
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.ineligibleReason).toMatch(/past trial start/);
      expect(r.daysDue).toEqual([]);
    });
  });

  describe("day-1 windowing", () => {
    it("returns [1] on the first day after trial start", () => {
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: trialEndsIn(6),
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.daysDue).toEqual([1]);
    });

    it("returns [] before any day has elapsed (same instant as start)", () => {
      const trialEnd = new Date(Date.now() + 7 * ONE_DAY_MS);
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: trialEnd,
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.daysDue).toEqual([]);
    });
  });

  describe("multi-day catch-up", () => {
    it("returns [1, 3] when on day 4 and nothing sent", () => {
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: trialEndsIn(3),
        alreadySentDays: noneSent,
        now: new Date(),
      });
      expect(r.daysDue).toEqual([1, 3]);
    });

    it("returns [3, 5] when day 1 already sent and on day 5", () => {
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: trialEndsIn(2),
        alreadySentDays: new Set<DripDay>([1]),
        now: new Date(),
      });
      expect(r.daysDue).toEqual([3, 5]);
    });

    it("returns [10] when on day 10 and 1/3/5/7 already sent", () => {
      const r = selectDripDays({
        subscriptionStatus: "TRIALING",
        trialEndsAt: trialEndsIn(-3),
        alreadySentDays: new Set<DripDay>([1, 3, 5, 7]),
        now: new Date(),
      });
      expect(r.daysDue).toEqual([10]);
    });

    it("returns [] when all 5 days already sent", () => {
      const r = selectDripDays({
        subscriptionStatus: "ACTIVE",
        trialEndsAt: trialEndsIn(-3),
        alreadySentDays: new Set<DripDay>([1, 3, 5, 7, 10]),
        now: new Date(),
      });
      expect(r.daysDue).toEqual([]);
      expect(r.ineligibleReason).toBeNull();
    });
  });

  describe("post-trial windows", () => {
    it("returns [10] for ACTIVE practices on day 10", () => {
      const r = selectDripDays({
        subscriptionStatus: "ACTIVE",
        trialEndsAt: trialEndsIn(-3),
        alreadySentDays: new Set<DripDay>([1, 3, 5, 7]),
        now: new Date(),
      });
      expect(r.daysDue).toEqual([10]);
    });

    it("includes day 10 even when subscription is PAST_DUE (give them a chance)", () => {
      const r = selectDripDays({
        subscriptionStatus: "PAST_DUE",
        trialEndsAt: trialEndsIn(-3),
        alreadySentDays: new Set<DripDay>([1, 3, 5, 7]),
        now: new Date(),
      });
      expect(r.daysDue).toEqual([10]);
    });
  });
});
