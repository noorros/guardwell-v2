// tests/integration/resend-webhook.test.ts
//
// Phase 7 PR 9 — end-to-end coverage for /api/webhooks/resend.
//
// Strategy:
//   - Real Postgres (the global afterEach in tests/setup.ts wipes
//     EmailSuppression rows, just like every other table).
//   - Real Svix Webhook signing — we instantiate `new Webhook(secret)`
//     in the test, call .sign() to produce a valid signature header,
//     and POST it at the route handler.
//   - process.env.RESEND_WEBHOOK_SECRET is set per-test so we can also
//     exercise the not-configured branch.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/db";

import { POST } from "@/app/api/webhooks/resend/route";

// Resend's webhook secret format is `whsec_<base64>` — `whsec_dGVzdA==`
// decodes to "test", which is what the standardwebhooks/svix package
// uses internally for HMAC keying. Format is enforced by the constructor.
const SECRET = "whsec_dGVzdA==";

function buildSignedRequest(args: {
  body: object;
  msgId?: string;
  timestamp?: Date;
  secret?: string;
  overrideSignature?: string;
  omitHeader?: "svix-id" | "svix-timestamp" | "svix-signature";
}): NextRequest {
  const msgId = args.msgId ?? `msg_${Math.random().toString(36).slice(2, 12)}`;
  const timestamp = args.timestamp ?? new Date();
  const rawBody = JSON.stringify(args.body);

  const wh = new Webhook(args.secret ?? SECRET);
  const signature = args.overrideSignature ?? wh.sign(msgId, timestamp, rawBody);

  const headers = new Headers({
    "content-type": "application/json",
  });
  if (args.omitHeader !== "svix-id") headers.set("svix-id", msgId);
  if (args.omitHeader !== "svix-timestamp") {
    headers.set(
      "svix-timestamp",
      Math.floor(timestamp.getTime() / 1000).toString(),
    );
  }
  if (args.omitHeader !== "svix-signature") {
    headers.set("svix-signature", signature);
  }

  return new NextRequest("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("/api/webhooks/resend route", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("returns 503 when RESEND_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const req = buildSignedRequest({
      body: { type: "email.bounced", data: { to: ["x@test.test"] } },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toContain("RESEND_WEBHOOK_SECRET");
  });

  it("returns 400 when svix headers are missing", async () => {
    const req = buildSignedRequest({
      body: { type: "email.bounced", data: { to: ["x@test.test"] } },
      omitHeader: "svix-signature",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toContain("missing svix headers");
  });

  it("returns 401 when the signature is invalid", async () => {
    const req = buildSignedRequest({
      body: { type: "email.bounced", data: { to: ["x@test.test"] } },
      overrideSignature: "v1,Zm9vYmFy", // base64 "foobar" — bogus
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toContain("invalid signature");
  });

  it("returns 200 + creates a BOUNCE row on a valid email.bounced payload", async () => {
    const email = `bounce-${Math.random().toString(36).slice(2, 8)}@test.test`;
    const req = buildSignedRequest({
      body: { type: "email.bounced", data: { to: [email] } },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = await db.emailSuppression.findUnique({
      where: { email: email.toLowerCase() },
    });
    expect(row).not.toBeNull();
    expect(row!.reason).toBe("BOUNCE");
    expect(row!.resendId).not.toBeNull();
  });

  it("returns 200 + creates a COMPLAINT row on a valid email.complained payload", async () => {
    const email = `complaint-${Math.random().toString(36).slice(2, 8)}@test.test`;
    const req = buildSignedRequest({
      body: { type: "email.complained", data: { to: [email] } },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = await db.emailSuppression.findUnique({
      where: { email: email.toLowerCase() },
    });
    expect(row).not.toBeNull();
    expect(row!.reason).toBe("COMPLAINT");
  });

  it("returns 200 but creates NO row on email.delivered (analytics events ignored)", async () => {
    const email = `delivered-${Math.random().toString(36).slice(2, 8)}@test.test`;
    const req = buildSignedRequest({
      body: { type: "email.delivered", data: { to: [email] } },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = await db.emailSuppression.findUnique({
      where: { email: email.toLowerCase() },
    });
    expect(row).toBeNull();
  });

  it("replaying the same event id is idempotent — no duplicate rows, original cause preserved", async () => {
    const email = `replay-${Math.random().toString(36).slice(2, 8)}@test.test`;
    const msgId = `msg_replay_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date();

    const req1 = buildSignedRequest({
      body: { type: "email.bounced", data: { to: [email] } },
      msgId,
      timestamp,
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const firstRow = await db.emailSuppression.findUnique({
      where: { email: email.toLowerCase() },
    });
    expect(firstRow).not.toBeNull();

    // Wait so any timestamp-mutating bug would surface.
    await new Promise((r) => setTimeout(r, 5));

    const req2 = buildSignedRequest({
      body: { type: "email.bounced", data: { to: [email] } },
      msgId,
      timestamp,
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    const all = await db.emailSuppression.findMany({
      where: { email: email.toLowerCase() },
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.suppressedAt.getTime()).toBe(
      firstRow!.suppressedAt.getTime(),
    );
  });
});
