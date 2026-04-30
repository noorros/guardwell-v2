// tests/integration/osha-300-tz-year-boundary.test.ts
//
// Audit #21 (OSHA C-4): the OSHA Form 300 calendar-year filter must
// bracket the year as observed in the practice's timezone, not in UTC.
// Two boundary cases:
//   1. A 2026-12-31 23:00 Pacific incident has a UTC stamp of
//      2027-01-01 07:00. UTC-bound filter excluded it from the 2026
//      form; practice-TZ-bound filter must keep it.
//   2. A 2027-01-01 03:00 UTC incident is still 2026-12-31 19:00
//      Pacific. UTC-bound filter would put it on the 2027 form;
//      practice-TZ-bound filter keeps it on 2026.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { extractInflatedText } from "./utils/pdf-text";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

beforeEach(() => {
  globalThis.__testUser = null;
});

async function seedPacificPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha-tz-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Sam",
      lastName: "Lee",
    },
  });
  const practice = await db.practice.create({
    data: {
      name: "CA Pacific Practice",
      primaryState: "CA",
      timezone: "America/Los_Angeles",
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

function signInAs(user: { id: string; email: string; firebaseUid: string }) {
  globalThis.__testUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
}

describe("OSHA Form 300 — practice-TZ calendar-year boundary", () => {
  it("includes a 2026-12-31 evening Pacific incident on the 2026 form (UTC says 2027)", async () => {
    const { user, practice } = await seedPacificPractice();
    signInAs(user);

    // 2027-01-01T07:00:00Z = 2026-12-31 23:00 PST. Under the old UTC
    // filter (`year-01-01T00:00:00Z`..`year+1-01-01T00:00:00Z`) the row
    // would be classified as 2027 and disappear from the 2026 form.
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Late-Dec slip",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "RESOLVED",
        description: "Slip on wet floor — late-evening shift.",
        phiInvolved: false,
        discoveredAt: new Date("2027-01-01T07:00:00Z"),
        reportedByUserId: user.id,
        oshaInjuryNature: "LateDecBoundary",
        oshaOutcome: "DAYS_AWAY",
      },
    });

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2026"),
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    // Must appear on the 2026 form even though UTC year is 2027.
    expect(text).toMatch(/LateDecBoundary/);
  });

  it("excludes a Pacific 2027-01-01 morning incident from the 2026 form", async () => {
    const { user, practice } = await seedPacificPractice();
    signInAs(user);

    // 2027-01-01T18:00:00Z = 2027-01-01 10:00 PST. Genuinely 2027
    // locally — must NOT show up on the 2026 form.
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "New-Year shift slip",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "RESOLVED",
        description: "Slipped on first shift of the new year.",
        phiInvolved: false,
        discoveredAt: new Date("2027-01-01T18:00:00Z"),
        reportedByUserId: user.id,
        oshaInjuryNature: "NewYearMorningPST",
        oshaOutcome: "DAYS_AWAY",
      },
    });

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2026"),
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    expect(text).not.toMatch(/NewYearMorningPST/);
  });

  it("a Pacific 2026-12-31 evening incident also lands on the 2026 form when filtered by 2026", async () => {
    const { user, practice } = await seedPacificPractice();
    signInAs(user);

    // 2027-01-01T05:00:00Z = 2026-12-31 21:00 PST. Old UTC filter
    // would have said 2027; practice-TZ filter says 2026.
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "9pm Pacific slip",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "RESOLVED",
        description: "Late shift slip.",
        phiInvolved: false,
        discoveredAt: new Date("2027-01-01T05:00:00Z"),
        reportedByUserId: user.id,
        oshaInjuryNature: "NinePMBoundary",
        oshaOutcome: "DAYS_AWAY",
      },
    });

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res2026 = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2026"),
    );
    expect(res2026.status).toBe(200);
    const text2026 = extractInflatedText(new Uint8Array(await res2026.arrayBuffer()));
    expect(text2026).toMatch(/NinePMBoundary/);
  });
});
