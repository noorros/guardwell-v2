// tests/integration/hipaa-security-officer-default.test.ts
//
// Audit #18 (HIPAA B-2): both practice-creation paths (onboarding +
// sign-up) must seed the OWNER as Security Officer so HIPAA
// §164.308(a)(2)(ii) is satisfied at practice creation rather than
// appearing as a GAP until the owner finds the toggle on the staff
// page.
//
// Regression test: a new practice's OWNER must have isSecurityOfficer
// = true (alongside isPrivacyOfficer + isComplianceOfficer).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __soTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__soTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__soTestUser) throw new Error("Unauthorized");
      return globalThis.__soTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

beforeEach(() => {
  globalThis.__soTestUser = null;
});

async function seedSignedInUser() {
  const user = await db.user.create({
    data: {
      firebaseUid: `so-${Math.random().toString(36).slice(2, 10)}`,
      email: `so-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  globalThis.__soTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return user;
}

describe("Audit #18 — Security Officer default on practice creation", () => {
  it("createPracticeAction (onboarding) sets isSecurityOfficer=true on the OWNER", async () => {
    await seedSignedInUser();
    const { createPracticeAction } = await import(
      "@/app/onboarding/create-practice/actions"
    );
    const fd = new FormData();
    fd.set("name", "Audit-#18 Onboarding Practice");
    fd.set("primaryState", "AZ");
    // Action throws our sentinel redirect after success.
    await expect(createPracticeAction(fd)).rejects.toThrow(/__REDIRECT__:\/dashboard/);

    const owner = await db.practiceUser.findFirstOrThrow({
      where: {
        userId: globalThis.__soTestUser!.id,
        practice: { name: "Audit-#18 Onboarding Practice" },
      },
      select: {
        role: true,
        isPrivacyOfficer: true,
        isSecurityOfficer: true,
        isComplianceOfficer: true,
      },
    });
    expect(owner.role).toBe("OWNER");
    expect(owner.isPrivacyOfficer).toBe(true);
    expect(owner.isSecurityOfficer).toBe(true); // ← the audit-#18 regression guard
    expect(owner.isComplianceOfficer).toBe(true);
  });
});
