// tests/integration/osha-301-pdf.test.ts
//
// Integration tests for GET /api/audit/osha-301/[id] — OSHA Form 301
// per-incident report. Covers happy path, non-OSHA 404, cross-tenant 404.

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
      email: `osha-${Math.random().toString(36).slice(2, 8)}@test.test`,
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

describe("GET /api/audit/osha-301/[id]", () => {
  it("returns 200 + PDF for an OSHA-recordable incident", async () => {
    const { user, practice } = await seedPracticeWithUser("OSHA Test Clinic");
    signInAs(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Needlestick at venipuncture station",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        status: "RESOLVED",
        description: "Phlebotomist sustained needlestick during routine draw.",
        phiInvolved: false,
        affectedCount: 0,
        discoveredAt: new Date("2026-04-15T10:00:00Z"),
        reportedByUserId: user.id,
        oshaBodyPart: "Left index finger",
        oshaInjuryNature: "Puncture wound",
        oshaOutcome: "DAYS_AWAY",
        oshaDaysAway: 1,
        oshaDaysRestricted: 0,
        sharpsDeviceType: "21G venipuncture needle",
      },
    });

    const { GET } = await import(
      "@/app/api/audit/osha-301/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000);

    const text = extractInflatedText(buf);
    expect(text).toMatch(/OSHA Form 301/i);
    expect(text).toMatch(/Needlestick/);
    expect(text).toMatch(/Puncture wound/);
    expect(text).toMatch(/21G venipuncture/);
  });

  it("returns 404 when the incident is not OSHA-recordable", async () => {
    const { user, practice } = await seedPracticeWithUser("Mixed Incidents");
    signInAs(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Privacy breach",
        type: "PRIVACY",
        severity: "HIGH",
        status: "OPEN",
        description: "Statements mailed to wrong addresses.",
        phiInvolved: true,
        affectedCount: 12,
        discoveredAt: new Date("2026-04-15T10:00:00Z"),
        reportedByUserId: user.id,
      },
    });

    const { GET } = await import(
      "@/app/api/audit/osha-301/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not OSHA-recordable/i);
  });

  it("returns 404 when incident belongs to a different practice", async () => {
    const { user: u1 } = await seedPracticeWithUser("Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Practice Two",
    );
    signInAs(u1);

    const otherIncident = await db.incident.create({
      data: {
        practiceId: p2.id,
        title: "OSHA at practice 2",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "RESOLVED",
        description: "Cross-tenant test.",
        phiInvolved: false,
        affectedCount: 0,
        discoveredAt: new Date("2026-04-15T10:00:00Z"),
        reportedByUserId: u2.id,
        oshaBodyPart: "Foot",
        oshaInjuryNature: "Strain",
        oshaOutcome: "FIRST_AID",
      },
    });

    const { GET } = await import(
      "@/app/api/audit/osha-301/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: otherIncident.id }),
    });

    expect(res.status).toBe(404);
  });
});
