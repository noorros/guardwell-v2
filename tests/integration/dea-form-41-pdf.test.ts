// tests/integration/dea-form-41-pdf.test.ts
//
// Integration tests for GET /api/audit/dea-form-41/[id] — DEA Form 41
// (Registrant Inventory of Drugs Surrendered) PDF. Covers happy path
// + cross-tenant 404 guard. Pattern mirrors dea-inventory-pdf.test.ts.

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
      email: `dea41-${Math.random().toString(36).slice(2, 8)}@test.test`,
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

describe("GET /api/audit/dea-form-41/[id]", () => {
  it("returns 200 + PDF for a recorded disposal in the user's practice", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "DEA Form 41 Test Clinic",
      "AZ",
    );
    signInAs(user);

    const disposal = await db.deaDisposalRecord.create({
      data: {
        practiceId: practice.id,
        disposedByUserId: user.id,
        witnessUserId: null,
        reverseDistributorName: "Inmar Rx Solutions",
        reverseDistributorDeaNumber: "RI1234567",
        disposalDate: new Date("2026-04-20T00:00:00Z"),
        disposalMethod: "REVERSE_DISTRIBUTOR",
        drugName: "Hydrocodone/APAP",
        ndc: "0406-0123-01",
        schedule: "CII",
        strength: "5/325 mg",
        quantity: 30,
        unit: "tablets",
        form41Filed: false,
        notes: "Expired stock surrendered for destruction.",
      },
    });

    const { GET } = await import("@/app/api/audit/dea-form-41/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/audit/dea-form-41/${disposal.id}`),
      { params: Promise.resolve({ id: disposal.id }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000);

    const text = extractInflatedText(buf);
    expect(text).toMatch(/Form 41/);
    expect(text).toMatch(/Hydrocodone/);
    expect(text).toMatch(/Inmar Rx Solutions/);
  });

  it("returns 404 when the disposal belongs to a different practice", async () => {
    const { user: u1 } = await seedPracticeWithUser("Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Practice Two",
    );
    signInAs(u1);

    const otherDisposal = await db.deaDisposalRecord.create({
      data: {
        practiceId: p2.id,
        disposedByUserId: u2.id,
        witnessUserId: null,
        reverseDistributorName: "Some Other Distributor",
        reverseDistributorDeaNumber: null,
        disposalDate: new Date("2026-04-20T00:00:00Z"),
        disposalMethod: "REVERSE_DISTRIBUTOR",
        drugName: "Cross-tenant drug",
        schedule: "CII",
        quantity: 1,
        unit: "tablets",
        form41Filed: false,
      },
    });

    const { GET } = await import("@/app/api/audit/dea-form-41/[id]/route");
    const res = await GET(
      new Request(
        `http://localhost/api/audit/dea-form-41/${otherDisposal.id}`,
      ),
      { params: Promise.resolve({ id: otherDisposal.id }) },
    );

    expect(res.status).toBe(404);
  });
});
