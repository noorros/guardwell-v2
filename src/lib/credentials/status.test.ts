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

// Audit #21 MN-8 (2026-04-30): the existing boundary tests all use
// midnight-UTC anchors. In production `now` arrives from the request
// handler (server) where the system clock can be UTC, but the credential
// expiryDate is whatever the issuer printed on the document — typically
// stored as UTC midnight of a calendar day in the practice's local TZ.
// The status helper compares two `Date` instants regardless of TZ, but
// these regressions confirm the comparison stays correct when `now`
// itself is constructed from a non-UTC offset string.
describe("getCredentialStatus — non-UTC `now` boundary (audit #21 MN-8)", () => {
  it("EXPIRING_SOON: 90-day boundary holds when `now` is constructed from a Pacific timestamp", () => {
    // 2026-04-30 17:00 Pacific (UTC-7) = 2026-05-01 00:00 UTC. Expiry
    // exactly 90 days later in absolute time should still land at the
    // inclusive EXPIRING_SOON boundary.
    const nowPacific = new Date("2026-04-30T17:00:00-07:00");
    expect(nowPacific.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    const ninety = new Date(nowPacific.getTime() + 90 * DAY_MS);
    expect(getCredentialStatus(ninety, nowPacific)).toBe("EXPIRING_SOON");
  });

  it("ACTIVE: 91-day boundary holds when `now` is constructed from a Hawaii timestamp", () => {
    // Hawaii is UTC-10 with no DST. A `now` constructed from a Hawaii
    // offset string still resolves to the same absolute instant — the
    // helper must not be sensitive to the source-string offset.
    const nowHawaii = new Date("2026-04-30T14:00:00-10:00");
    expect(nowHawaii.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    const ninetyOne = new Date(nowHawaii.getTime() + 91 * DAY_MS);
    expect(getCredentialStatus(ninetyOne, nowHawaii)).toBe("ACTIVE");
  });

  it("EXPIRED: a UTC-midnight expiry is EXPIRED relative to a `now` an hour later in Eastern", () => {
    // Expiry stored as 2026-04-30 00:00 UTC; the request lands at
    // 2026-04-30 01:00 EDT (UTC-4) = 2026-04-30 05:00 UTC — five hours
    // past the expiry instant. Helper should report EXPIRED regardless
    // of which TZ the `now` Date was originally parsed from.
    const expiryUtc = new Date("2026-04-30T00:00:00Z");
    const nowEastern = new Date("2026-04-30T01:00:00-04:00");
    expect(nowEastern.toISOString()).toBe("2026-04-30T05:00:00.000Z");
    expect(getCredentialStatus(expiryUtc, nowEastern)).toBe("EXPIRED");
  });
});
