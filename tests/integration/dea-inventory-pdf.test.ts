// tests/integration/dea-inventory-pdf.test.ts
//
// Integration tests for GET /api/audit/dea-inventory — DEA biennial
// controlled-substance inventory PDF. Covers happy path + cross-tenant
// 404 guard. Pattern mirrors osha-301-pdf.test.ts.

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
      email: `dea-${Math.random().toString(36).slice(2, 8)}@test.test`,
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

describe("GET /api/audit/dea-inventory", () => {
  it("returns 200 + PDF for a recorded inventory in the user's practice", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "DEA Inventory Test Clinic",
      "AZ",
    );
    signInAs(user);

    const inventory = await db.deaInventory.create({
      data: {
        practiceId: practice.id,
        asOfDate: new Date("2026-04-15T00:00:00Z"),
        conductedByUserId: user.id,
        witnessUserId: null,
        notes: "Quarterly count, all drugs reconciled.",
        items: {
          create: [
            {
              drugName: "Hydrocodone/APAP",
              ndc: "0406-0123-01",
              schedule: "CII",
              strength: "5/325 mg",
              quantity: 200,
              unit: "tablets",
            },
            {
              drugName: "Diazepam",
              ndc: null,
              schedule: "CIV",
              strength: "5 mg",
              quantity: 50,
              unit: "tablets",
            },
          ],
        },
      },
    });

    const { GET } = await import("@/app/api/audit/dea-inventory/route");
    const res = await GET(
      new Request(
        `http://localhost/api/audit/dea-inventory?inventoryId=${inventory.id}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000);

    const text = extractInflatedText(buf);
    expect(text).toMatch(/DEA Inventory Test Clinic/);
    expect(text).toMatch(/Hydrocodone/);
  });

  it("returns 404 when the inventory belongs to a different practice", async () => {
    const { user: u1 } = await seedPracticeWithUser("Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Practice Two",
    );
    signInAs(u1);

    const otherInventory = await db.deaInventory.create({
      data: {
        practiceId: p2.id,
        asOfDate: new Date("2026-04-15T00:00:00Z"),
        conductedByUserId: u2.id,
        witnessUserId: null,
        notes: null,
        items: {
          create: [
            {
              drugName: "Cross-tenant drug",
              schedule: "CII",
              quantity: 1,
              unit: "tablets",
            },
          ],
        },
      },
    });

    const { GET } = await import("@/app/api/audit/dea-inventory/route");
    const res = await GET(
      new Request(
        `http://localhost/api/audit/dea-inventory?inventoryId=${otherInventory.id}`,
      ),
    );

    expect(res.status).toBe(404);
  });
});
