import { describe, it, expect } from "vitest";
import { US_STATES } from "@/lib/states";
import { STATE_DEFAULT_TIMEZONE, defaultTimezoneForState } from "./stateDefaults";

describe("STATE_DEFAULT_TIMEZONE", () => {
  it("has an entry for every US_STATES code", () => {
    for (const s of US_STATES) {
      expect(STATE_DEFAULT_TIMEZONE[s.code], `missing ${s.code}`).toBeDefined();
    }
  });
  it.each([
    ["AZ", "America/Phoenix"],
    ["HI", "Pacific/Honolulu"],
    ["AK", "America/Anchorage"],
    ["DC", "America/New_York"],
    ["FL", "America/New_York"],
    ["TX", "America/Chicago"],
    ["ID", "America/Boise"],
    ["IN", "America/Indiana/Indianapolis"],
    ["NY", "America/New_York"],
    ["CA", "America/Los_Angeles"],
  ])("%s defaults to %s", (state, tz) => {
    expect(STATE_DEFAULT_TIMEZONE[state]).toBe(tz);
  });
});

describe("defaultTimezoneForState", () => {
  it("returns the entry for a known code", () => {
    expect(defaultTimezoneForState("AZ")).toBe("America/Phoenix");
  });
  it("normalizes lowercase", () => {
    expect(defaultTimezoneForState("az")).toBe("America/Phoenix");
  });
  it("falls back to America/New_York for unknown", () => {
    expect(defaultTimezoneForState("XX")).toBe("America/New_York");
    expect(defaultTimezoneForState("")).toBe("America/New_York");
  });
});
