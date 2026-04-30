// tests/integration/practice-switcher.test.ts
//
// Audit #7 (HIPAA B-3): selectedPracticeId cookie + switchPracticeAction +
// getPracticeUser cookie-aware lookup. Covers:
//   - getPracticeUser falls back to oldest membership when no cookie
//   - getPracticeUser honors a valid cookie value
//   - getPracticeUser falls back to oldest when cookie points to a stale
//     practice (user removed from it)
//   - switchPracticeAction rejects switching to a practice the caller
//     isn't a member of
//   - switchPracticeAction succeeds when caller has active membership

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __switcherTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
  var __switcherTestCookie: string | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__switcherTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__switcherTestUser) throw new Error("Unauthorized");
      return globalThis.__switcherTestUser;
    },
  };
});

vi.mock("@/lib/practice-cookie", () => ({
  SELECTED_PRACTICE_COOKIE: "selectedPracticeId",
  getSelectedPracticeId: async () => globalThis.__switcherTestCookie ?? null,
  setSelectedPracticeId: async (practiceId: string) => {
    globalThis.__switcherTestCookie = practiceId;
  },
  clearSelectedPracticeId: async () => {
    globalThis.__switcherTestCookie = null;
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

// `redirect` from next/navigation throws a NEXT_REDIRECT error in App
// Router runtime. Tests that exercise the action need to catch that
// without it being mistaken for failure. Swap it for a sentinel throw.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

beforeEach(() => {
  globalThis.__switcherTestUser = null;
  globalThis.__switcherTestCookie = null;
});

async function seedUserWithTwoPractices() {
  const user = await db.user.create({
    data: {
      firebaseUid: `sw-${Math.random().toString(36).slice(2, 10)}`,
      email: `sw-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  // First practice = "older" (joinedAt earlier).
  const practiceA = await db.practice.create({
    data: { name: "Older Practice", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId: practiceA.id,
      role: "OWNER",
      joinedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30), // 30 days ago
    },
  });
  // Second practice = "newer".
  const practiceB = await db.practice.create({
    data: { name: "Newer Practice", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId: practiceB.id,
      role: "ADMIN",
      joinedAt: new Date(),
    },
  });
  globalThis.__switcherTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practiceA, practiceB };
}

describe("Audit #7 — Practice switcher", () => {
  describe("getPracticeUser cookie-aware lookup", () => {
    it("falls back to OLDEST membership when no cookie is set", async () => {
      const { practiceA } = await seedUserWithTwoPractices();
      const { getPracticeUser } = await import("@/lib/rbac");
      const pu = await getPracticeUser();
      expect(pu?.practiceId).toBe(practiceA.id);
    });

    it("honors a valid cookie pointing to the NEWER practice", async () => {
      const { practiceB } = await seedUserWithTwoPractices();
      globalThis.__switcherTestCookie = practiceB.id;
      const { getPracticeUser } = await import("@/lib/rbac");
      const pu = await getPracticeUser();
      expect(pu?.practiceId).toBe(practiceB.id);
    });

    it("falls back to oldest when cookie points to a stale (left/removed) practice", async () => {
      const { practiceA, practiceB } = await seedUserWithTwoPractices();
      // Soft-remove the user from Practice B.
      await db.practiceUser.updateMany({
        where: { userId: globalThis.__switcherTestUser!.id, practiceId: practiceB.id },
        data: { removedAt: new Date() },
      });
      globalThis.__switcherTestCookie = practiceB.id;
      const { getPracticeUser } = await import("@/lib/rbac");
      const pu = await getPracticeUser();
      expect(pu?.practiceId).toBe(practiceA.id);
    });

    it("explicit practiceId arg wins over the cookie", async () => {
      const { practiceA, practiceB } = await seedUserWithTwoPractices();
      globalThis.__switcherTestCookie = practiceB.id;
      const { getPracticeUser } = await import("@/lib/rbac");
      const pu = await getPracticeUser(practiceA.id);
      expect(pu?.practiceId).toBe(practiceA.id);
    });

    it("returns null when not signed in", async () => {
      globalThis.__switcherTestUser = null;
      const { getPracticeUser } = await import("@/lib/rbac");
      const pu = await getPracticeUser();
      expect(pu).toBeNull();
    });
  });

  describe("listMembershipsForCurrentUser", () => {
    it("returns all active memberships ordered by joinedAt asc", async () => {
      const { practiceA, practiceB } = await seedUserWithTwoPractices();
      const { listMembershipsForCurrentUser } = await import("@/lib/rbac");
      const list = await listMembershipsForCurrentUser();
      expect(list).toHaveLength(2);
      const [first, second] = list;
      expect(first?.practiceId).toBe(practiceA.id);
      expect(first?.practiceName).toBe("Older Practice");
      expect(first?.role).toBe("OWNER");
      expect(second?.practiceId).toBe(practiceB.id);
      expect(second?.role).toBe("ADMIN");
    });

    it("excludes soft-removed memberships", async () => {
      const { practiceA, practiceB } = await seedUserWithTwoPractices();
      await db.practiceUser.updateMany({
        where: { userId: globalThis.__switcherTestUser!.id, practiceId: practiceB.id },
        data: { removedAt: new Date() },
      });
      const { listMembershipsForCurrentUser } = await import("@/lib/rbac");
      const list = await listMembershipsForCurrentUser();
      expect(list).toHaveLength(1);
      expect(list[0]?.practiceId).toBe(practiceA.id);
    });

    it("returns empty array when not signed in", async () => {
      globalThis.__switcherTestUser = null;
      const { listMembershipsForCurrentUser } = await import("@/lib/rbac");
      const list = await listMembershipsForCurrentUser();
      expect(list).toEqual([]);
    });
  });

  describe("switchPracticeAction", () => {
    it("rejects switching to a practice the caller is NOT a member of", async () => {
      await seedUserWithTwoPractices();
      // Seed a third practice the caller has no membership in.
      const otherPractice = await db.practice.create({
        data: { name: "Other Practice (not a member)", primaryState: "FL" },
      });
      const { switchPracticeAction } = await import(
        "@/app/(dashboard)/settings/switch-practice/actions"
      );
      const fd = new FormData();
      fd.set("practiceId", otherPractice.id);
      await expect(switchPracticeAction(fd)).rejects.toThrow(/not a member/i);
      // Cookie must NOT have been set.
      expect(globalThis.__switcherTestCookie).toBeNull();
    });

    it("rejects switching to a practice the caller has been removed from", async () => {
      const { practiceB } = await seedUserWithTwoPractices();
      await db.practiceUser.updateMany({
        where: { userId: globalThis.__switcherTestUser!.id, practiceId: practiceB.id },
        data: { removedAt: new Date() },
      });
      const { switchPracticeAction } = await import(
        "@/app/(dashboard)/settings/switch-practice/actions"
      );
      const fd = new FormData();
      fd.set("practiceId", practiceB.id);
      await expect(switchPracticeAction(fd)).rejects.toThrow(/not a member/i);
      expect(globalThis.__switcherTestCookie).toBeNull();
    });

    it("sets the cookie + redirects when caller has active membership", async () => {
      const { practiceB } = await seedUserWithTwoPractices();
      const { switchPracticeAction } = await import(
        "@/app/(dashboard)/settings/switch-practice/actions"
      );
      const fd = new FormData();
      fd.set("practiceId", practiceB.id);
      // The action calls redirect() which throws our sentinel error in tests.
      await expect(switchPracticeAction(fd)).rejects.toThrow(/__REDIRECT__:\/dashboard/);
      expect(globalThis.__switcherTestCookie).toBe(practiceB.id);
    });
  });
});
