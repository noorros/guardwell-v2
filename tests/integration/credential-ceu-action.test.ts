// tests/integration/credential-ceu-action.test.ts
//
// Integration tests for logCeuActivityAction + removeCeuActivityAction.
// Covers happy path, cross-tenant guard, and soft-delete via remove.
// Pattern mirrors dea-form-106-pdf.test.ts (vi.mock auth + signInAs).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

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

// next/cache's revalidatePath() requires a Next.js request context that
// vitest doesn't provide. Stubbed to a no-op for these tests.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

declare global {
  var __testUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

beforeEach(() => {
  globalThis.__testUser = null;
});

async function seedPracticeWithCredential(name: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `ceu-action-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: { name, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const credType = await db.credentialType.create({
    data: {
      code: `TEST_TYPE_${Math.random().toString(36).slice(2, 8)}`,
      name: "Test CEU Credential Type",
      category: "BOARD_CERTIFICATION",
      ceuRequirementHours: 30,
      ceuRequirementWindowMonths: 24,
    },
  });
  const credential = await db.credential.create({
    data: {
      practiceId: practice.id,
      credentialTypeId: credType.id,
      title: "Test holder · CMA",
      issueDate: new Date("2024-01-01T00:00:00Z"),
      expiryDate: new Date("2026-01-01T00:00:00Z"),
    },
  });
  return { user, practice, credential, credType };
}

function signInAs(user: { id: string; email: string; firebaseUid: string }) {
  globalThis.__testUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
}

describe("logCeuActivityAction", () => {
  it("logs a CEU activity with correct fields", async () => {
    const { user, credential } = await seedPracticeWithCredential(
      "CEU Action Practice",
    );
    signInAs(user);

    const ceuActivityId = randomUUID();
    const { logCeuActivityAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    const res = await logCeuActivityAction({
      ceuActivityId,
      credentialId: credential.id,
      activityName: "Pharmacology Refresher",
      provider: "AAMA Online",
      activityDate: new Date("2026-04-15T10:00:00Z").toISOString(),
      hoursAwarded: 4.5,
      category: "Pharmacology",
      notes: null,
    });
    expect(res.ceuActivityId).toBe(ceuActivityId);

    const row = await db.ceuActivity.findUnique({
      where: { id: ceuActivityId },
    });
    expect(row).not.toBeNull();
    expect(row?.activityName).toBe("Pharmacology Refresher");
    expect(row?.provider).toBe("AAMA Online");
    expect(row?.hoursAwarded).toBe(4.5);
    expect(row?.category).toBe("Pharmacology");
    expect(row?.retiredAt).toBeNull();
    expect(row?.credentialId).toBe(credential.id);
  });

  it("rejects logging against a credential in a different practice", async () => {
    const { user: u1 } = await seedPracticeWithCredential("Practice One");
    const { credential: c2 } = await seedPracticeWithCredential(
      "Practice Two",
    );
    signInAs(u1);

    const { logCeuActivityAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      logCeuActivityAction({
        ceuActivityId: randomUUID(),
        credentialId: c2.id,
        activityName: "Cross-tenant attempt",
        activityDate: new Date("2026-04-15T10:00:00Z").toISOString(),
        hoursAwarded: 2,
      }),
    ).rejects.toThrow(/not found/i);

    // No row should be written
    const count = await db.ceuActivity.count({
      where: { credentialId: c2.id },
    });
    expect(count).toBe(0);
  });
});

describe("removeCeuActivityAction", () => {
  it("soft-deletes the activity by setting retiredAt", async () => {
    const { user, credential } = await seedPracticeWithCredential(
      "CEU Remove Practice",
    );
    signInAs(user);

    // First, log an activity
    const ceuActivityId = randomUUID();
    const { logCeuActivityAction, removeCeuActivityAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await logCeuActivityAction({
      ceuActivityId,
      credentialId: credential.id,
      activityName: "To be removed",
      activityDate: new Date("2026-03-01T10:00:00Z").toISOString(),
      hoursAwarded: 2,
    });

    const before = await db.ceuActivity.findUnique({
      where: { id: ceuActivityId },
    });
    expect(before?.retiredAt).toBeNull();

    // Now remove it
    await removeCeuActivityAction({
      ceuActivityId,
      removedReason: "Duplicate",
    });

    const after = await db.ceuActivity.findUnique({
      where: { id: ceuActivityId },
    });
    expect(after?.retiredAt).not.toBeNull();
    // Activity name still preserved (soft-delete, not hard delete)
    expect(after?.activityName).toBe("To be removed");
  });
});
