// tests/integration/allergy-drill-participants.test.ts
//
// Audit #21 (Allergy IM-2): AllergyDrill.participantIds is a String[] with
// no FK enforcement. The action layer must validate that every id is
// (a) unique within the submission, and (b) belongs to an ACTIVE member
// of the caller's practice. Without these guards, a forged POST could
// duplicate ids to inflate ALLERGY_ANNUAL_DRILL counts or spray
// cross-tenant ids into a peer practice's drill log.
//
// Mirrors the auth-mocking pattern in tests/integration/credential-update.test.ts
// — the action wrappers hit requireUser/getPracticeUser via Firebase
// cookies which vitest can't provide, so we mock those.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __drillAuthTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
  var __drillAuthTestPracticeId: string | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__drillAuthTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__drillAuthTestUser) throw new Error("Unauthorized");
      return globalThis.__drillAuthTestUser;
    },
  };
});

// getPracticeUser normally reads a Firebase session cookie. Tests stub it
// to return the seeded membership directly (mirrors the practice-switcher
// test's approach but simpler — we always have exactly one membership).
vi.mock("@/lib/rbac", async () => {
  const actual = await vi.importActual<object>("@/lib/rbac");
  return {
    ...actual,
    getPracticeUser: async () => {
      if (!globalThis.__drillAuthTestUser) return null;
      if (!globalThis.__drillAuthTestPracticeId) return null;
      return db.practiceUser.findFirst({
        where: {
          userId: globalThis.__drillAuthTestUser.id,
          practiceId: globalThis.__drillAuthTestPracticeId,
        },
      });
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__drillAuthTestUser = null;
  globalThis.__drillAuthTestPracticeId = null;
});

async function seedOwnerWithStaff(staffCount = 2) {
  const owner = await db.user.create({
    data: {
      firebaseUid: `dr-${Math.random().toString(36).slice(2, 10)}`,
      email: `dr-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Drill IM-2 Practice", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  const staffPus = [];
  for (let i = 0; i < staffCount; i++) {
    const staffUser = await db.user.create({
      data: {
        firebaseUid: `dr-staff-${i}-${Math.random().toString(36).slice(2, 10)}`,
        email: `dr-staff-${i}-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const staffPu = await db.practiceUser.create({
      data: {
        userId: staffUser.id,
        practiceId: practice.id,
        role: "STAFF",
      },
    });
    staffPus.push(staffPu);
  }
  globalThis.__drillAuthTestUser = {
    id: owner.id,
    email: owner.email,
    firebaseUid: owner.firebaseUid,
  };
  globalThis.__drillAuthTestPracticeId = practice.id;
  return { owner, ownerPu, practice, staffPus };
}

describe("logDrillAction — participant FK integrity (audit #21 IM-2)", () => {
  it("rejects duplicate participantIds", async () => {
    const { ownerPu } = await seedOwnerWithStaff(0);
    const { logDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logDrillAction({
        conductedAt: "2026-04-30",
        scenario: "Anaphylaxis after IM injection",
        // Same id twice — should fail Zod refine before any DB lookup.
        participantIds: [ownerPu.id, ownerPu.id],
        durationMinutes: 15,
        observations: null,
        correctiveActions: null,
        nextDrillDue: null,
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("rejects a participantId that belongs to another practice", async () => {
    const { ownerPu } = await seedOwnerWithStaff(0);
    // Seed a separate practice with its own staff member. The OWNER of
    // practice A tries to log a drill including practice B's staff id.
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `dr-other-${Math.random().toString(36).slice(2, 10)}`,
        email: `dr-other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });
    const { logDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logDrillAction({
        conductedAt: "2026-04-30",
        scenario: "Cross-tenant attempt",
        participantIds: [ownerPu.id, otherPu.id],
        durationMinutes: 10,
        observations: null,
        correctiveActions: null,
        nextDrillDue: null,
      }),
    ).rejects.toThrow(/not active members/i);
  });

  it("rejects a participantId for a removed (PracticeUser.removedAt set) member", async () => {
    const { ownerPu, staffPus } = await seedOwnerWithStaff(1);
    // Soft-remove the staff member.
    await db.practiceUser.update({
      where: { id: staffPus[0]!.id },
      data: { removedAt: new Date() },
    });
    const { logDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      logDrillAction({
        conductedAt: "2026-04-30",
        scenario: "Removed member attempt",
        participantIds: [ownerPu.id, staffPus[0]!.id],
        durationMinutes: 10,
        observations: null,
        correctiveActions: null,
        nextDrillDue: null,
      }),
    ).rejects.toThrow(/not active members/i);
  });

  it("happy path — all participants active and same-practice → drill saves cleanly", async () => {
    const { ownerPu, practice, staffPus } = await seedOwnerWithStaff(2);
    const { logDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await logDrillAction({
      conductedAt: "2026-04-30",
      scenario: "Quarterly anaphylaxis drill",
      participantIds: [ownerPu.id, staffPus[0]!.id, staffPus[1]!.id],
      durationMinutes: 20,
      observations: "Smooth response",
      correctiveActions: null,
      nextDrillDue: "2027-04-30",
    });
    const drills = await db.allergyDrill.findMany({
      where: { practiceId: practice.id },
    });
    expect(drills).toHaveLength(1);
    expect(drills[0]!.participantIds).toHaveLength(3);
    expect(drills[0]!.participantIds).toEqual(
      expect.arrayContaining([ownerPu.id, staffPus[0]!.id, staffPus[1]!.id]),
    );
  });
});

describe("updateDrillAction — participant FK integrity (audit #21 IM-2)", () => {
  it("rejects an edit that introduces a removed participant", async () => {
    const { ownerPu, practice, staffPus } = await seedOwnerWithStaff(2);
    const { logDrillAction, updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    // Seed a clean drill first.
    await logDrillAction({
      conductedAt: "2026-04-30",
      scenario: "Original drill",
      participantIds: [ownerPu.id, staffPus[0]!.id],
      durationMinutes: 15,
      observations: null,
      correctiveActions: null,
      nextDrillDue: null,
    });
    const drill = await db.allergyDrill.findFirstOrThrow({
      where: { practiceId: practice.id },
    });
    // Now soft-remove staffPus[1] and try to add them via update.
    await db.practiceUser.update({
      where: { id: staffPus[1]!.id },
      data: { removedAt: new Date() },
    });
    await expect(
      updateDrillAction({
        drillId: drill.id,
        conductedAt: "2026-04-30",
        scenario: "Edited drill",
        participantIds: [ownerPu.id, staffPus[0]!.id, staffPus[1]!.id],
        durationMinutes: 15,
        observations: null,
        correctiveActions: null,
        nextDrillDue: null,
      }),
    ).rejects.toThrow(/not active members/i);
  });

  it("rejects duplicate participantIds on update too", async () => {
    const { ownerPu, practice, staffPus } = await seedOwnerWithStaff(1);
    const { logDrillAction, updateDrillAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await logDrillAction({
      conductedAt: "2026-04-30",
      scenario: "Original drill",
      participantIds: [ownerPu.id, staffPus[0]!.id],
      durationMinutes: 15,
      observations: null,
      correctiveActions: null,
      nextDrillDue: null,
    });
    const drill = await db.allergyDrill.findFirstOrThrow({
      where: { practiceId: practice.id },
    });
    await expect(
      updateDrillAction({
        drillId: drill.id,
        conductedAt: "2026-04-30",
        scenario: "Edited drill",
        participantIds: [ownerPu.id, ownerPu.id],
        durationMinutes: 15,
        observations: null,
        correctiveActions: null,
        nextDrillDue: null,
      }),
    ).rejects.toThrow(/unique/i);
  });
});
