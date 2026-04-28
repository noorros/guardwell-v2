// tests/integration/dea-form-106-pdf.test.ts
//
// Integration tests for GET /api/audit/dea-form-106/[id] — DEA Form
// 106 (Report of Theft or Loss of Controlled Substances) PDF. Covers
// happy path + cross-tenant 404 guard. Pattern mirrors
// dea-form-41-pdf.test.ts.

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
      email: `dea106-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
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

describe("GET /api/audit/dea-form-106/[id]", () => {
  it("returns 200 + PDF for a recorded theft/loss in the user's practice", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "DEA Form 106 Test Clinic",
      "AZ",
    );
    signInAs(user);

    const report = await db.deaTheftLossReport.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        discoveredAt: new Date("2026-04-22T00:00:00Z"),
        lossType: "THEFT",
        drugName: "Hydrocodone/APAP",
        ndc: "0406-0123-01",
        schedule: "CII",
        strength: "5/325 mg",
        quantityLost: 30,
        unit: "tablets",
        methodOfDiscovery:
          "Daily count discrepancy — vial missing from secured cabinet.",
        lawEnforcementNotified: true,
        lawEnforcementAgency: "Phoenix PD",
        lawEnforcementCaseNumber: "2026-12345",
        deaNotifiedAt: null,
        form106SubmittedAt: null,
        notes: "Reviewed surveillance footage.",
      },
    });

    const { GET } = await import("@/app/api/audit/dea-form-106/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/audit/dea-form-106/${report.id}`),
      { params: Promise.resolve({ id: report.id }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000);

    const text = extractInflatedText(buf);
    expect(text).toMatch(/Form 106/);
    expect(text).toMatch(/Hydrocodone/);
    expect(text).toMatch(/Theft/);
  });

  it("returns 404 when the report belongs to a different practice", async () => {
    const { user: u1 } = await seedPracticeWithUser("Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Practice Two",
    );
    signInAs(u1);

    const otherReport = await db.deaTheftLossReport.create({
      data: {
        practiceId: p2.id,
        reportedByUserId: u2.id,
        discoveredAt: new Date("2026-04-22T00:00:00Z"),
        lossType: "LOSS",
        drugName: "Cross-tenant drug",
        schedule: "CII",
        quantityLost: 1,
        unit: "tablets",
        lawEnforcementNotified: false,
      },
    });

    const { GET } = await import("@/app/api/audit/dea-form-106/[id]/route");
    const res = await GET(
      new Request(
        `http://localhost/api/audit/dea-form-106/${otherReport.id}`,
      ),
      { params: Promise.resolve({ id: otherReport.id }) },
    );

    expect(res.status).toBe(404);
  });
});
