// tests/integration/save-practice-profile-action.test.ts
//
// Integration tests for handleSavePracticeProfile, the pure helper behind
// the savePracticeProfileAction "use server" wrapper. We exercise the
// helper directly so we can pass an explicit {practiceId, actorUserId}
// ctx without needing a Firebase cookie. Same pattern as
// concierge-actions.test.ts and credential-ceu-action.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { handleSavePracticeProfile } from "@/app/(dashboard)/settings/practice/actions";

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

describe("handleSavePracticeProfile", () => {
  let practiceId: string;
  let userId: string;

  beforeEach(async () => {
    const u = await db.user.create({
      data: {
        firebaseUid: `t-${Math.random().toString(36).slice(2, 10)}`,
        email: `t-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const p = await db.practice.create({
      data: { name: "Test Practice", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: u.id, practiceId: p.id, role: "OWNER" },
    });
    userId = u.id;
    practiceId = p.id;
  });

  it("writes Practice + derived specialtyCategory", async () => {
    const result = await handleSavePracticeProfile(
      { practiceId, actorUserId: userId },
      {
        name: "Acme Family Medicine",
        npiNumber: null,
        entityType: "COVERED_ENTITY",
        primaryState: "AZ",
        operatingStates: ["NV"],
        addressStreet: "1 Main",
        addressSuite: null,
        addressCity: "Phoenix",
        addressZip: "85001",
        specialty: "Family Medicine",
        providerCount: "SOLO",
        ehrSystem: "Epic",
        staffHeadcount: 3,
        phone: null,
      },
    );
    expect(result.ok).toBe(true);

    const updated = await db.practice.findUniqueOrThrow({
      where: { id: practiceId },
    });
    expect(updated.name).toBe("Acme Family Medicine");
    expect(updated.operatingStates).toEqual(["NV"]);
    expect(updated.specialty).toBe("Family Medicine");
    expect(updated.entityType).toBe("COVERED_ENTITY");

    const profile = await db.practiceComplianceProfile.findUnique({
      where: { practiceId },
    });
    expect(profile?.specialtyCategory).toBe("PRIMARY_CARE");
  });

  it("rejects invalid NPI with Luhn failure", async () => {
    const result = await handleSavePracticeProfile(
      { practiceId, actorUserId: userId },
      {
        name: "X",
        npiNumber: "1234567890",
        entityType: "COVERED_ENTITY",
        primaryState: "AZ",
        operatingStates: [],
        addressStreet: null,
        addressSuite: null,
        addressCity: null,
        addressZip: null,
        specialty: null,
        providerCount: "SOLO",
        ehrSystem: null,
        staffHeadcount: null,
        phone: null,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/npi/i);
  });

  it("appends a PRACTICE_PROFILE_UPDATED event with changed fields", async () => {
    await handleSavePracticeProfile(
      { practiceId, actorUserId: userId },
      {
        name: "Acme",
        npiNumber: null,
        entityType: "COVERED_ENTITY",
        primaryState: "AZ",
        operatingStates: [],
        addressStreet: null,
        addressSuite: null,
        addressCity: null,
        addressZip: null,
        specialty: "Cardiology",
        providerCount: "SOLO",
        ehrSystem: null,
        staffHeadcount: null,
        phone: null,
      },
    );
    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_PROFILE_UPDATED" },
    });
    expect(events.length).toBe(1);
    const payload = events[0]!.payload as { changedFields: string[] };
    expect(payload.changedFields).toContain("name");
    expect(payload.changedFields).toContain("specialty");
  });
});
