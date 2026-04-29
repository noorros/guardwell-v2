// tests/integration/role-gate-sweep.test.ts
//
// Audit C-2 cross-area sweep (HIPAA + OSHA + Credentials + Allergy
// code reviews, 2026-04-29). Verifies that the actions and API routes
// flagged as "MEMBER/STAFF/VIEWER could exploit" now correctly reject
// non-OWNER/non-ADMIN callers.
//
// Coverage in this PR:
//   - Credentials C-2: addCredentialAction, removeCredentialAction
//   - Credentials C-3: GET /api/credentials/export
//   - Allergy C-2:    attestFingertipTestAction, attestMediaFillTestAction
//                     (per-target tenant check, action already has the
//                      OWNER/ADMIN gate)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  // eslint-disable-next-line no-var
  var __roleSweepTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__roleSweepTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__roleSweepTestUser) throw new Error("Unauthorized");
      return globalThis.__roleSweepTestUser;
    },
  };
});

// `revalidatePath` requires Next.js's static-generation store, which
// isn't available in vitest. Stub it out — the test only cares about
// the auth gate, not cache revalidation.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__roleSweepTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `rg-${Math.random().toString(36).slice(2, 10)}`,
      email: `rg-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `RG ${role} Practice`, primaryState: "AZ" },
  });
  // Always seed an OWNER first so the practice has a captain (the
  // schema doesn't enforce, but actions sometimes assume an OWNER
  // exists for the practiceId scoping).
  const ownerUser = await db.user.create({
    data: {
      firebaseUid: `rg-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `rg-owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  await db.practiceUser.create({
    data: { userId: ownerUser.id, practiceId: practice.id, role: "OWNER" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__roleSweepTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, pu };
}

describe("Audit C-2 role-gate sweep", () => {
  // ────────────────────────────────────────────────────────────────────
  // Credentials C-2: addCredentialAction
  // ────────────────────────────────────────────────────────────────────

  it("addCredentialAction rejects STAFF callers", async () => {
    await seed("STAFF");
    // Seed a credential type so the action gets past the type lookup.
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_ADD_STAFF" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_ADD_STAFF",
        name: "RG Test Type",
        category: "CLINICAL_LICENSE",
      },
    });
    const { addCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      addCredentialAction({
        credentialTypeCode: credType.code,
        holderId: null,
        title: "Pwned by STAFF",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/forbidden|admin|owner|requires/i);
  });

  it("addCredentialAction allows OWNER callers", async () => {
    await seed("OWNER");
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_ADD_OWNER" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_ADD_OWNER",
        name: "RG Test Type Owner",
        category: "CLINICAL_LICENSE",
      },
    });
    const { addCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      addCredentialAction({
        credentialTypeCode: credType.code,
        holderId: null,
        title: "Owner-added credential",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).resolves.not.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────
  // Credentials C-2: removeCredentialAction
  // ────────────────────────────────────────────────────────────────────

  it("removeCredentialAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    // Seed a credential to remove.
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_RM_STAFF" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_RM_STAFF",
        name: "RG Test Type RM",
        category: "CLINICAL_LICENSE",
      },
    });
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Existing credential",
      },
    });
    const { removeCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      removeCredentialAction({ credentialId: cred.id }),
    ).rejects.toThrow(/forbidden|admin|owner|requires/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // Credentials C-3: GET /api/credentials/export role gate
  // ────────────────────────────────────────────────────────────────────

  it("GET /api/credentials/export rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/credentials/export/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET /api/credentials/export allows OWNER callers (returns 200)", async () => {
    await seed("OWNER");
    const { GET } = await import("@/app/api/credentials/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  // ────────────────────────────────────────────────────────────────────
  // Allergy C-2: per-target tenant check on attest actions
  // ────────────────────────────────────────────────────────────────────

  it("attestFingertipTestAction rejects targeting a practiceUser from another practice", async () => {
    // Seed Practice A (caller is OWNER) and Practice B (with a
    // compounder). Attempt to attest B's compounder from A's session.
    await seed("OWNER");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `other-${Math.random().toString(36).slice(2, 10)}`,
        email: `other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });

    const { attestFingertipTestAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      attestFingertipTestAction({
        practiceUserId: otherPu.id,
        notes: null,
      }),
    ).rejects.toThrow(/not found|different practice/i);
  });

  it("attestMediaFillTestAction rejects targeting a practiceUser from another practice", async () => {
    await seed("OWNER");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `other-mf-${Math.random().toString(36).slice(2, 10)}`,
        email: `other-mf-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice MF", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });

    const { attestMediaFillTestAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      attestMediaFillTestAction({
        practiceUserId: otherPu.id,
        notes: null,
      }),
    ).rejects.toThrow(/not found|different practice/i);
  });
});
