// tests/integration/baa-send-action.test.ts
//
// Integration tests for sendBaaAction. Pattern mirrors
// credential-ceu-action.test.ts: vi.mock("@/lib/auth") + signInAs() +
// next/cache stub. Covers the happy path (DRAFT -> SENT + token row)
// and the cross-tenant guard.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectBaaDraftUploaded } from "@/lib/events/projections/baa";

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

async function seedPracticeWithVendor(name: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-action-${Math.random().toString(36).slice(2, 8)}@test.test`,
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
  const vendor = await db.vendor.create({
    data: {
      practiceId: practice.id,
      name: "Acme Cloud Storage",
      type: "Storage",
      email: "vendor@acme.test",
      processesPhi: true,
    },
  });
  return { user, practice, vendor };
}

async function seedDraftBaaRequest(args: {
  user: { id: string };
  practice: { id: string };
  vendor: { id: string };
}): Promise<string> {
  const baaRequestId = randomUUID();
  const payload = {
    baaRequestId,
    vendorId: args.vendor.id,
    draftEvidenceId: null,
  };
  await appendEventAndApply(
    {
      practiceId: args.practice.id,
      actorUserId: args.user.id,
      type: "BAA_DRAFT_UPLOADED",
      payload,
    },
    async (tx) =>
      projectBaaDraftUploaded(tx, {
        practiceId: args.practice.id,
        payload,
      }),
  );
  return baaRequestId;
}

function signInAs(user: { id: string; email: string; firebaseUid: string }) {
  globalThis.__testUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
}

describe("sendBaaAction", () => {
  it("transitions DRAFT -> SENT and creates an acceptance token", async () => {
    const { user, practice, vendor } = await seedPracticeWithVendor(
      "Send BAA Practice",
    );
    signInAs(user);

    const baaRequestId = await seedDraftBaaRequest({ user, practice, vendor });

    const tokenId = randomUUID();
    const { sendBaaAction } = await import(
      "@/app/(dashboard)/programs/vendors/[id]/actions"
    );
    const result = await sendBaaAction({
      baaRequestId,
      tokenId,
      recipientEmail: "vendor@acme.test",
      recipientMessage: "Please review the attached BAA.",
    });

    expect(result.tokenId).toBe(tokenId);
    // Email is no-op in tests (RESEND_API_KEY stripped in setup); the
    // contract is that the action still records the SENT transition.
    expect(typeof result.emailDelivered).toBe("boolean");

    const baaRequest = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(baaRequest?.status).toBe("SENT");
    expect(baaRequest?.sentAt).not.toBeNull();
    expect(baaRequest?.recipientEmail).toBe("vendor@acme.test");
    expect(baaRequest?.recipientMessage).toBe(
      "Please review the attached BAA.",
    );

    const token = await db.baaAcceptanceToken.findUnique({
      where: { id: tokenId },
    });
    expect(token).not.toBeNull();
    expect(token?.baaRequestId).toBe(baaRequestId);
    expect(token?.consumedAt).toBeNull();
    expect(token?.revokedAt).toBeNull();
    // 30-day TTL with a generous +/- 1-day window for clock skew.
    const expectedTtlMs = 30 * 24 * 60 * 60 * 1000;
    const actualTtlMs = token!.expiresAt.getTime() - Date.now();
    expect(actualTtlMs).toBeGreaterThan(expectedTtlMs - 24 * 60 * 60 * 1000);
    expect(actualTtlMs).toBeLessThan(expectedTtlMs + 24 * 60 * 60 * 1000);
    // Token string is base64url — at least 32 chars (43 chars for 32 random bytes).
    expect(token?.token.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects sending for a BAA request belonging to a different practice", async () => {
    const seed1 = await seedPracticeWithVendor("Practice One");
    const seed2 = await seedPracticeWithVendor("Practice Two");

    // Seed a draft BAA in practice 2.
    const baaRequestId = await seedDraftBaaRequest({
      user: seed2.user,
      practice: seed2.practice,
      vendor: seed2.vendor,
    });

    // Sign in as practice 1's user; attempt to send.
    signInAs(seed1.user);

    const { sendBaaAction } = await import(
      "@/app/(dashboard)/programs/vendors/[id]/actions"
    );
    await expect(
      sendBaaAction({
        baaRequestId,
        tokenId: randomUUID(),
        recipientEmail: "attacker@evil.test",
        recipientMessage: null,
      }),
    ).rejects.toThrow(/not found/i);

    // The original BAA request should still be DRAFT and have no tokens.
    const stillDraft = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(stillDraft?.status).toBe("DRAFT");
    const tokenCount = await db.baaAcceptanceToken.count({
      where: { baaRequestId },
    });
    expect(tokenCount).toBe(0);
  });
});
