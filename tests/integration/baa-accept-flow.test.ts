// tests/integration/baa-accept-flow.test.ts
//
// Integration tests for the public /accept-baa/[token] flow — the
// executeBaaAction in particular. The full RSC + form path can't be
// driven from vitest (no Next.js request context), but the action is
// the core of the flow and is fully exercisable here.
//
// Patterns:
//   - vi.mock("next/headers", ...) supplies fake x-forwarded-for /
//     x-real-ip / user-agent headers so the action records realistic
//     signature metadata.
//   - vi.mock("next/navigation", () => ({ redirect: ... })) stubs the
//     redirect call at the end of the action so it doesn't crash the
//     test runner.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectBaaDraftUploaded,
  projectBaaSentToVendor,
} from "@/lib/events/projections/baa";

// Stub next/headers — vitest provides no Next request context so the
// real implementation throws. Each test sets globalThis.__testHeaders
// before invoking the action.
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      globalThis.__testHeaders?.[name.toLowerCase()] ?? null,
  }),
}));

// Stub next/navigation's redirect so the action can call redirect()
// without throwing. The real redirect throws a NEXT_REDIRECT error;
// in the test we just record the call.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// next/cache's revalidatePath() requires a Next request context.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

declare global {
  var __testHeaders: Record<string, string> | undefined;
}

beforeEach(() => {
  globalThis.__testHeaders = {
    "x-forwarded-for": "203.0.113.42, 198.51.100.7",
    "user-agent": "Mozilla/5.0 (Test BAA Vendor)",
  };
});

async function seedSentBaa(args: {
  practiceName?: string;
  recipientEmail?: string | null;
  tokenExpiresInMs?: number;
} = {}): Promise<{
  practice: { id: string; name: string };
  vendor: { id: string };
  user: { id: string; email: string; firebaseUid: string };
  baaRequestId: string;
  tokenId: string;
  token: string;
}> {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-flow-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: {
      name: args.practiceName ?? "Accept-Flow Practice",
      primaryState: "AZ",
    },
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

  // Emit DRAFT then SENT to set up an active token.
  const baaRequestId = randomUUID();
  const draftPayload = {
    baaRequestId,
    vendorId: vendor.id,
    draftEvidenceId: null,
  };
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "BAA_DRAFT_UPLOADED",
      payload: draftPayload,
    },
    async (tx) =>
      projectBaaDraftUploaded(tx, {
        practiceId: practice.id,
        payload: draftPayload,
      }),
  );

  const tokenId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenExpiresAt = new Date(
    Date.now() + (args.tokenExpiresInMs ?? 30 * 24 * 60 * 60 * 1000),
  );
  const recipientEmail =
    args.recipientEmail === undefined
      ? "vendor@acme.test"
      : args.recipientEmail;
  const sentPayload = {
    baaRequestId,
    tokenId,
    token,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    recipientEmail: recipientEmail ?? "fallback@acme.test",
    recipientMessage: null,
  };
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "BAA_SENT_TO_VENDOR",
      payload: sentPayload,
    },
    async (tx) =>
      projectBaaSentToVendor(tx, {
        practiceId: practice.id,
        payload: sentPayload,
      }),
  );

  // If caller wanted a null recipientEmail, clear it on the BaaRequest
  // post-hoc (the projection requires email to be set in the event but
  // we want to test "no recipient" branch). Direct DB edit keeps the
  // test focused on the action's own validation.
  if (args.recipientEmail === null) {
    await db.baaRequest.update({
      where: { id: baaRequestId },
      data: { recipientEmail: null },
    });
  }

  return {
    practice: { id: practice.id, name: practice.name },
    vendor: { id: vendor.id },
    user: {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid,
    },
    baaRequestId,
    tokenId,
    token,
  };
}

describe("executeBaaAction (public /accept-baa flow)", () => {
  it("happy path — transitions SENT -> EXECUTED and persists signature metadata", async () => {
    const ctx = await seedSentBaa({ practiceName: "Happy Path Practice" });

    const { executeBaaAction } = await import(
      "@/app/accept-baa/[token]/actions"
    );
    await executeBaaAction({
      token: ctx.token,
      baaRequestId: ctx.baaRequestId,
      tokenId: ctx.tokenId,
      vendorSignatureName: "Jane Vendor",
      vendorEmail: "vendor@acme.test",
    });

    const baa = await db.baaRequest.findUnique({
      where: { id: ctx.baaRequestId },
    });
    expect(baa?.status).toBe("EXECUTED");
    expect(baa?.executedAt).not.toBeNull();
    expect(baa?.vendorSignatureName).toBe("Jane Vendor");
    // First IP in x-forwarded-for is the client; trim the spaces.
    expect(baa?.vendorSignatureIp).toBe("203.0.113.42");
    expect(baa?.vendorSignatureUserAgent).toBe("Mozilla/5.0 (Test BAA Vendor)");

    // Token must be consumed.
    const token = await db.baaAcceptanceToken.findUnique({
      where: { id: ctx.tokenId },
    });
    expect(token?.consumedAt).not.toBeNull();

    // Vendor side-effect updates baaExecutedAt.
    const vendor = await db.vendor.findUnique({ where: { id: ctx.vendor.id } });
    expect(vendor?.baaExecutedAt).not.toBeNull();
  });

  it("rejects when typed email does not match recipientEmail (case-insensitive)", async () => {
    const ctx = await seedSentBaa({
      recipientEmail: "real-vendor@acme.test",
    });

    const { executeBaaAction } = await import(
      "@/app/accept-baa/[token]/actions"
    );
    await expect(
      executeBaaAction({
        token: ctx.token,
        baaRequestId: ctx.baaRequestId,
        tokenId: ctx.tokenId,
        vendorSignatureName: "Sneaky Sam",
        vendorEmail: "different@acme.test",
      }),
    ).rejects.toThrow(/does not match/i);

    const baa = await db.baaRequest.findUnique({
      where: { id: ctx.baaRequestId },
    });
    expect(baa?.status).toBe("SENT");
  });

  it("rejects a re-submit on an already-consumed token", async () => {
    const ctx = await seedSentBaa();
    const { executeBaaAction } = await import(
      "@/app/accept-baa/[token]/actions"
    );

    // First execute succeeds.
    await executeBaaAction({
      token: ctx.token,
      baaRequestId: ctx.baaRequestId,
      tokenId: ctx.tokenId,
      vendorSignatureName: "Jane Vendor",
      vendorEmail: "vendor@acme.test",
    });

    // Second execute must throw "already used".
    await expect(
      executeBaaAction({
        token: ctx.token,
        baaRequestId: ctx.baaRequestId,
        tokenId: ctx.tokenId,
        vendorSignatureName: "Jane Vendor",
        vendorEmail: "vendor@acme.test",
      }),
    ).rejects.toThrow(/already used/i);
  });

  it("rejects when the token has expired", async () => {
    const ctx = await seedSentBaa();
    // Backdate the token to 1 minute ago.
    await db.baaAcceptanceToken.update({
      where: { id: ctx.tokenId },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) },
    });

    const { executeBaaAction } = await import(
      "@/app/accept-baa/[token]/actions"
    );
    await expect(
      executeBaaAction({
        token: ctx.token,
        baaRequestId: ctx.baaRequestId,
        tokenId: ctx.tokenId,
        vendorSignatureName: "Jane Vendor",
        vendorEmail: "vendor@acme.test",
      }),
    ).rejects.toThrow(/expired/i);

    const baa = await db.baaRequest.findUnique({
      where: { id: ctx.baaRequestId },
    });
    expect(baa?.status).toBe("SENT");
  });

  it("rejects when the token has been revoked", async () => {
    const ctx = await seedSentBaa();
    await db.baaAcceptanceToken.update({
      where: { id: ctx.tokenId },
      data: { revokedAt: new Date() },
    });

    const { executeBaaAction } = await import(
      "@/app/accept-baa/[token]/actions"
    );
    await expect(
      executeBaaAction({
        token: ctx.token,
        baaRequestId: ctx.baaRequestId,
        tokenId: ctx.tokenId,
        vendorSignatureName: "Jane Vendor",
        vendorEmail: "vendor@acme.test",
      }),
    ).rejects.toThrow(/revoked/i);

    const baa = await db.baaRequest.findUnique({
      where: { id: ctx.baaRequestId },
    });
    expect(baa?.status).toBe("SENT");
  });
});
