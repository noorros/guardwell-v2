// tests/integration/federal-holidays.test.ts
//
// Audit #21 / HIPAA M-3 (2026-04-30, Wave-4 D4): unit-style coverage for
// `src/lib/dates/federalHolidays.ts`. Pure-function tests — no DB, no
// fixtures — but parked under `tests/integration` because that's where
// the breach-clock derivation tests live and this file sits one layer
// below them on the dependency tree.
//
// Coverage:
//   - One case per federal holiday (11 in total) for a fixed reference
//     year that exercises a few observed-date adjustments.
//   - Edge case: New Year's Day on Sunday → observed Monday Jan 2 (2023).
//   - Edge case: Christmas on Saturday → observed Friday Dec 24 (2022).
//   - addBusinessDays without skipHolidays — preserves prior behavior.
//   - addBusinessDays with skipHolidays — extends across a federal
//     holiday landing inside the window (Memorial Day 2024).
//   - addBusinessDays with skipHolidays — observed-date holiday counts.

import { describe, it, expect } from "vitest";
import {
  isUsFederalHoliday,
  addBusinessDays,
  getUsFederalHolidaysForYear,
} from "@/lib/dates/federalHolidays";

const utc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d));

describe("isUsFederalHoliday — 2026 reference year", () => {
  // 2026 was chosen because it spreads observed-date adjustments across
  // multiple holidays:
  //   - New Year's Day 2026 (Thu) — no adjustment.
  //   - Independence Day 2026 (Sat) — observed Friday Jul 3.
  //   - Christmas Day 2026 (Fri) — no adjustment.

  it("recognizes New Year's Day (Jan 1, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 0, 1))).toBe(true);
  });

  it("recognizes MLK Day (3rd Monday of Jan — Jan 19, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 0, 19))).toBe(true);
  });

  it("recognizes Presidents' Day (3rd Monday of Feb — Feb 16, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 1, 16))).toBe(true);
  });

  it("recognizes Memorial Day (last Monday of May — May 25, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 4, 25))).toBe(true);
  });

  it("recognizes Juneteenth (Jun 19, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 5, 19))).toBe(true);
  });

  it("recognizes observed Independence Day (Jul 4, 2026 falls on Sat → observed Fri Jul 3)", () => {
    // Jul 4 itself (Saturday) is NOT the observed date.
    expect(isUsFederalHoliday(utc(2026, 6, 4))).toBe(false);
    // Jul 3 (Friday) IS.
    expect(isUsFederalHoliday(utc(2026, 6, 3))).toBe(true);
  });

  it("recognizes Labor Day (1st Monday of Sep — Sep 7, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 8, 7))).toBe(true);
  });

  it("recognizes Columbus Day (2nd Monday of Oct — Oct 12, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 9, 12))).toBe(true);
  });

  it("recognizes Veterans Day (Nov 11, 2026 — Wednesday, no adjustment)", () => {
    expect(isUsFederalHoliday(utc(2026, 10, 11))).toBe(true);
  });

  it("recognizes Thanksgiving (4th Thursday of Nov — Nov 26, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 10, 26))).toBe(true);
  });

  it("recognizes Christmas Day (Dec 25, 2026)", () => {
    expect(isUsFederalHoliday(utc(2026, 11, 25))).toBe(true);
  });
});

describe("isUsFederalHoliday — observed-date edge cases", () => {
  it("New Year on Sunday → observed Monday (2023-01-01 is Sun → 2023-01-02 observed)", () => {
    // The actual Sunday is NOT observed — federal employees get Monday off.
    expect(isUsFederalHoliday(utc(2023, 0, 1))).toBe(false);
    expect(isUsFederalHoliday(utc(2023, 0, 2))).toBe(true);
  });

  it("Christmas on Saturday → observed Friday (2021-12-25 is Sat → 2021-12-24 observed)", () => {
    expect(isUsFederalHoliday(utc(2021, 11, 25))).toBe(false);
    expect(isUsFederalHoliday(utc(2021, 11, 24))).toBe(true);
  });

  it("returns false for ordinary weekdays (2026-04-15 — Wednesday)", () => {
    expect(isUsFederalHoliday(utc(2026, 3, 15))).toBe(false);
  });

  it("returns false for ordinary weekends (2026-04-18 — Saturday)", () => {
    expect(isUsFederalHoliday(utc(2026, 3, 18))).toBe(false);
  });

  it("returns 11 holidays per year", () => {
    expect(getUsFederalHolidaysForYear(2026)).toHaveLength(11);
    expect(getUsFederalHolidaysForYear(2024)).toHaveLength(11);
  });
});

describe("addBusinessDays — weekend skipping (skipHolidays=false)", () => {
  it("adds 1 business day across a weekend (Fri → Mon)", () => {
    // Fri 2026-04-17 → Mon 2026-04-20.
    const result = addBusinessDays(utc(2026, 3, 17), 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("adds 5 business days from a Monday (Mon → next Mon, no holiday)", () => {
    // Mon 2026-04-13 + 5 bdays = Mon 2026-04-20.
    const result = addBusinessDays(utc(2026, 3, 13), 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("ignores federal holidays when skipHolidays is omitted (default behavior)", () => {
    // Memorial Day 2026 is Mon May 25. Without skipHolidays the helper
    // counts Memorial Day as a normal business day.
    // Fri 2026-05-22 + 1 bday = Mon 2026-05-25 (Memorial Day, not skipped).
    const result = addBusinessDays(utc(2026, 4, 22), 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-25");
  });
});

describe("addBusinessDays — holiday skipping (skipHolidays=true)", () => {
  it("skips Memorial Day Monday — Fri 2026-05-22 + 1 bday = Tue 2026-05-26", () => {
    const result = addBusinessDays(utc(2026, 4, 22), 1, { skipHolidays: true });
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  it("skips observed-Independence-Day Friday — Wed 2026-07-01 + 2 bdays = Tue 2026-07-07", () => {
    // Jul 4, 2026 is Sat → observed Fri Jul 3.
    // Wed Jul 1 + 1 bday = Thu Jul 2 (skip Fri Jul 3 holiday) + 1 bday = Mon Jul 6 (skip weekend) → wait check carefully.
    // Wed 2026-07-01 → +1 bday → Thu 2026-07-02 → +1 bday → skip Fri Jul 3 (observed Independence Day), skip Sat/Sun → Mon 2026-07-06.
    const result = addBusinessDays(utc(2026, 6, 1), 2, { skipHolidays: true });
    expect(result.toISOString().slice(0, 10)).toBe("2026-07-06");
  });

  it("CA 15-business-day breach window straddling Memorial Day 2024 extends correctly", () => {
    // Discovery on Fri 2024-05-17.
    // Naive (weekends only): 15 bdays → Fri 2024-06-07.
    // Federal-holiday-aware: skips Memorial Day Mon 2024-05-27 → adds one
    // additional calendar day → Mon 2024-06-10.
    const naive = addBusinessDays(utc(2024, 4, 17), 15);
    expect(naive.toISOString().slice(0, 10)).toBe("2024-06-07");

    const holidayAware = addBusinessDays(utc(2024, 4, 17), 15, {
      skipHolidays: true,
    });
    expect(holidayAware.toISOString().slice(0, 10)).toBe("2024-06-10");
  });

  it("returns a clone of start when days=0", () => {
    const start = utc(2026, 3, 15);
    const result = addBusinessDays(start, 0, { skipHolidays: true });
    expect(result.getTime()).toBe(start.getTime());
    // Should be a different Date instance (mutation safety).
    expect(result).not.toBe(start);
  });
});
