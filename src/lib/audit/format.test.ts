import { describe, it, expect } from "vitest";
import {
  formatPracticeDate,
  formatPracticeDateForInput,
  formatPracticeDateLong,
  formatPracticeDateTime,
  isValidTimezone,
  practiceYearBoundsUtc,
} from "./format";

describe("formatPracticeDate", () => {
  it("renders an AZ-evening UTC date as the AZ-local day", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 18:00 in MST (America/Phoenix is UTC-7, no DST)
    const d = new Date("2026-07-01T01:00:00Z");
    expect(formatPracticeDate(d, "America/Phoenix")).toBe("2026-06-30");
  });

  it("renders an HI-late-night UTC date as the HI-local day", () => {
    // 2026-12-31T08:00:00Z = 2026-12-30 22:00 in HST (UTC-10, no DST)
    const d = new Date("2026-12-31T08:00:00Z");
    expect(formatPracticeDate(d, "Pacific/Honolulu")).toBe("2026-12-30");
  });

  it("respects DST: NY 03:30 UTC on 2026-03-08 is still the prior day local", () => {
    // Spring-forward: 2026-03-08 02:00 EST → 03:00 EDT. 03:30 UTC = 22:30 prior-day EST → "2026-03-07"
    const d = new Date("2026-03-08T03:30:00Z");
    expect(formatPracticeDate(d, "America/New_York")).toBe("2026-03-07");
  });

  it("renders UTC as YYYY-MM-DD when tz is UTC", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), "UTC")).toBe("2026-04-29");
  });

  it("falls back to UTC on null tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), null)).toBe("2026-04-29");
  });

  it("falls back to UTC on invalid tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), "Not/A/Zone")).toBe(
      "2026-04-29",
    );
  });

  it("falls back to UTC on undefined tz", () => {
    expect(formatPracticeDate(new Date("2026-04-29T12:00:00Z"), undefined)).toBe(
      "2026-04-29",
    );
  });
});

describe("formatPracticeDateLong", () => {
  it("renders 'Apr 29, 2026' style output", () => {
    expect(formatPracticeDateLong(new Date("2026-04-29T12:00:00Z"), "America/New_York")).toBe(
      "Apr 29, 2026",
    );
  });

  it("respects timezone for boundary dates", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 in AZ
    expect(formatPracticeDateLong(new Date("2026-07-01T01:00:00Z"), "America/Phoenix")).toBe(
      "Jun 30, 2026",
    );
  });
});

describe("formatPracticeDateTime", () => {
  it("renders date + 24h time + zone abbr", () => {
    const out = formatPracticeDateTime(new Date("2026-04-29T15:42:00Z"), "America/Phoenix");
    // Different Node ICU builds emit "MST" or "GMT-7" for America/Phoenix
    // — accept both so the test isn't brittle to a future ICU bump.
    expect(out).toMatch(/^2026-04-29 08:42 (MST|GMT-7)$/);
  });
});

describe("formatPracticeDateForInput", () => {
  it("returns YYYY-MM-DD for a Date in the practice's tz (Pacific midnight UTC)", () => {
    // 2026-04-30T05:00:00Z = 2026-04-29 22:00 in PDT (UTC-7).
    const d = new Date("2026-04-30T05:00:00Z");
    expect(formatPracticeDateForInput(d, "America/Los_Angeles")).toBe("2026-04-29");
  });

  it("accepts an ISO string and returns the practice-tz day", () => {
    expect(
      formatPracticeDateForInput("2026-04-30T05:00:00Z", "America/Los_Angeles"),
    ).toBe("2026-04-29");
  });

  it("returns '' for null", () => {
    expect(formatPracticeDateForInput(null, "America/New_York")).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(formatPracticeDateForInput(undefined, "America/New_York")).toBe("");
  });

  it("returns '' for an unparseable string", () => {
    expect(formatPracticeDateForInput("not-a-date", "America/New_York")).toBe("");
  });

  it("does not drift across a DST spring-forward boundary", () => {
    // 2026-03-08T07:00:00Z = 2026-03-08 03:00 EDT (just after the
    // 02:00→03:00 jump). Locally this is March 8th, not March 7th.
    const d = new Date("2026-03-08T07:00:00Z");
    expect(formatPracticeDateForInput(d, "America/New_York")).toBe("2026-03-08");
    // Right before the jump (06:30 UTC = 01:30 EST same Sunday) it's
    // still March 8 locally — DST doesn't shift the date.
    const before = new Date("2026-03-08T06:30:00Z");
    expect(formatPracticeDateForInput(before, "America/New_York")).toBe("2026-03-08");
  });

  it("east coast vs west coast diverge at midnight UTC on a year boundary", () => {
    // 2027-01-01T00:00:00Z is still 2026-12-31 19:00 EST (UTC-5)
    // and 2026-12-31 16:00 PST (UTC-8). Both should land on the prior
    // calendar day — input form would otherwise show 2027-01-01.
    const newYearUtc = new Date("2027-01-01T00:00:00Z");
    expect(formatPracticeDateForInput(newYearUtc, "America/New_York")).toBe("2026-12-31");
    expect(formatPracticeDateForInput(newYearUtc, "America/Los_Angeles")).toBe(
      "2026-12-31",
    );
  });

  it("falls back to UTC when tz is invalid", () => {
    const d = new Date("2026-04-30T05:00:00Z");
    expect(formatPracticeDateForInput(d, "Not/A/Zone")).toBe("2026-04-30");
  });
});

describe("practiceYearBoundsUtc", () => {
  it("brackets the calendar year as observed in the practice tz (Pacific)", () => {
    // California year 2026 starts at 2026-01-01 00:00 PST = 2026-01-01 08:00 UTC,
    // ends at 2027-01-01 00:00 PST = 2027-01-01 08:00 UTC.
    const { startUtc, endUtc } = practiceYearBoundsUtc(2026, "America/Los_Angeles");
    expect(startUtc.toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });

  it("brackets the calendar year as observed in the practice tz (Eastern)", () => {
    // 2026 EST: 2026-01-01 00:00 EST (-5) = 2026-01-01 05:00 UTC.
    const { startUtc, endUtc } = practiceYearBoundsUtc(2026, "America/New_York");
    expect(startUtc.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("agrees with UTC when tz is UTC", () => {
    const { startUtc, endUtc } = practiceYearBoundsUtc(2026, "UTC");
    expect(startUtc.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("a 2026-12-31 23:00 Pacific event (= 2027-01-01 07:00 UTC) is inside 2026 bounds", () => {
    const { startUtc, endUtc } = practiceYearBoundsUtc(2026, "America/Los_Angeles");
    const lateDec = new Date("2027-01-01T07:00:00Z"); // 2026-12-31 23:00 PST
    expect(lateDec.getTime() >= startUtc.getTime()).toBe(true);
    expect(lateDec.getTime() < endUtc.getTime()).toBe(true);
  });

  it("a 2027-01-01 05:00 UTC event is still 2026-12-31 21:00 PST → inside 2026 bounds", () => {
    const { startUtc, endUtc } = practiceYearBoundsUtc(2026, "America/Los_Angeles");
    const utcEarlyJan = new Date("2027-01-01T05:00:00Z");
    expect(utcEarlyJan.getTime() >= startUtc.getTime()).toBe(true);
    expect(utcEarlyJan.getTime() < endUtc.getTime()).toBe(true);
  });
});

describe("isValidTimezone", () => {
  it("accepts known IANA zones", () => {
    expect(isValidTimezone("America/Phoenix")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Pacific/Honolulu")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValidTimezone("Not/A/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("foo")).toBe(false);
  });
});
