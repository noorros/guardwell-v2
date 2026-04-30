// src/lib/notifications/preferences.test.ts
//
// Phase 7 PR 1 — pure-function tests for getEffectivePreferences.
// No DB; only fixture inputs. Covers:
//   - null pref → defaults
//   - cadence pass-through + unknown-value fallback
//   - channel filtering (only EMAIL / IN_APP retained)
//   - categoryFilters pass-through
//   - mutation safety (returned default Set is independent of internal DEFAULTS)

import { describe, it, expect } from "vitest";
import type { NotificationPreference } from "@prisma/client";
import { getEffectivePreferences } from "./preferences";

function makePref(
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
  const base = {
    userId: "u1",
    digestEnabled: true,
    criticalAlertsEnabled: true,
    emailEnabled: true,
    cadence: "DAILY",
    channels: ["EMAIL", "IN_APP"],
    categoryFilters: [],
    digestTime: "08:00",
    digestDay: "MON",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return base as unknown as NotificationPreference;
}

describe("getEffectivePreferences", () => {
  it("returns all defaults when pref is null", () => {
    const result = getEffectivePreferences(null);
    expect(result.digestEnabled).toBe(true);
    expect(result.criticalAlertsEnabled).toBe(true);
    expect(result.emailEnabled).toBe(true);
    expect(result.cadence).toBe("DAILY");
    expect(result.channels).toEqual(new Set(["EMAIL", "IN_APP"]));
    expect(result.categoryFilters).toEqual(new Set());
    expect(result.digestTime).toBe("08:00");
    expect(result.digestDay).toBe("MON");
  });

  it("preserves cadence WEEKLY", () => {
    const pref = makePref({ cadence: "WEEKLY" });
    expect(getEffectivePreferences(pref).cadence).toBe("WEEKLY");
  });

  it("falls back to DAILY when cadence is unknown (e.g. 'BANANA')", () => {
    const pref = makePref({ cadence: "BANANA" });
    expect(getEffectivePreferences(pref).cadence).toBe("DAILY");
  });

  it("filters out unknown channels (SMS) and retains EMAIL + IN_APP", () => {
    const pref = makePref({ channels: ["EMAIL", "SMS", "IN_APP"] });
    const result = getEffectivePreferences(pref);
    expect(result.channels).toEqual(new Set(["EMAIL", "IN_APP"]));
    expect(result.channels.size).toBe(2);
    expect(result.channels.has("EMAIL")).toBe(true);
    expect(result.channels.has("IN_APP")).toBe(true);
  });

  it("passes categoryFilters through as a Set with the configured entries", () => {
    const pref = makePref({ categoryFilters: ["training", "credentials"] });
    const result = getEffectivePreferences(pref);
    expect(result.categoryFilters.size).toBe(2);
    expect(result.categoryFilters.has("training")).toBe(true);
    expect(result.categoryFilters.has("credentials")).toBe(true);
  });

  it("preserves cadence NONE", () => {
    const pref = makePref({ cadence: "NONE" });
    expect(getEffectivePreferences(pref).cadence).toBe("NONE");
  });

  it("returns independent Set copies — mutating one call's result does not leak into the next", () => {
    const first = getEffectivePreferences(null);
    first.channels.delete("EMAIL");
    first.channels.delete("IN_APP");
    first.categoryFilters.add("leaked");

    const second = getEffectivePreferences(null);
    expect(second.channels).toEqual(new Set(["EMAIL", "IN_APP"]));
    expect(second.channels.size).toBe(2);
    expect(second.categoryFilters.size).toBe(0);
    expect(second.categoryFilters.has("leaked")).toBe(false);
  });
});
