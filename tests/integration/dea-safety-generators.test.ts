// tests/integration/dea-safety-generators.test.ts
//
// Phase 7 PR 4 — coverage for the four new "DEA + safety" notification
// generators:
//   - generateDeaBiennialInventoryDueNotifications  (DEA_BIENNIAL_INVENTORY_DUE)
//   - generatePhishingDrillDueNotifications         (PHISHING_DRILL_DUE)
//   - generateBackupVerificationOverdueNotifications (BACKUP_VERIFICATION_OVERDUE)
//   - generateDocumentDestructionOverdueNotifications (DOCUMENT_DESTRUCTION_OVERDUE)
//
// All four target OWNER + ADMIN only via ownerAdminUserIds. The DEA
// generator uses a milestone fan-out matching the credential renewal
// pattern; the other three use absence-based detection with year-week
// or year-quarter dedup.
//
// Mirrors the inline-seed shape from tests/integration/baa-generators.test.ts.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  generateDeaBiennialInventoryDueNotifications,
  generatePhishingDrillDueNotifications,
  generateBackupVerificationOverdueNotifications,
  generateDocumentDestructionOverdueNotifications,
} from "@/lib/notifications/generators";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `dea-gen-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-gen-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `DEA-Gen Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedAdditionalAdmin(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `dea-gen-admin-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-gen-admin-${Math.random().toString(36).slice(2, 8)}@test.test`,
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
      firebaseUid: `dea-gen-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-gen-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Staff",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return user;
}

async function enableDeaFramework(practiceId: string) {
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "DEA" },
    update: {},
    create: {
      code: "DEA",
      name: "DEA Controlled Substances",
      description: "21 CFR Parts 1304, 1311",
      sortOrder: 200,
    },
  });
  await db.practiceFramework.upsert({
    where: { practiceId_frameworkId: { practiceId, frameworkId: fw.id } },
    update: { enabled: true },
    create: {
      practiceId,
      frameworkId: fw.id,
      enabled: true,
    },
  });
  return fw;
}

// ---------------------------------------------------------------------------
// generateDeaBiennialInventoryDueNotifications
// ---------------------------------------------------------------------------

describe("generateDeaBiennialInventoryDueNotifications", () => {
  it("does NOT fire when DEA framework is disabled", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-disabled");
    // Note: no DEA framework enabled for this practice.

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("fires CRITICAL 'never recorded' when DEA enabled but no inventory exists", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-never");
    const admin = await seedAdditionalAdmin(practice.id, "dea-never");
    await enableDeaFramework(practice.id);

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id, admin.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(2);
    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(admin.id)).toBe(true);
    for (const p of proposals) {
      expect(p.type).toBe("DEA_BIENNIAL_INVENTORY_DUE");
      expect(p.severity).toBe("CRITICAL");
      expect(p.title).toContain("never been recorded");
      expect(p.entityKey).toBe(`dea-biennial-never-recorded:${practice.id}`);
      expect(p.href).toBe("/programs/dea/inventory");
    }
  });

  it("fires :60 milestone when inventory was 23 months ago (40 days from due)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-23mo");
    await enableDeaFramework(practice.id);
    // Last inventory = 24 months - 40 days ago, so dueDate is 40 days from now.
    const asOfDate = new Date();
    asOfDate.setUTCMonth(asOfDate.getUTCMonth() - 24);
    asOfDate.setUTCDate(asOfDate.getUTCDate() + 40);
    const inventory = await db.deaInventory.create({
      data: {
        practiceId: practice.id,
        asOfDate,
        conductedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    // days≈40 → only milestone 60 satisfies (40 <= 60 TRUE, 40 <= 14 FALSE,
    // 40 <= 1 FALSE). One milestone × one user = 1 proposal.
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.type).toBe("DEA_BIENNIAL_INVENTORY_DUE");
    expect(proposals[0]?.entityKey).toBe(`dea-biennial:${inventory.id}:60`);
    expect(proposals[0]?.severity).toBe("INFO"); // m=60 > 14 → INFO
    expect(proposals[0]?.title).toContain("due in");
  });

  it("fires CRITICAL when inventory was 24 months + 1 day ago (overdue)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-overdue");
    await enableDeaFramework(practice.id);
    // 24 months + 1 day ago → dueDate is 1 day in the past.
    const asOfDate = new Date();
    asOfDate.setUTCMonth(asOfDate.getUTCMonth() - 24);
    asOfDate.setUTCDate(asOfDate.getUTCDate() - 1);
    const inventory = await db.deaInventory.create({
      data: {
        practiceId: practice.id,
        asOfDate,
        conductedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        null,
      ),
    );

    // days < 0 → all 3 milestones satisfied (60, 14, 1).
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0]?.severity).toBe("CRITICAL");
    expect(proposals[0]?.title).toContain("overdue");
    // Each proposal's entityKey starts with the inventory id.
    for (const p of proposals) {
      expect(p.entityKey).toContain(`dea-biennial:${inventory.id}:`);
    }
  });

  it("STAFF user does NOT receive (recipients are OWNER + ADMIN only)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-staff");
    const staff = await seedStaff(practice.id, "dea-staff");
    await enableDeaFramework(practice.id);
    // No inventory → "never recorded" path fires for OWNER only.

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
        null,
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.userId).toBe(owner.id);
    const staffProposals = proposals.filter((p) => p.userId === staff.id);
    expect(staffProposals).toHaveLength(0);
  });

  it("respects per-practice deaInventory override [120, 60, 30] at 100 days from due", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dea-override");
    await enableDeaFramework(practice.id);
    // 100 days from due = inventory was 24 months - 100 days ago.
    const asOfDate = new Date();
    asOfDate.setUTCMonth(asOfDate.getUTCMonth() - 24);
    asOfDate.setUTCDate(asOfDate.getUTCDate() + 100);
    const inventory = await db.deaInventory.create({
      data: {
        practiceId: practice.id,
        asOfDate,
        conductedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateDeaBiennialInventoryDueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
        { deaInventory: [120, 60, 30] },
      ),
    );

    // days≈100 → only milestone 120 satisfies (100 <= 120, 100 > 60, 100 > 30).
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.entityKey).toBe(`dea-biennial:${inventory.id}:120`);
    expect(proposals[0]?.severity).toBe("INFO"); // m=120 > 14 → INFO
  });
});

// ---------------------------------------------------------------------------
// generatePhishingDrillDueNotifications
// ---------------------------------------------------------------------------

describe("generatePhishingDrillDueNotifications", () => {
  it("does NOT fire when a drill was conducted yesterday", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("phish-recent");
    await db.phishingDrill.create({
      data: {
        practiceId: practice.id,
        conductedAt: new Date(Date.now() - 1 * DAY_MS),
        totalRecipients: 25,
        loggedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePhishingDrillDueNotifications(tx, practice.id, [owner.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("fires when the most recent drill was 400 days ago", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("phish-stale");
    const admin = await seedAdditionalAdmin(practice.id, "phish-stale");
    await db.phishingDrill.create({
      data: {
        practiceId: practice.id,
        conductedAt: new Date(Date.now() - 400 * DAY_MS),
        totalRecipients: 25,
        loggedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePhishingDrillDueNotifications(
        tx,
        practice.id,
        [owner.id, admin.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.type).toBe("PHISHING_DRILL_DUE");
      expect(p.severity).toBe("INFO");
      expect(p.href).toBe("/programs/security");
      expect(p.title).toBe("Annual phishing drill is due");
    }
  });

  it("fires when no drill has ever been recorded", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("phish-never");

    const proposals = await db.$transaction((tx) =>
      generatePhishingDrillDueNotifications(tx, practice.id, [owner.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.userId).toBe(owner.id);
  });

  it("STAFF user does NOT receive", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("phish-staff");
    const staff = await seedStaff(practice.id, "phish-staff");

    const proposals = await db.$transaction((tx) =>
      generatePhishingDrillDueNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.userId).toBe(owner.id);
    expect(proposals.find((p) => p.userId === staff.id)).toBeUndefined();
  });

  it("entityKey contains a year-week token for stable weekly dedup", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("phish-yearweek");

    const proposals = await db.$transaction((tx) =>
      generatePhishingDrillDueNotifications(tx, practice.id, [owner.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const ek = proposals[0]?.entityKey ?? "";
    // Format: phishing-drill-due:<practiceId>:<YYYY>-W<WW>
    expect(ek).toMatch(
      new RegExp(`^phishing-drill-due:${practice.id}:\\d{4}-W\\d{2}$`),
    );
  });
});

// ---------------------------------------------------------------------------
// generateBackupVerificationOverdueNotifications
// ---------------------------------------------------------------------------

describe("generateBackupVerificationOverdueNotifications", () => {
  it("does NOT fire when a successful verification was within 90 days", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("backup-recent");
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 30 * DAY_MS),
        scope: "EHR",
        success: true,
        loggedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBackupVerificationOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("fires when the only verification within 90d had success: false (failed restore = no backup)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("backup-failed");
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 30 * DAY_MS),
        scope: "EHR",
        success: false,
        loggedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBackupVerificationOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.type).toBe("BACKUP_VERIFICATION_OVERDUE");
    expect(proposals[0]?.severity).toBe("WARNING");
  });

  it("fires when no verification has ever been recorded", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("backup-never");
    const admin = await seedAdditionalAdmin(practice.id, "backup-never");

    const proposals = await db.$transaction((tx) =>
      generateBackupVerificationOverdueNotifications(
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
      expect(p.href).toBe("/programs/security");
      expect(p.title).toBe("Backup restore test is overdue");
      expect(p.entityKey).toMatch(
        new RegExp(`^backup-overdue:${practice.id}:\\d{4}-W\\d{2}$`),
      );
    }
  });

  it("fires when last successful verification was 100 days ago (>90d cutoff)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("backup-100d");
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 100 * DAY_MS),
        scope: "EHR",
        success: true,
        loggedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBackupVerificationOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.severity).toBe("WARNING");
  });
});

// ---------------------------------------------------------------------------
// generateDocumentDestructionOverdueNotifications
// ---------------------------------------------------------------------------

describe("generateDocumentDestructionOverdueNotifications", () => {
  it("does NOT fire when a destruction was logged within 365 days", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dest-recent");
    await db.destructionLog.create({
      data: {
        practiceId: practice.id,
        documentType: "MEDICAL_RECORDS",
        description: "Q1 charts",
        method: "SHREDDING",
        performedByUserId: owner.id,
        destroyedAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateDocumentDestructionOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("fires when no destruction logs have ever been recorded", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dest-never");
    const admin = await seedAdditionalAdmin(practice.id, "dest-never");

    const proposals = await db.$transaction((tx) =>
      generateDocumentDestructionOverdueNotifications(
        tx,
        practice.id,
        [owner.id, admin.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.type).toBe("DOCUMENT_DESTRUCTION_OVERDUE");
      expect(p.severity).toBe("INFO");
      expect(p.href).toBe("/programs/document-retention");
    }
  });

  it("fires when last destruction was 366+ days ago", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dest-old");
    await db.destructionLog.create({
      data: {
        practiceId: practice.id,
        documentType: "MEDICAL_RECORDS",
        description: "Old records",
        method: "SHREDDING",
        performedByUserId: owner.id,
        destroyedAt: new Date(Date.now() - 400 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateDocumentDestructionOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.severity).toBe("INFO");
  });

  it("entityKey contains a year-quarter token for stable quarterly dedup", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dest-quarter");

    const proposals = await db.$transaction((tx) =>
      generateDocumentDestructionOverdueNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    const ek = proposals[0]?.entityKey ?? "";
    // Format: doc-destruction-overdue:<practiceId>:<YYYY>-Q<n>  (n ∈ 1..4)
    expect(ek).toMatch(
      new RegExp(`^doc-destruction-overdue:${practice.id}:\\d{4}-Q[1-4]$`),
    );
  });
});
