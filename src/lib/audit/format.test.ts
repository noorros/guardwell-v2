import { describe, it, expect } from "vitest";
import {
  formatPracticeDate,
  formatPracticeDateLong,
  formatPracticeDateTime,
  isValidTimezone,
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
    expect(out).toMatch(/^2026-04-29 08:42 (MST|GMT-7)$/);
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
