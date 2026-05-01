// src/lib/email/send.test.ts
//
// Phase 7 PR 9 — covers the new pre-send suppression gate in
// sendEmail. We mock the `resend` SDK so no real API traffic happens,
// and temporarily set RESEND_API_KEY so the post-suppression path
// would actually try to invoke the client (proving the gate is what
// short-circuits, not the missing-key fallback above it).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";

const mockSend = vi.fn();

vi.mock("resend", () => {
  // Real `new`-able class so `new Resend(key)` in the SUT works.
  class Resend {
    public emails = { send: mockSend };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_apiKey: string) {}
  }
  return { Resend };
});

// Import AFTER the mock so the module under test resolves to the stub.
import { sendEmail } from "./send";
import { suppressEmail } from "./suppression";

describe("sendEmail with EmailSuppression gate", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: "msg_test" }, error: null });
    // tests/setup.ts deletes RESEND_API_KEY globally; restore it here so
    // the suppression branch is the ONLY thing that can short-circuit.
    process.env.RESEND_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("returns recipient-suppressed and does NOT call Resend when address is on the denylist", async () => {
    const email = `bounced-${Math.random()}@test.test`;
    await suppressEmail({ email, reason: "BOUNCE", resendId: "msg_old" });

    const result = await sendEmail({
      to: email,
      subject: "should be skipped",
      text: "ignored",
    });

    expect(result).toEqual({
      delivered: false,
      providerId: null,
      reason: "recipient suppressed",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("proceeds normally for an address that is NOT suppressed", async () => {
    const email = `clean-${Math.random()}@test.test`;
    // Sanity: confirm no row exists
    expect(
      await db.emailSuppression.findUnique({ where: { email } }),
    ).toBeNull();

    const result = await sendEmail({
      to: email,
      subject: "hello",
      text: "world",
    });

    expect(result.delivered).toBe(true);
    expect(result.providerId).toBe("msg_test");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]![0]).toMatchObject({
      to: email,
      subject: "hello",
      text: "world",
    });
  });

  it("matches case-insensitively — uppercase recipient hits a lowercased suppression row", async () => {
    const stored = `mixed-${Math.random()}@test.test`;
    await suppressEmail({ email: stored, reason: "COMPLAINT" });

    const result = await sendEmail({
      to: stored.toUpperCase(),
      subject: "case-test",
      text: "should suppress",
    });

    expect(result.reason).toBe("recipient suppressed");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
