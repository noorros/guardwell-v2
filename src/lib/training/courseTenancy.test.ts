// src/lib/training/courseTenancy.test.ts
//
// Phase 4 PR 4 — unit tests for the TrainingCourse tenancy helpers.
// Pure-function tests; no DB.

import { describe, it, expect } from "vitest";
import { isCustomForPractice, isSystemCourse } from "./courseTenancy";

describe("isCustomForPractice", () => {
  it("returns false for a system course code", () => {
    expect(isCustomForPractice("HIPAA_BASICS", "cmo7thv9aaaaaaaaaaaaaaaaa")).toBe(
      false,
    );
  });

  it("returns true when the code starts with this practice's id underscore", () => {
    const practiceId = "cmo7thv9aaaaaaaaaaaaaaaaa";
    expect(isCustomForPractice(`${practiceId}_MY_COURSE`, practiceId)).toBe(true);
  });

  it("returns false when the code starts with a different practice's id", () => {
    expect(
      isCustomForPractice(
        "cmo7thv9aaaaaaaaaaaaaaaaa_MY_COURSE",
        "cother00bbbbbbbbbbbbbbbbb",
      ),
    ).toBe(false);
  });

  it("returns false for a cuid prefix that's a substring (no leading match)", () => {
    // Sanity: prefix-match is anchored at start.
    expect(
      isCustomForPractice(
        "PREFIX_cmo7thv9aaaaaaaaaaaaaaaaa_FOO",
        "cmo7thv9aaaaaaaaaaaaaaaaa",
      ),
    ).toBe(false);
  });
});

describe("isSystemCourse", () => {
  it("returns true for an uppercase system code", () => {
    expect(isSystemCourse("HIPAA_BASICS")).toBe(true);
  });

  it("returns true for OSHA_HAZCOM, OIG_FRAUD, DEA_CSA, etc.", () => {
    expect(isSystemCourse("OSHA_HAZCOM")).toBe(true);
    expect(isSystemCourse("OIG_FRAUD")).toBe(true);
    expect(isSystemCourse("DEA_CSA")).toBe(true);
  });

  it("returns false when the code starts with a cuid prefix", () => {
    expect(isSystemCourse("cmo7thv9aaaaaaaaaaaaaaaaa_MY_COURSE")).toBe(false);
  });

  it("returns true for a code that has an underscore but no cuid prefix", () => {
    // This is the documented edge case: not_a_cuid_just_underscore is
    // not custom-namespaced, so it is treated as system. (No real
    // system code looks like this today, but the rule must be total —
    // every code is either custom-cuid-prefixed or system.)
    expect(isSystemCourse("not_a_cuid_just_underscore")).toBe(true);
  });

  it("returns true for a string that LOOKS cuid-ish but is too short", () => {
    // 'c' + only 5 chars → not a cuid prefix.
    expect(isSystemCourse("cabcde_FOO")).toBe(true);
  });
});
