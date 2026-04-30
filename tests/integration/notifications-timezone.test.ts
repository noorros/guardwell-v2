// tests/integration/notifications-timezone.test.ts
//
// Verifies that notification body strings render dates in the practice's
// configured timezone, not UTC. Audit item #10.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { generateCredentialNotifications } from "@/lib/notifications/generators";

describe("notifications timezone", () => {
  it("renders credential expiry dates in HI practice's timezone", async () => {
    const user = await db.user.create({
      data: {
        firebaseUid: `tz-hi-${Math.random().toString(36).slice(2, 10)}`,
        email: `tz-hi-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: {
        name: "HI Smoke",
        primaryState: "HI",
        timezone: "Pacific/Honolulu",
      },
    });
    await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
    });
    const credentialType = await db.credentialType.upsert({
      where: { code: "TZ_TEST_DEA" },
      update: {},
      create: {
        code: "TZ_TEST_DEA",
        name: "DEA Registration",
        category: "DEA_REGISTRATION",
      },
    });
    // Pick a UTC timestamp that is within the 60-day horizon AND crosses
    // the calendar-day boundary in HST (UTC-10):
    //   Date.now() + 20 days at 08:00 UTC crosses into the previous calendar
    //   day in HST (22:00 the night before).
    // We choose 20 days out so the credential stays inside the generator's
    // 60-day expiry horizon regardless of when CI runs.
    const expiryUTC = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    // Force the time-of-day to 08:00 UTC so the day-boundary is always
    // crossed in HST (UTC-10 gives 22:00 the previous calendar day).
    expiryUTC.setUTCHours(8, 0, 0, 0);

    // Derive the expected HST date string INDEPENDENTLY of the
    // formatPracticeDate implementation under test — using a fresh
    // Intl.DateTimeFormat with a different locale ("en-US") rather than
    // manual offset arithmetic. This ensures the assertion cannot be
    // trivially satisfied by a consistent-but-wrong offset on both sides.
    // (Code-review concern: Issue 1 — audit #10, 2026-04-29.)
    const hstFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const hstParts = hstFmt.format(expiryUTC).split("/"); // "MM/DD/YYYY"
    const [hstM, hstD, hstY] = hstParts;
    const expectedHSTDateStr = `${hstY}-${hstM}-${hstD}`;
    const utcDateStr = expiryUTC.toISOString().slice(0, 10);
    // Sanity-check: the boundary actually crossed — HST date is one day behind UTC.
    expect(expectedHSTDateStr).not.toBe(utcDateStr);

    await db.credential.create({
      data: {
        practiceId: practice.id,
        title: "DEA registration",
        credentialTypeId: credentialType.id,
        expiryDate: expiryUTC,
      },
    });

    const proposals = await generateCredentialNotifications(
      db,
      practice.id,
      [user.id],
      "Pacific/Honolulu",
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.body).toContain(expectedHSTDateStr);
    expect(proposals[0]?.body).not.toContain(utcDateStr);
  });
});
