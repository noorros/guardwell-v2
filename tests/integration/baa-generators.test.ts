// tests/integration/baa-generators.test.ts
//
// Phase 7 PR 3 — coverage for the three BAA-lifecycle notification
// generators that replaced the old single generateVendorBaaNotifications:
//   - generateBaaSignaturePendingNotifications  (BAA_SIGNATURE_PENDING)
//   - generateBaaExpiringNotifications          (VENDOR_BAA_EXPIRING)
//   - generateBaaExecutedNotifications          (BAA_EXECUTED)
//
// Each describe block exercises the generator in isolation with a real
// DB seed. Recipients shifted from "all userIds" to OWNER + ADMIN only,
// so we explicitly test that STAFF do not receive these notifications.
//
// Mirrors the inline-seed shape from
// tests/integration/training-notifications.test.ts.

import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  generateBaaSignaturePendingNotifications,
  generateBaaExpiringNotifications,
  generateBaaExecutedNotifications,
} from "@/lib/notifications/generators";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `baa-gen-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-gen-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `BAA-Gen Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedAdditionalAdmin(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `baa-gen-admin-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-gen-admin-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Admin",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "ADMIN" },
  });
  return user;
}

async function seedStaff(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `baa-gen-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `baa-gen-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Staff",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return user;
}

async function seedVendor(
  practiceId: string,
  name: string,
  opts: { processesPhi?: boolean; baaExpiresAt?: Date | null } = {},
) {
  return db.vendor.create({
    data: {
      practiceId,
      name,
      type: "Cloud",
      service: "Test service",
      contact: "Test Contact",
      email: `${Math.random().toString(36).slice(2, 8)}@vendor.test`,
      processesPhi: opts.processesPhi ?? true,
      baaExpiresAt: opts.baaExpiresAt ?? null,
    },
  });
}

// -------------------------------------------------------------------------
// generateBaaSignaturePendingNotifications
// -------------------------------------------------------------------------

describe("generateBaaSignaturePendingNotifications", () => {
  it("fires for OWNER + ADMIN when a BAA is in SENT status", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("sent");
    const admin = await seedAdditionalAdmin(practice.id, "sent");
    const vendor = await seedVendor(practice.id, "Acme Cloud");
    const baa = await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "SENT",
        sentAt: new Date(Date.now() - 2 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id, admin.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(admin.id)).toBe(true);
    for (const p of proposals) {
      expect(p.type).toBe("BAA_SIGNATURE_PENDING");
      expect(p.severity).toBe("INFO");
      expect(p.entityKey).toBe(`baa-signature-pending:${baa.id}`);
      expect(p.title).toContain("Acme Cloud");
      expect(p.href).toBe("/programs/vendors");
    }
  });

  it("fires when a BAA is in ACKNOWLEDGED status", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("acked");
    const vendor = await seedVendor(practice.id, "Beta Storage");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "ACKNOWLEDGED",
        sentAt: new Date(Date.now() - 3 * DAY_MS),
        acknowledgedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.title).toContain("Beta Storage");
  });

  it("does NOT fire for DRAFT status (vendor hasn't been emailed)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("draft");
    const vendor = await seedVendor(practice.id, "Draft Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "DRAFT",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire for EXECUTED status", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("executed");
    const vendor = await seedVendor(practice.id, "Done Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 10 * DAY_MS),
        executedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire for REJECTED status", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("rejected");
    const vendor = await seedVendor(practice.id, "Rejected Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "REJECTED",
        sentAt: new Date(Date.now() - 5 * DAY_MS),
        rejectedAt: new Date(Date.now() - 1 * DAY_MS),
        rejectionReason: "Not interested",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT include STAFF users (only OWNER + ADMIN)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("staff-excl");
    const staff = await seedStaff(practice.id, "no-baa");
    const vendor = await seedVendor(practice.id, "Vendor X");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "SENT",
        sentAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(false);
  });

  it("severity is WARNING when sentAt > 7 days ago, INFO when recent", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("severity");
    const vendorOld = await seedVendor(practice.id, "Old Vendor");
    const vendorNew = await seedVendor(practice.id, "New Vendor");
    // +1h buffer keeps Math.floor((10d+1h)/DAY_MS) = 10, not 9.
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendorOld.id,
        status: "SENT",
        sentAt: new Date(Date.now() - 10 * DAY_MS - HOUR_MS),
      },
    });
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendorNew.id,
        status: "SENT",
        sentAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaSignaturePendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    const oldProposal = proposals.find((p) => p.title.includes("Old Vendor"));
    const newProposal = proposals.find((p) => p.title.includes("New Vendor"));
    expect(oldProposal?.severity).toBe("WARNING");
    expect(oldProposal?.body).toContain("Follow up");
    expect(newProposal?.severity).toBe("INFO");
  });
});

// -------------------------------------------------------------------------
// generateBaaExpiringNotifications
// -------------------------------------------------------------------------

describe("generateBaaExpiringNotifications", () => {
  it("fires milestone 60 (smallest unfired) for a vendor BAA expiring in 50 days", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exp-50d");
    // +1h buffer keeps Math.floor((50d+1h)/DAY_MS) = 50, not 49.
    const vendor = await seedVendor(practice.id, "Cloud 50d", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() + 50 * DAY_MS + HOUR_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("VENDOR_BAA_EXPIRING");
    expect(p.entityKey).toBe(`baa-expiring:${vendor.id}:60`);
    expect(p.severity).toBe("INFO");
    expect(p.title).toContain("Cloud 50d");
    expect(p.title).toContain("50 day");
  });

  it("fires milestone 7 (smallest unfired) for a vendor BAA expiring in 5 days", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exp-5d");
    const vendor = await seedVendor(practice.id, "Cloud 5d", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`baa-expiring:${vendor.id}:7`);
    expect(p.severity).toBe("WARNING");
  });

  it("fires CRITICAL when the vendor BAA has expired (-1 day)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exp-past");
    const vendor = await seedVendor(practice.id, "Expired Vendor", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() - 1 * DAY_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.severity).toBe("CRITICAL");
    expect(p.title).toContain("expired");
    expect(p.entityKey).toBe(`baa-expiring:${vendor.id}:7`);
  });

  it("does NOT fire for a vendor not processing PHI", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("no-phi");
    await seedVendor(practice.id, "No-PHI Vendor", {
      processesPhi: false,
      baaExpiresAt: new Date(Date.now() + 5 * DAY_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("respects a per-practice reminderSettings.baa override", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("override");
    // +1h buffer keeps Math.floor((100d+1h)/DAY_MS) = 100, not 99.
    const vendor = await seedVendor(practice.id, "Override Vendor", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() + 100 * DAY_MS + HOUR_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        { baa: [120, 90] },
      ),
    );

    // ascending milestones [90, 120], days=100. days <= 90? No. days <= 120? Yes → fires :120.
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`baa-expiring:${vendor.id}:120`);
  });

  it("does NOT include STAFF users (only OWNER + ADMIN)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exp-staff-excl");
    const staff = await seedStaff(practice.id, "no-baa-exp");
    await seedVendor(practice.id, "Some Vendor", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExpiringNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
        null,
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// generateBaaExecutedNotifications
// -------------------------------------------------------------------------

describe("generateBaaExecutedNotifications", () => {
  it("fires for a BAA executed yesterday", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exec-fresh");
    const admin = await seedAdditionalAdmin(practice.id, "exec-fresh");
    const vendor = await seedVendor(practice.id, "Fresh Vendor");
    const baa = await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 5 * DAY_MS),
        executedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExecutedNotifications(
        tx,
        practice.id,
        [owner.id, admin.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(admin.id)).toBe(true);
    for (const p of proposals) {
      expect(p.type).toBe("BAA_EXECUTED");
      expect(p.severity).toBe("INFO");
      expect(p.entityKey).toBe(`baa-executed:${baa.id}`);
      expect(p.title).toContain("Fresh Vendor");
    }
  });

  it("does NOT fire for a BAA executed 30 days ago (outside 14-day window)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exec-old");
    const vendor = await seedVendor(practice.id, "Old Exec Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 35 * DAY_MS),
        executedAt: new Date(Date.now() - 30 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExecutedNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire when status=EXECUTED but executedAt is null (defensive)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exec-null");
    const vendor = await seedVendor(practice.id, "Null Exec Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 5 * DAY_MS),
        executedAt: null,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExecutedNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    // The where filter requires executedAt: { gte: cutoff }, so a NULL
    // executedAt is excluded at the query level. The defensive `if
    // (!r.executedAt) continue` is a belt-and-suspenders guard.
    expect(proposals).toHaveLength(0);
  });

  it("does NOT include STAFF users (only OWNER + ADMIN)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("exec-staff-excl");
    const staff = await seedStaff(practice.id, "no-exec");
    const vendor = await seedVendor(practice.id, "Some Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendor.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 5 * DAY_MS),
        executedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBaaExecutedNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Fan-in smoke test — generateAllNotifications wires up the new generators
// -------------------------------------------------------------------------

describe("generateAllNotifications fan-in (Phase 7 PR 3 wiring)", () => {
  it("includes proposals from all 4 new generators when each has matching seed data", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("fan-in");
    // 1) Policy ack: an adopted policy with no acks → POLICY_ACKNOWLEDGMENT_PENDING
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });
    // 2) BAA signature pending: SENT BAA → BAA_SIGNATURE_PENDING
    const vendorSent = await seedVendor(practice.id, "Sent Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendorSent.id,
        status: "SENT",
        sentAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });
    // 3) BAA expiring: vendor BAA in 5 days → VENDOR_BAA_EXPIRING (milestone 7)
    await seedVendor(practice.id, "Expiring Vendor", {
      processesPhi: true,
      baaExpiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
    });
    // 4) BAA executed: BAA executed yesterday → BAA_EXECUTED
    const vendorExec = await seedVendor(practice.id, "Done Vendor");
    await db.baaRequest.create({
      data: {
        practiceId: practice.id,
        vendorId: vendorExec.id,
        status: "EXECUTED",
        sentAt: new Date(Date.now() - 5 * DAY_MS),
        executedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    // Import dynamically because generateAllNotifications has a long
    // dependency graph; calling it in this single test instead of at the
    // top of the file keeps unrelated generators noiseless for the focused
    // tests above.
    const { generateAllNotifications } = await import(
      "@/lib/notifications/generators"
    );
    const proposals = await db.$transaction((tx) =>
      generateAllNotifications(tx, practice.id, [owner.id], "UTC", null),
    );

    const types = new Set(proposals.map((p) => p.type));
    expect(types.has("POLICY_ACKNOWLEDGMENT_PENDING")).toBe(true);
    expect(types.has("BAA_SIGNATURE_PENDING")).toBe(true);
    expect(types.has("VENDOR_BAA_EXPIRING")).toBe(true);
    expect(types.has("BAA_EXECUTED")).toBe(true);
  });
});
