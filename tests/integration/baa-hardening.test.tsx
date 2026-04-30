// tests/integration/baa-hardening.test.ts
//
// Integration tests for the audit #21 Wave 4 D3 bundle (2026-04-30):
//   * C-4 — rate-limit hits 429 once budget is consumed
//   * M-5 — every refused token attempt produces a BAA_TOKEN_REJECTED
//          event row (or unknown-token warn for missing tokens)
//   * M-2 — vendor-baa-register PDF lists retired vendors in its own
//          section
//   * M-4 — BAA actions (executeBaaAction, sendBaaAction,
//          startBaaDraftAction) fire revalidatePath("/modules/hipaa")
//
// Patterns:
//   * vi.mock("next/headers") supplies fake x-forwarded-for / user-agent
//   * vi.mock("next/cache").revalidatePath = vi.fn — assertions are made
//     directly on the mock fn's call list
//   * vi.mock("next/navigation").redirect — stubbed to a no-op vi.fn so
//     the action can complete

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectBaaDraftUploaded,
  projectBaaSentToVendor,
} from "@/lib/events/projections/baa";

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      globalThis.__testHeaders?.[name.toLowerCase()] ?? null,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
  revalidateTag: () => undefined,
}));

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

declare global {
  var __testHeaders: Record<string, string> | undefined;
  var __testUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

beforeEach(() => {
  globalThis.__testHeaders = {
    "x-forwarded-for": "203.0.113.42",
    "user-agent": "BaaHardeningTest/1.0",
  };
  globalThis.__testUser = null;
  revalidatePathMock.mockClear();
});

async function seedSentBaa(args: {
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
      email: `baa-h-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: { name: "Hardening Practice", primaryState: "AZ" },
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

// ────────────────────────────────────────────────────────────────────
// M-5 — BAA_TOKEN_REJECTED event emission on refused attempts
// ────────────────────────────────────────────────────────────────────
describe("BAA token rejection logging (audit #21 M-5)", () => {
  it("logs BAA_TOKEN_REJECTED with reason=REVOKED when token is revoked", async () => {
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

    const events = await db.eventLog.findMany({
      where: { practiceId: ctx.practice.id, type: "BAA_TOKEN_REJECTED" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]!;
    const payload = last.payload as Record<string, unknown>;
    expect(payload.reason).toBe("REVOKED");
    expect(payload.baaRequestId).toBe(ctx.baaRequestId);
    expect(payload.tokenId).toBe(ctx.tokenId);
    expect(payload.ip).toBe("203.0.113.42");
    expect(payload.userAgent).toBe("BaaHardeningTest/1.0");
    // tokenHash is sha256[:12] — never the plaintext token.
    expect(typeof payload.tokenHash).toBe("string");
    expect(payload.tokenHash).toMatch(/^[0-9a-f]{12}$/);
    expect(payload.tokenHash).not.toBe(ctx.token);
  });

  it("logs reason=EXPIRED when token has passed its TTL", async () => {
    const ctx = await seedSentBaa();
    await db.baaAcceptanceToken.update({
      where: { id: ctx.tokenId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
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

    const events = await db.eventLog.findMany({
      where: { practiceId: ctx.practice.id, type: "BAA_TOKEN_REJECTED" },
    });
    const reasons = events.map(
      (e) => (e.payload as Record<string, unknown>).reason,
    );
    expect(reasons).toContain("EXPIRED");
  });

  it("logs reason=ALREADY_CONSUMED on a re-submit", async () => {
    const ctx = await seedSentBaa();
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

    await expect(
      executeBaaAction({
        token: ctx.token,
        baaRequestId: ctx.baaRequestId,
        tokenId: ctx.tokenId,
        vendorSignatureName: "Jane Vendor",
        vendorEmail: "vendor@acme.test",
      }),
    ).rejects.toThrow(/already used/i);

    const events = await db.eventLog.findMany({
      where: { practiceId: ctx.practice.id, type: "BAA_TOKEN_REJECTED" },
    });
    const reasons = events.map(
      (e) => (e.payload as Record<string, unknown>).reason,
    );
    expect(reasons).toContain("ALREADY_CONSUMED");
  });

  it("logs reason=EMAIL_MISMATCH when typed email does not match recipient", async () => {
    const ctx = await seedSentBaa({ recipientEmail: "real@acme.test" });
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

    const events = await db.eventLog.findMany({
      where: { practiceId: ctx.practice.id, type: "BAA_TOKEN_REJECTED" },
    });
    const reasons = events.map(
      (e) => (e.payload as Record<string, unknown>).reason,
    );
    expect(reasons).toContain("EMAIL_MISMATCH");
  });

  it("does NOT persist the plaintext token in any logged event", async () => {
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
    ).rejects.toThrow();

    const events = await db.eventLog.findMany({
      where: { type: "BAA_TOKEN_REJECTED" },
    });
    for (const ev of events) {
      const serialized = JSON.stringify(ev.payload);
      expect(serialized).not.toContain(ctx.token);
    }
  });

  it("warns (does NOT write EventLog) when the token is unknown — no resolvable practiceId", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { executeBaaAction } = await import(
        "@/app/accept-baa/[token]/actions"
      );
      await expect(
        executeBaaAction({
          token: "this-token-does-not-exist-xyz",
          baaRequestId: "fake-baa",
          tokenId: "fake-token-id",
          vendorSignatureName: "Jane Vendor",
          vendorEmail: "vendor@acme.test",
        }),
      ).rejects.toThrow(/invalid link/i);

      const allRejected = await db.eventLog.findMany({
        where: { type: "BAA_TOKEN_REJECTED" },
      });
      expect(allRejected).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
      // The warn line must contain the hash, NOT the plaintext token.
      const calls = warnSpy.mock.calls.flat().join(" ");
      expect(calls).not.toContain("this-token-does-not-exist-xyz");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// C-4 — Rate-limit blocks executeBaaAction once budget is consumed
// ────────────────────────────────────────────────────────────────────
describe("BAA token rate-limit (audit #21 C-4)", () => {
  it("throws RATE_LIMITED when the limiter denies the request", async () => {
    const { __setBaaRatelimiterForTests } = await import(
      "@/lib/baa/rateLimit"
    );
    // Inject a mock limiter that always denies. UPSTASH_DISABLE=1 (set
    // in tests/setup.ts) normally short-circuits the limiter; flip it
    // off for this test only and then restore.
    const prior = process.env.UPSTASH_DISABLE;
    process.env.UPSTASH_DISABLE = "";
    __setBaaRatelimiterForTests({
      limit: async () => ({ success: false, reset: Date.now() + 5 * 60_000 }),
    });
    try {
      const ctx = await seedSentBaa();
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
      ).rejects.toThrow(/RATE_LIMITED/);

      // Token must still be SENT — rate-limit happens BEFORE any DB write.
      const baa = await db.baaRequest.findUnique({
        where: { id: ctx.baaRequestId },
      });
      expect(baa?.status).toBe("SENT");
    } finally {
      __setBaaRatelimiterForTests(null);
      process.env.UPSTASH_DISABLE = prior ?? "1";
    }
  });

  it("allows the request when the limiter returns success=true", async () => {
    const { __setBaaRatelimiterForTests } = await import(
      "@/lib/baa/rateLimit"
    );
    const prior = process.env.UPSTASH_DISABLE;
    process.env.UPSTASH_DISABLE = "";
    __setBaaRatelimiterForTests({
      limit: async () => ({ success: true, reset: Date.now() + 1000 }),
    });
    try {
      const ctx = await seedSentBaa();
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
    } finally {
      __setBaaRatelimiterForTests(null);
      process.env.UPSTASH_DISABLE = prior ?? "1";
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// M-4 — revalidatePath("/modules/hipaa") fires after BAA actions
// ────────────────────────────────────────────────────────────────────
describe("BAA actions revalidate /modules/hipaa (audit #21 M-4)", () => {
  it("executeBaaAction calls revalidatePath('/modules/hipaa') on success", async () => {
    const ctx = await seedSentBaa();
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
    expect(revalidatePathMock).toHaveBeenCalledWith("/modules/hipaa");
  });

  it("startBaaDraftAction calls revalidatePath('/modules/hipaa')", async () => {
    const ctx = await seedSentBaa();
    globalThis.__testUser = ctx.user;
    const { startBaaDraftAction } = await import(
      "@/app/(dashboard)/programs/vendors/[id]/actions"
    );
    await startBaaDraftAction({
      vendorId: ctx.vendor.id,
      baaRequestId: randomUUID(),
      draftEvidenceId: null,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/modules/hipaa");
  });

  it("sendBaaAction calls revalidatePath('/modules/hipaa')", async () => {
    const ctx = await seedSentBaa();
    globalThis.__testUser = ctx.user;
    const { sendBaaAction } = await import(
      "@/app/(dashboard)/programs/vendors/[id]/actions"
    );
    await sendBaaAction({
      baaRequestId: ctx.baaRequestId,
      tokenId: randomUUID(),
      recipientEmail: "vendor@acme.test",
      recipientMessage: null,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/modules/hipaa");
  });
});

// ────────────────────────────────────────────────────────────────────
// M-2 — Vendor BAA register PDF includes retired vendors
// ────────────────────────────────────────────────────────────────────
describe("Vendor BAA register PDF retired section (audit #21 M-2)", () => {
  it("renders a 'Retired BAAs' section with the retired vendor's name", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { VendorBaaRegisterDocument } = await import(
      "@/lib/audit/vendor-baa-register-pdf"
    );
    const { extractInflatedText } = await import("./utils/pdf-text");

    const buffer = await renderToBuffer(
      <VendorBaaRegisterDocument
        input={{
          practiceName: "Retired Section Test",
          practiceState: "AZ",
          practiceTimezone: "America/Phoenix",
          generatedAt: new Date("2026-04-30T12:00:00Z"),
          vendors: [
            {
              name: "Active Cloud Vendor",
              type: "Storage",
              service: "object storage",
              processesPhi: true,
              baaDirection: null,
              baaExecutedAt: new Date("2025-05-01T00:00:00Z"),
              baaExpiresAt: null,
              retiredAt: null,
            },
          ],
          retiredVendors: [
            {
              name: "Old Defunct Vendor",
              type: "EHR",
              service: "former EHR provider",
              processesPhi: true,
              baaDirection: null,
              baaExecutedAt: new Date("2022-01-15T00:00:00Z"),
              baaExpiresAt: null,
              retiredAt: new Date("2024-09-30T00:00:00Z"),
            },
          ],
        }}
      />,
    );

    const text = extractInflatedText(new Uint8Array(buffer));
    // Header for the new section is present.
    expect(text).toMatch(/Retired BAAs/);
    // The retired vendor's name appears.
    expect(text).toContain("Old Defunct Vendor");
    // The active vendor still renders too.
    expect(text).toContain("Active Cloud Vendor");
    // The §164.530(j) retention note is present.
    expect(text).toMatch(/164\.530/);
  });

  it("does NOT render the retired section when retiredVendors is empty", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { VendorBaaRegisterDocument } = await import(
      "@/lib/audit/vendor-baa-register-pdf"
    );
    const { extractInflatedText } = await import("./utils/pdf-text");

    const buffer = await renderToBuffer(
      <VendorBaaRegisterDocument
        input={{
          practiceName: "No Retired Test",
          practiceState: "AZ",
          practiceTimezone: "America/Phoenix",
          generatedAt: new Date("2026-04-30T12:00:00Z"),
          vendors: [
            {
              name: "Lone Active Vendor",
              type: "Storage",
              service: "S3-compatible",
              processesPhi: true,
              baaDirection: null,
              baaExecutedAt: new Date("2025-05-01T00:00:00Z"),
              baaExpiresAt: null,
              retiredAt: null,
            },
          ],
          retiredVendors: [],
        }}
      />,
    );

    const text = extractInflatedText(new Uint8Array(buffer));
    expect(text).toContain("Lone Active Vendor");
    // Retired-section header should NOT appear.
    expect(text).not.toMatch(/Retired BAAs/);
  });
});
