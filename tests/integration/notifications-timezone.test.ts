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
    //   today (2026-04-29) + 20 days = 2026-05-19 at 08:00 UTC
    //   = 2026-05-18 22:00 HST
    // UTC date string: "2026-05-19", HST local date: "2026-05-18"
    const expiryUTC = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    // Force the time-of-day to 08:00 UTC so the day-boundary is always
    // crossed in HST (UTC-10 gives 22:00 previous day).
    expiryUTC.setUTCHours(8, 0, 0, 0);
    // Compute expected local date in HST by subtracting 10 hours.
    const expiryHSTDate = new Date(expiryUTC.getTime() - 10 * 60 * 60 * 1000);
    const expectedHSTDateStr = expiryHSTDate.toISOString().slice(0, 10);
    const utcDateStr = expiryUTC.toISOString().slice(0, 10);
    // Sanity: HST date must be one day behind UTC.
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
