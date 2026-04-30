// tests/integration/credential-update.test.ts
//
// Audit #8 (Credentials B-2): updateCredentialAction. Verifies:
//   - STAFF rejected (role gate matches addCredentialAction / removeCredentialAction)
//   - OWNER allowed and persists field updates
//   - Cross-tenant: refuses to update another practice's credential
//   - Retired credential refuses (must re-add instead)
//   - credentialTypeCode preserved from existing row, NOT spoofable
//     via the input (it's not in the input schema, but verify via
//     replay)
//   - holderId in another practice rejected (verifyHolderInPractice)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __credUpdateTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__credUpdateTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__credUpdateTestUser) throw new Error("Unauthorized");
      return globalThis.__credUpdateTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__credUpdateTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `cu-${Math.random().toString(36).slice(2, 10)}`,
      email: `cu-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `CU ${role} Practice`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__credUpdateTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice };
}

async function seedCredentialType(code: string) {
  return db.credentialType.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name: `Type ${code}`,
      category: "CLINICAL_LICENSE",
    },
  });
}

describe("updateCredentialAction (audit #8)", () => {
  it("rejects STAFF callers (role gate)", async () => {
    const { practice } = await seed("STAFF");
    const credType = await seedCredentialType("CU_TYPE_STAFF_REJECT");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Original title",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      updateCredentialAction({
        credentialId: cred.id,
        title: "Pwned by STAFF",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("allows OWNER and persists the new field values", async () => {
    const { practice } = await seed("OWNER");
    const credType = await seedCredentialType("CU_TYPE_OWNER_OK");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Original title",
        licenseNumber: "OLD-12345",
        notes: "Old notes",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await updateCredentialAction({
      credentialId: cred.id,
      title: "Updated title",
      licenseNumber: "NEW-67890",
      issuingBody: "AZ Board of Medicine",
      issueDate: "2026-01-15",
      expiryDate: "2028-01-15",
      notes: "Renewed for 2 years",
    });
    const after = await db.credential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.title).toBe("Updated title");
    expect(after.licenseNumber).toBe("NEW-67890");
    expect(after.issuingBody).toBe("AZ Board of Medicine");
    expect(after.issueDate?.toISOString()).toContain("2026-01-15");
    expect(after.expiryDate?.toISOString()).toContain("2028-01-15");
    expect(after.notes).toBe("Renewed for 2 years");
  });

  it("rejects updating a credential in another practice (per-target tenant check)", async () => {
    await seed("OWNER");
    // Seed a credential in a DIFFERENT practice.
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const credType = await seedCredentialType("CU_TYPE_CROSS_TENANT");
    const otherCred = await db.credential.create({
      data: {
        practiceId: otherPractice.id,
        credentialTypeId: credType.id,
        title: "Other practice's credential",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      updateCredentialAction({
        credentialId: otherCred.id,
        title: "Pwned cross-tenant",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/not in your practice/i);
  });

  it("rejects updating a retired credential", async () => {
    const { practice } = await seed("OWNER");
    const credType = await seedCredentialType("CU_TYPE_RETIRED");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Retired credential",
        retiredAt: new Date(),
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      updateCredentialAction({
        credentialId: cred.id,
        title: "Trying to revive",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/retired/i);
  });

  it("rejects assigning a holder from another practice", async () => {
    const { practice } = await seed("OWNER");
    const credType = await seedCredentialType("CU_TYPE_HOLDER_CROSS");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Existing credential",
      },
    });
    // Seed a holder in a different practice.
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `oh-${Math.random().toString(36).slice(2, 10)}`,
        email: `oh-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Holder Practice", primaryState: "FL" },
    });
    const otherHolder = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      updateCredentialAction({
        credentialId: cred.id,
        holderId: otherHolder.id,
        title: "Existing credential",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/holder not in your practice/i);
  });

  it("preserves holderId through Edit when payload omits the field (audit #21 CR-1)", async () => {
    const { practice } = await seed("ADMIN");
    const credType = await seedCredentialType("CU_TYPE_HOLDER_PRESERVE");
    // Seed Dr. Jane as a separate PracticeUser (the holder) in the same practice.
    const holderUser = await db.user.create({
      data: {
        firebaseUid: `dj-${Math.random().toString(36).slice(2, 10)}`,
        email: `dj-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const drJane = await db.practiceUser.create({
      data: {
        userId: holderUser.id,
        practiceId: practice.id,
        role: "STAFF",
      },
    });
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        holderId: drJane.id,
        title: "AZ MD License",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    // Mirrors the Edit form: holderId is NOT in the payload.
    await updateCredentialAction({
      credentialId: cred.id,
      title: "AZ MD License (renewed)",
      licenseNumber: null,
      issuingBody: null,
      issueDate: null,
      expiryDate: null,
      notes: null,
    });
    const after = await db.credential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.holderId).toBe(drJane.id);
    expect(after.title).toBe("AZ MD License (renewed)");
  });

  it("clears holderId when payload explicitly passes null (audit #21 CR-1)", async () => {
    const { practice } = await seed("ADMIN");
    const credType = await seedCredentialType("CU_TYPE_HOLDER_CLEAR");
    const holderUser = await db.user.create({
      data: {
        firebaseUid: `hc-${Math.random().toString(36).slice(2, 10)}`,
        email: `hc-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const drJane = await db.practiceUser.create({
      data: { userId: holderUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        holderId: drJane.id,
        title: "Practice-level after clear",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await updateCredentialAction({
      credentialId: cred.id,
      holderId: null,
      title: "Practice-level after clear",
      licenseNumber: null,
      issuingBody: null,
      issueDate: null,
      expiryDate: null,
      notes: null,
    });
    const after = await db.credential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.holderId).toBeNull();
  });

  // Audit #21 (Wave 4 D6): the `preserves holderId through Edit` test
  // above pins the codepath, but the Renew form sends a DIFFERENT
  // payload shape (new expiryDate + optional new licenseNumber) through
  // the same updateCredentialAction. CR-1 was reported against both the
  // Edit and Renew flows in production, so a payload-shaped Renew test
  // makes the use-case explicit and guards against future divergence
  // (e.g. if Renew ever gets its own action).
  it("preserves holderId through Renew flow (new expiryDate, holderId omitted) — audit #21 CR-1", async () => {
    const { practice } = await seed("ADMIN");
    const credType = await seedCredentialType("CU_TYPE_RENEW_HOLDER");
    const holderUser = await db.user.create({
      data: {
        firebaseUid: `rnh-${Math.random().toString(36).slice(2, 10)}`,
        email: `rnh-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const drJane = await db.practiceUser.create({
      data: {
        userId: holderUser.id,
        practiceId: practice.id,
        role: "STAFF",
      },
    });
    // Credential expiring soon — the row a user would Renew.
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        holderId: drJane.id,
        title: "AZ DEA Registration",
        licenseNumber: "DEA-AB1234567",
        issuingBody: "DEA",
        issueDate: new Date("2023-05-01"),
        expiryDate: new Date("2026-05-01"),
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    // Mirrors the Renew form: new expiryDate, possibly-rotated license
    // number, every other field carried through from `initial`. holderId
    // is NOT in the Renew form's payload — the regression is that
    // updateCredentialAction must default it from the existing row.
    await updateCredentialAction({
      credentialId: cred.id,
      title: "AZ DEA Registration",
      licenseNumber: "DEA-AB1234567",
      issuingBody: "DEA",
      issueDate: "2026-05-01",
      expiryDate: "2029-05-01",
      notes: null,
    });
    const after = await db.credential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.holderId).toBe(drJane.id);
    expect(after.expiryDate?.toISOString()).toContain("2029-05-01");
    // Title untouched — confirms Renew didn't accidentally clear other
    // fields the form carried through.
    expect(after.title).toBe("AZ DEA Registration");
  });

  it("preserves the credential's original credentialTypeCode (not editable)", async () => {
    const { practice } = await seed("OWNER");
    const credType = await seedCredentialType("CU_TYPE_PRESERVED");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Type-preserved credential",
      },
    });
    const { updateCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await updateCredentialAction({
      credentialId: cred.id,
      title: "Edited title",
      licenseNumber: null,
      issuingBody: null,
      issueDate: null,
      expiryDate: null,
      notes: null,
    });
    const after = await db.credential.findUniqueOrThrow({
      where: { id: cred.id },
      include: { credentialType: true },
    });
    expect(after.credentialType.code).toBe("CU_TYPE_PRESERVED");
    expect(after.title).toBe("Edited title");
  });
});
