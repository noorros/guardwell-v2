// src/lib/email/suppression.test.ts
//
// Phase 7 PR 9 — covers the read + write helpers used by the Resend
// webhook + sendEmail's pre-send guard. Real Postgres test DB; the
// global afterEach in tests/setup.ts wipes EmailSuppression rows.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { isSuppressed, suppressEmail } from "./suppression";

describe("EmailSuppression helpers", () => {
  it("isSuppressed returns false for an address we've never seen", async () => {
    expect(await isSuppressed(`fresh-${Math.random()}@test.test`)).toBe(false);
  });

  it("after suppressEmail, isSuppressed returns true for that address", async () => {
    const email = `bounced-${Math.random()}@test.test`;
    await suppressEmail({ email, reason: "BOUNCE", resendId: "msg_test" });
    expect(await isSuppressed(email)).toBe(true);
  });

  it("suppressEmail is idempotent — second call doesn't error and doesn't move the timestamp", async () => {
    const email = `dup-${Math.random()}@test.test`;
    await suppressEmail({ email, reason: "BOUNCE", resendId: "msg_first" });
    const first = await db.emailSuppression.findUnique({ where: { email } });
    expect(first).not.toBeNull();

    // Wait a tick so any timestamp-mutating bug would be visible.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await suppressEmail({ email, reason: "COMPLAINT", resendId: "msg_second" });

    const second = await db.emailSuppression.findUnique({ where: { email } });
    expect(second).not.toBeNull();
    // Earliest cause + timestamp + resendId preserved on replay.
    expect(second!.reason).toBe("BOUNCE");
    expect(second!.resendId).toBe("msg_first");
    expect(second!.suppressedAt.getTime()).toBe(first!.suppressedAt.getTime());
  });

  it("stores email lowercased regardless of input casing", async () => {
    const upper = `Foo-${Math.random()}@Bar.COM`;
    await suppressEmail({ email: upper, reason: "BOUNCE" });
    const row = await db.emailSuppression.findUnique({
      where: { email: upper.toLowerCase() },
    });
    expect(row).not.toBeNull();
    expect(row!.email).toBe(upper.toLowerCase());
  });

  it("isSuppressed lookup is case-insensitive (mixed-case query hits lowercase row)", async () => {
    const stamped = `cASe-${Math.random()}@TEST.test`;
    await suppressEmail({ email: stamped.toLowerCase(), reason: "BOUNCE" });
    expect(await isSuppressed(stamped)).toBe(true);
  });
});
