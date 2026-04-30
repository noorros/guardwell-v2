// src/lib/credentials/status.test.ts
//
// Audit #16 (Credentials I-5 + I-11): pin the EXPIRING_SOON window at
// 90 days and the boundary semantics. The whole point of the helper
// is that ONE place defines the threshold, so this test is the
// regression guard against a future "let's loosen it to 60" edit
// silently reintroducing the cross-surface mismatch.

import { describe, it, expect } from "vitest";
import {
  EXPIRING_SOON_DAYS,
  getCredentialStatus,
} from "./status";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("getCredentialStatus", () => {
  it("EXPIRING_SOON_DAYS is 90", () => {
    expect(EXPIRING_SOON_DAYS).toBe(90);
  });

  it("returns NO_EXPIRY when expiryDate is null", () => {
    expect(getCredentialStatus(null, new Date())).toBe("NO_EXPIRY");
  });

  it("returns NO_EXPIRY when expiryDate is undefined", () => {
    expect(getCredentialStatus(undefined, new Date())).toBe("NO_EXPIRY");
  });

  it("returns EXPIRED when expiryDate is in the past", () => {
    const now = new Date("2026-04-30T00:00:00Z");
    const expired = new Date(now.getTime() - DAY_MS);
    expect(getCredentialStatus(expired, now)).toBe("EXPIRED");
  });

  it("returns EXPIRING_SOON when expiryDate is within 90 days", () => {
    const now = new Date("2026-04-30T00:00:00Z");
    const soon = new Date(now.getTime() + 30 * DAY_MS);
    expect(getCredentialStatus(soon, now)).toBe("EXPIRING_SOON");
  });

  it("returns EXPIRING_SOON when expiryDate is exactly 90 days away (inclusive boundary)", () => {
    const now = new Date("2026-04-30T00:00:00Z");
    const ninety = new Date(now.getTime() + 90 * DAY_MS);
    expect(getCredentialStatus(ninety, now)).toBe("EXPIRING_SOON");
  });

  it("returns ACTIVE when expiryDate is more than 90 days away", () => {
    const now = new Date("2026-04-30T00:00:00Z");
    const future = new Date(now.getTime() + 91 * DAY_MS);
    expect(getCredentialStatus(future, now)).toBe("ACTIVE");
  });

  it("treats expiryDate exactly equal to now as EXPIRING_SOON (not EXPIRED)", () => {
    // A credential whose expiry instant equals the moment of computation
    // is "expiring NOW" — not yet past — so it's the urgent warning,
    // not the EXPIRED bucket. This guards against off-by-one drift if
    // the implementation ever switches from `< 0` to `<= 0`.
    const now = new Date("2026-04-30T00:00:00Z");
    expect(getCredentialStatus(now, now)).toBe("EXPIRING_SOON");
  });
});
