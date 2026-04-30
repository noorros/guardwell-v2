// src/lib/notifications/leadTimes.test.ts
//
// Phase 7 PR 1 — pure-function tests for getEffectiveLeadTimes.
// No DB; only fixture inputs. Covers:
//   - undefined / null / {} / partial / empty-array / non-array overrides
//   - always-descending sort guarantee

import { describe, it, expect } from "vitest";
import {
  getEffectiveLeadTimes,
  DEFAULT_LEAD_TIMES,
} from "./leadTimes";

describe("getEffectiveLeadTimes", () => {
  it("returns defaults when reminderSettings is undefined", () => {
    expect(getEffectiveLeadTimes(undefined, "credentials")).toEqual(
      DEFAULT_LEAD_TIMES.credentials,
    );
    expect(getEffectiveLeadTimes(undefined, "training")).toEqual(
      DEFAULT_LEAD_TIMES.training,
    );
  });

  it("returns defaults when reminderSettings is null", () => {
    expect(getEffectiveLeadTimes(null, "credentials")).toEqual(
      DEFAULT_LEAD_TIMES.credentials,
    );
    expect(getEffectiveLeadTimes(null, "deaInventory")).toEqual(
      DEFAULT_LEAD_TIMES.deaInventory,
    );
  });

  it("returns defaults when reminderSettings is an empty object", () => {
    expect(getEffectiveLeadTimes({}, "credentials")).toEqual(
      DEFAULT_LEAD_TIMES.credentials,
    );
    expect(getEffectiveLeadTimes({}, "policies")).toEqual(
      DEFAULT_LEAD_TIMES.policies,
    );
  });

  it("uses the override for the configured category and defaults for others", () => {
    const settings = { credentials: [120, 90] };
    expect(getEffectiveLeadTimes(settings, "credentials")).toEqual([120, 90]);
    expect(getEffectiveLeadTimes(settings, "training")).toEqual(
      DEFAULT_LEAD_TIMES.training,
    );
    expect(getEffectiveLeadTimes(settings, "baa")).toEqual(
      DEFAULT_LEAD_TIMES.baa,
    );
  });

  it("falls back to defaults when override is an empty array", () => {
    const settings = { credentials: [] };
    expect(getEffectiveLeadTimes(settings, "credentials")).toEqual(
      DEFAULT_LEAD_TIMES.credentials,
    );
  });

  it("falls back to defaults when override is not an array (defensive)", () => {
    // Cast to bypass the typed interface — JSON column can hold anything.
    const settings = { credentials: "not-an-array" } as unknown;
    expect(getEffectiveLeadTimes(settings, "credentials")).toEqual(
      DEFAULT_LEAD_TIMES.credentials,
    );
  });

  it("always returns the array sorted descending (largest first)", () => {
    const settings = { credentials: [7, 60, 30] };
    expect(getEffectiveLeadTimes(settings, "credentials")).toEqual([60, 30, 7]);
  });

  it("preserves descending order even for already-descending defaults", () => {
    // DEFAULT_LEAD_TIMES.credentials is already [90, 60, 30, 7]
    expect(getEffectiveLeadTimes(undefined, "credentials")).toEqual([
      90, 60, 30, 7,
    ]);
  });

  it("does not mutate the input override array", () => {
    const original = [7, 60, 30];
    const settings = { credentials: original };
    getEffectiveLeadTimes(settings, "credentials");
    // Order preserved on the original; only the returned copy is sorted.
    expect(original).toEqual([7, 60, 30]);
  });

  it("returns defaults for new cmsEnrollment category", () => {
    expect(getEffectiveLeadTimes(undefined, "cmsEnrollment")).toEqual(
      DEFAULT_LEAD_TIMES.cmsEnrollment,
    );
    expect(DEFAULT_LEAD_TIMES.cmsEnrollment).toEqual([90, 60, 30, 7]);
  });

  it("returns defaults for new trainingExpiring category", () => {
    expect(getEffectiveLeadTimes(undefined, "trainingExpiring")).toEqual(
      DEFAULT_LEAD_TIMES.trainingExpiring,
    );
    expect(DEFAULT_LEAD_TIMES.trainingExpiring).toEqual([30, 14, 7]);
  });

  it("returns defaults for new policyReview category", () => {
    expect(getEffectiveLeadTimes(undefined, "policyReview")).toEqual(
      DEFAULT_LEAD_TIMES.policyReview,
    );
    expect(DEFAULT_LEAD_TIMES.policyReview).toEqual([90, 60, 30]);
  });

  it("honors overrides for the new categories", () => {
    const settings = {
      cmsEnrollment: [120, 90],
      trainingExpiring: [45, 21],
      policyReview: [120, 60, 30],
    };
    expect(getEffectiveLeadTimes(settings, "cmsEnrollment")).toEqual([120, 90]);
    expect(getEffectiveLeadTimes(settings, "trainingExpiring")).toEqual([
      45, 21,
    ]);
    expect(getEffectiveLeadTimes(settings, "policyReview")).toEqual([
      120, 60, 30,
    ]);
  });
});
