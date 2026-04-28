// tests/integration/baa-projection.test.ts
//
// Projection tests for BAA lifecycle events introduced in chunk 6
// Phase A. Mirrors the credential-ceu-projection.test.ts pattern.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectBaaDraftUploaded,
  projectBaaSentToVendor,
  projectBaaAcknowledgedByVendor,
  projectBaaExecutedByVendor,
  projectBaaRejectedByVendor,
} from "@/lib/events/projections/baa";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "BAA Projection Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const vendor = await db.vendor.create({
    data: {
      practiceId: practice.id,
      name: "Acme Cloud Storage",
      type: "Storage",
      service: "S3-compatible object storage",
      contact: "Vendor Contact",
      email: "contact@acme.test",
      processesPhi: true,
    },
  });
  return { user, practice, vendor };
}

async function emitDraftUploaded(args: {
  user: { id: string };
  practice: { id: string };
  vendor: { id: string };
  baaRequestId: string;
}) {
  const payload = {
    baaRequestId: args.baaRequestId,
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
}

async function emitSentToVendor(args: {
  user: { id: string };
  practice: { id: string };
  baaRequestId: string;
  tokenId: string;
  token: string;
  recipientEmail: string;
}) {
  const payload = {
    baaRequestId: args.baaRequestId,
    tokenId: args.tokenId,
    token: args.token,
    tokenExpiresAt: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    recipientEmail: args.recipientEmail,
    recipientMessage: null,
  };
  await appendEventAndApply(
    {
      practiceId: args.practice.id,
      actorUserId: args.user.id,
      type: "BAA_SENT_TO_VENDOR",
      payload,
    },
    async (tx) =>
      projectBaaSentToVendor(tx, {
        practiceId: args.practice.id,
        payload,
      }),
  );
}

async function emitAcknowledged(args: {
  user: { id: string };
  practice: { id: string };
  baaRequestId: string;
  tokenId: string;
  acknowledgedAt: Date;
}) {
  const payload = {
    baaRequestId: args.baaRequestId,
    tokenId: args.tokenId,
    acknowledgedAt: args.acknowledgedAt.toISOString(),
  };
  await appendEventAndApply(
    {
      practiceId: args.practice.id,
      actorUserId: args.user.id,
      type: "BAA_ACKNOWLEDGED_BY_VENDOR",
      payload,
    },
    async (tx) =>
      projectBaaAcknowledgedByVendor(tx, {
        practiceId: args.practice.id,
        payload,
      }),
  );
}

describe("BAA projections", () => {
  it("BAA_DRAFT_UPLOADED creates a BaaRequest in DRAFT state", async () => {
    const { user, practice, vendor } = await seed();
    const baaRequestId = randomUUID();
    await emitDraftUploaded({ user, practice, vendor, baaRequestId });

    const row = await db.baaRequest.findUnique({ where: { id: baaRequestId } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("DRAFT");
    expect(row?.practiceId).toBe(practice.id);
    expect(row?.vendorId).toBe(vendor.id);
    expect(row?.draftUploadedAt).not.toBeNull();
    expect(row?.sentAt).toBeNull();
  });

  it("BAA_SENT_TO_VENDOR transitions DRAFT → SENT and creates a token", async () => {
    const { user, practice, vendor } = await seed();
    const baaRequestId = randomUUID();
    await emitDraftUploaded({ user, practice, vendor, baaRequestId });

    const tokenId = randomUUID();
    const tokenStr = `tok-${Math.random().toString(36).slice(2)}`;
    await emitSentToVendor({
      user,
      practice,
      baaRequestId,
      tokenId,
      token: tokenStr,
      recipientEmail: "contact@acme.test",
    });

    const updated = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(updated?.status).toBe("SENT");
    expect(updated?.sentAt).not.toBeNull();
    expect(updated?.recipientEmail).toBe("contact@acme.test");

    const token = await db.baaAcceptanceToken.findUnique({
      where: { id: tokenId },
    });
    expect(token).not.toBeNull();
    expect(token?.token).toBe(tokenStr);
    expect(token?.baaRequestId).toBe(baaRequestId);
    expect(token?.consumedAt).toBeNull();
    expect(token?.revokedAt).toBeNull();
  });

  it("BAA_ACKNOWLEDGED_BY_VENDOR transitions SENT → ACKNOWLEDGED idempotently", async () => {
    const { user, practice, vendor } = await seed();
    const baaRequestId = randomUUID();
    const tokenId = randomUUID();

    await emitDraftUploaded({ user, practice, vendor, baaRequestId });
    await emitSentToVendor({
      user,
      practice,
      baaRequestId,
      tokenId,
      token: `tok-${Math.random().toString(36).slice(2)}`,
      recipientEmail: "contact@acme.test",
    });

    const firstAckAt = new Date("2026-04-27T10:00:00Z");
    await emitAcknowledged({
      user,
      practice,
      baaRequestId,
      tokenId,
      acknowledgedAt: firstAckAt,
    });

    const afterFirst = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(afterFirst?.status).toBe("ACKNOWLEDGED");
    expect(afterFirst?.acknowledgedAt?.toISOString()).toBe(
      firstAckAt.toISOString(),
    );

    // Second emission is a no-op — acknowledgedAt should not change.
    const secondAckAt = new Date("2026-04-28T10:00:00Z");
    await emitAcknowledged({
      user,
      practice,
      baaRequestId,
      tokenId,
      acknowledgedAt: secondAckAt,
    });

    const afterSecond = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(afterSecond?.status).toBe("ACKNOWLEDGED");
    expect(afterSecond?.acknowledgedAt?.toISOString()).toBe(
      firstAckAt.toISOString(),
    );
  });

  it("BAA_EXECUTED_BY_VENDOR transitions to EXECUTED and updates Vendor.baaExecutedAt", async () => {
    const { user, practice, vendor } = await seed();
    const baaRequestId = randomUUID();
    const tokenId = randomUUID();

    await emitDraftUploaded({ user, practice, vendor, baaRequestId });
    await emitSentToVendor({
      user,
      practice,
      baaRequestId,
      tokenId,
      token: `tok-${Math.random().toString(36).slice(2)}`,
      recipientEmail: "contact@acme.test",
    });
    await emitAcknowledged({
      user,
      practice,
      baaRequestId,
      tokenId,
      acknowledgedAt: new Date("2026-04-27T09:00:00Z"),
    });

    const executedAt = new Date("2026-04-27T10:00:00Z");
    const expiresAt = new Date("2027-04-27T10:00:00Z");
    const executedPayload = {
      baaRequestId,
      tokenId,
      executedAt: executedAt.toISOString(),
      vendorSignatureName: "Jane Vendor",
      vendorSignatureIp: "192.0.2.42",
      vendorSignatureUserAgent: "Mozilla/5.0 (Test)",
      expiresAt: expiresAt.toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "BAA_EXECUTED_BY_VENDOR",
        payload: executedPayload,
      },
      async (tx) =>
        projectBaaExecutedByVendor(tx, {
          practiceId: practice.id,
          payload: executedPayload,
        }),
    );

    const baaRequest = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(baaRequest?.status).toBe("EXECUTED");
    expect(baaRequest?.executedAt?.toISOString()).toBe(executedAt.toISOString());
    expect(baaRequest?.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(baaRequest?.vendorSignatureName).toBe("Jane Vendor");
    expect(baaRequest?.vendorSignatureIp).toBe("192.0.2.42");
    expect(baaRequest?.vendorSignatureUserAgent).toBe("Mozilla/5.0 (Test)");

    // Vendor side-effect updates.
    const vendorRow = await db.vendor.findUnique({ where: { id: vendor.id } });
    expect(vendorRow?.baaExecutedAt?.toISOString()).toBe(
      executedAt.toISOString(),
    );
    expect(vendorRow?.baaExpiresAt?.toISOString()).toBe(expiresAt.toISOString());

    // Token consumed.
    const tokenRow = await db.baaAcceptanceToken.findUnique({
      where: { id: tokenId },
    });
    expect(tokenRow?.consumedAt).not.toBeNull();
  });

  it("BAA_REJECTED_BY_VENDOR transitions to REJECTED and consumes token", async () => {
    const { user, practice, vendor } = await seed();
    const baaRequestId = randomUUID();
    const tokenId = randomUUID();

    await emitDraftUploaded({ user, practice, vendor, baaRequestId });
    await emitSentToVendor({
      user,
      practice,
      baaRequestId,
      tokenId,
      token: `tok-${Math.random().toString(36).slice(2)}`,
      recipientEmail: "contact@acme.test",
    });
    await emitAcknowledged({
      user,
      practice,
      baaRequestId,
      tokenId,
      acknowledgedAt: new Date("2026-04-27T09:00:00Z"),
    });

    const rejectedAt = new Date("2026-04-27T10:30:00Z");
    const rejectedPayload = {
      baaRequestId,
      tokenId,
      rejectedAt: rejectedAt.toISOString(),
      reason: "Scope mismatch — please revise vendor responsibilities.",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "BAA_REJECTED_BY_VENDOR",
        payload: rejectedPayload,
      },
      async (tx) =>
        projectBaaRejectedByVendor(tx, {
          practiceId: practice.id,
          payload: rejectedPayload,
        }),
    );

    const baaRequest = await db.baaRequest.findUnique({
      where: { id: baaRequestId },
    });
    expect(baaRequest?.status).toBe("REJECTED");
    expect(baaRequest?.rejectedAt?.toISOString()).toBe(rejectedAt.toISOString());
    expect(baaRequest?.rejectionReason).toBe(
      "Scope mismatch — please revise vendor responsibilities.",
    );

    // Token consumed.
    const tokenRow = await db.baaAcceptanceToken.findUnique({
      where: { id: tokenId },
    });
    expect(tokenRow?.consumedAt).not.toBeNull();
  });
});
