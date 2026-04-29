// tests/integration/owner-officer-defaults.test.ts
//
// Audit B-2 (HIPAA findings, 2026-04-29): both practice-creation paths
// (sign-up + onboarding/create-practice) seeded the OWNER as
// `isPrivacyOfficer + isComplianceOfficer` only — `isSecurityOfficer`
// stayed false.
//
// HIPAA §164.308(a)(2) requires a designated Security Officer. The
// dashboard practice card and `/programs/staff` showed Privacy +
// Compliance badges with NO Security Officer, while the HIPAA module's
// "Designate a Security Officer" requirement was being marked Compliant
// via manual override — paper-trail mismatch with no actual designated
// person, an audit-defense gap.
//
// These tests assert the new owner of a practice receives all three
// officer flags by default (Privacy + Security + Compliance). Same
// person can wear all three hats until the practice grows; the first-
// run wizard reassigns when staff arrive.

import { describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    requireUser: async () => globalThis.__officerTestUser,
  };
});

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<object>("next/navigation");
  return {
    ...actual,
    redirect: () => {
      // Server-action-style redirect normally throws — but in tests we
      // just want the side effects (DB writes) to land. Throwing here
      // would short-circuit `await action()` after the work is done.
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Map([["user-agent", "vitest"]]),
}));

declare global {
  // eslint-disable-next-line no-var
  var __officerTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

async function seedUser() {
  const user = await db.user.create({
    data: {
      firebaseUid: `officer-${Math.random().toString(36).slice(2, 10)}`,
      email: `officer-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  globalThis.__officerTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return user;
}

describe("Practice-creation paths seed all 3 officer flags on the OWNER", () => {
  it("createPracticeAction (onboarding/create-practice) — owner is Privacy + Security + Compliance Officer", async () => {
    const user = await seedUser();
    const { createPracticeAction } = await import(
      "@/app/onboarding/create-practice/actions"
    );

    const formData = new FormData();
    formData.set("name", "Officer Defaults Test Clinic");
    formData.set("primaryState", "AZ");
    await createPracticeAction(formData);

    const pu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id },
      include: { practice: true },
    });
    expect(pu.role).toBe("OWNER");
    expect(pu.isPrivacyOfficer).toBe(true);
    // The B-2 fix — was previously false.
    expect(pu.isSecurityOfficer).toBe(true);
    expect(pu.isComplianceOfficer).toBe(true);
  });

  it("completeSignUpAction (sign-up) — owner is Privacy + Security + Compliance Officer", async () => {
    const user = await seedUser();
    const { completeSignUpAction } = await import(
      "@/app/(auth)/sign-up/actions"
    );

    const result = await completeSignUpAction({
      firstName: "Sam",
      lastName: "Lee",
      practiceName: "Sign-Up Officer Defaults Test",
      primaryState: "AZ",
      agreeTos: true,
      agreeBaa: true,
      marketingOptIn: false,
    });
    expect(result.ok).toBe(true);

    const pu = await db.practiceUser.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(pu.role).toBe("OWNER");
    expect(pu.isPrivacyOfficer).toBe(true);
    // The B-2 fix — was previously false.
    expect(pu.isSecurityOfficer).toBe(true);
    expect(pu.isComplianceOfficer).toBe(true);
  });
});
