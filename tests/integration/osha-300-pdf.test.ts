// tests/integration/osha-300-pdf.test.ts
//
// Integration tests for GET /api/audit/osha-300?year=YYYY — OSHA Form
// 300 annual log. Covers happy path with multiple incidents, the empty-
// year case, and cross-year filtering.

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

async function seedPracticeWithUser(name: string, primaryState = "AZ") {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha300-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Sam",
      lastName: "Lee",
    },
  });
  const practice = await db.practice.create({
    data: { name, primaryState },
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

describe("GET /api/audit/osha-300", () => {
  it("returns 200 + PDF with rows for incidents in the requested year", async () => {
    const { user, practice } = await seedPracticeWithUser("OSHA Log Test");
    signInAs(user);

    await db.incident.createMany({
      data: [
        {
          practiceId: practice.id,
          title: "Slip in lab",
          type: "OSHA_RECORDABLE",
          severity: "LOW",
          status: "RESOLVED",
          description: "Slip on wet floor — knee strain.",
          phiInvolved: false,
          discoveredAt: new Date("2026-02-10T09:00:00Z"),
          reportedByUserId: user.id,
          oshaBodyPart: "Right knee",
          oshaInjuryNature: "Strain",
          oshaOutcome: "RESTRICTED",
          oshaDaysRestricted: 3,
        },
        {
          practiceId: practice.id,
          title: "Sharps injury",
          type: "OSHA_RECORDABLE",
          severity: "MEDIUM",
          status: "RESOLVED",
          description: "Phlebotomist needlestick.",
          phiInvolved: false,
          discoveredAt: new Date("2026-04-15T10:00:00Z"),
          reportedByUserId: user.id,
          oshaBodyPart: "Left index finger",
          oshaInjuryNature: "Puncture wound",
          oshaOutcome: "DAYS_AWAY",
          oshaDaysAway: 1,
          sharpsDeviceType: "21G needle",
        },
      ],
    });

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2026"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    expect(text).toMatch(/OSHA Form 300/i);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/Strain/);
    expect(text).toMatch(/Puncture/);
  });

  it("returns 200 + 'no recordable incidents' for an empty year", async () => {
    const { user } = await seedPracticeWithUser("Empty Year Practice");
    signInAs(user);

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2024"),
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    expect(text).toMatch(/No OSHA-recordable incidents recorded in 2024/i);
  });

  it("filters incidents by calendar year", async () => {
    const { user, practice } = await seedPracticeWithUser("Multi-Year");
    signInAs(user);

    await db.incident.createMany({
      data: [
        {
          practiceId: practice.id,
          title: "2025 incident",
          type: "OSHA_RECORDABLE",
          severity: "LOW",
          status: "RESOLVED",
          description: "From last year.",
          phiInvolved: false,
          discoveredAt: new Date("2025-06-15T10:00:00Z"),
          reportedByUserId: user.id,
          oshaInjuryNature: "Old injury 2025",
          oshaOutcome: "DAYS_AWAY",
        },
        {
          practiceId: practice.id,
          title: "2026 incident",
          type: "OSHA_RECORDABLE",
          severity: "LOW",
          status: "RESOLVED",
          description: "From this year.",
          phiInvolved: false,
          discoveredAt: new Date("2026-03-01T10:00:00Z"),
          reportedByUserId: user.id,
          oshaInjuryNature: "Recent injury 2026",
          oshaOutcome: "DAYS_AWAY",
        },
      ],
    });

    const { GET } = await import("@/app/api/audit/osha-300/route");
    const res = await GET(
      new Request("http://localhost/api/audit/osha-300?year=2026"),
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    expect(text).toMatch(/Recent injury 2026/);
    expect(text).not.toMatch(/Old injury 2025/);
  });
});
