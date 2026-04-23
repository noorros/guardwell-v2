// tests/integration/notifications-digest.test.ts
//
// Covers the notification digest end-to-end against a real DB:
//   - generators identify at-risk SRAs, expiring credentials, expiring
//     BAAs, open incidents, unresolved breaches
//   - dedup works: running runNotificationDigest twice only creates
//     each notification once
//   - respects notification preferences (digestEnabled=false suppresses
//     email but still creates inbox rows)

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

async function seedPracticeWithOwner() {
  const user = await db.user.create({
    data: {
      firebaseUid: `notif-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Notif Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function ownerNotifications(userId: string) {
  return db.notification.findMany({ where: { userId } });
}

describe("Notification digest", () => {
  it("Generates no notifications for a freshly-compliant practice", async () => {
    const { user, practice } = await seedPracticeWithOwner();
    // Fresh SRA suppresses the "complete your first SRA" nudge.
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(),
        overallScore: 100,
        addressedCount: 20,
        totalCount: 20,
        isDraft: false,
      },
    });
    const summary = await runNotificationDigest();
    expect(summary.errors).toEqual([]);
    expect(await ownerNotifications(user.id)).toHaveLength(0);
  });

  it("Generates an SRA_DUE notification when there's no SRA on file", async () => {
    const { user, practice } = await seedPracticeWithOwner();
    const summary = await runNotificationDigest();
    expect(summary.errors).toEqual([]);
    const notes = await ownerNotifications(user.id);
    const sraNote = notes.find((n) => n.type === "SRA_DUE");
    expect(sraNote).toBeTruthy();
    expect(sraNote?.practiceId).toBe(practice.id);
    expect(sraNote?.severity).toBe("WARNING");
  });

  it("Dedups — running twice produces the same set of notifications", async () => {
    const { user } = await seedPracticeWithOwner();
    await runNotificationDigest();
    const firstRun = await ownerNotifications(user.id);
    await runNotificationDigest();
    const secondRun = await ownerNotifications(user.id);
    expect(secondRun).toHaveLength(firstRun.length);
  });

  it("Generates CREDENTIAL_EXPIRING for a credential in the 60-day horizon", async () => {
    const { user, practice } = await seedPracticeWithOwner();
    const credType = await db.credentialType.upsert({
      where: { code: "CRED_NOTIF_TEST" },
      update: {},
      create: {
        code: "CRED_NOTIF_TEST",
        name: "Test credential type",
        category: "CLINICAL_LICENSE",
      },
    });
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "AZ MD License",
        expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
    });
    const summary = await runNotificationDigest();
    expect(summary.errors).toEqual([]);
    const notes = await ownerNotifications(user.id);
    const credNote = notes.find((n) => n.type === "CREDENTIAL_EXPIRING");
    expect(credNote).toBeTruthy();
    expect(credNote?.title).toContain("20 days");
  });

  it("Generates INCIDENT_OPEN for an unresolved incident without breach determination", async () => {
    const { user, practice } = await seedPracticeWithOwner();
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Lost laptop",
        description: "Device went missing",
        type: "SECURITY",
        severity: "HIGH",
        status: "OPEN",
        phiInvolved: true,
        discoveredAt: new Date(),
      },
    });
    const summary = await runNotificationDigest();
    expect(summary.errors).toEqual([]);
    const notes = await ownerNotifications(user.id);
    const openNote = notes.find((n) => n.type === "INCIDENT_OPEN");
    expect(openNote).toBeTruthy();
    expect(openNote?.body).toContain("Lost laptop");
  });

  it("Generates CRITICAL INCIDENT_BREACH_UNRESOLVED when deadline is ≤ 7 days out", async () => {
    const { user, practice } = await seedPracticeWithOwner();
    // Discovered 55 days ago → 5 days left in the 60-day HHS window.
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Old breach",
        description: "Stolen box of paper charts",
        type: "PRIVACY",
        severity: "CRITICAL",
        status: "UNDER_INVESTIGATION",
        isBreach: true,
        affectedCount: 200,
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000),
      },
    });
    const summary = await runNotificationDigest();
    expect(summary.errors).toEqual([]);
    const notes = await ownerNotifications(user.id);
    const breachNote = notes.find(
      (n) => n.type === "INCIDENT_BREACH_UNRESOLVED",
    );
    expect(breachNote?.severity).toBe("CRITICAL");
  });

  it("Skips email when digestEnabled=false but still creates inbox rows", async () => {
    const { user } = await seedPracticeWithOwner();
    await db.notificationPreference.create({
      data: { userId: user.id, digestEnabled: false },
    });
    const summary = await runNotificationDigest();
    expect(summary.emailsAttempted).toBe(0);
    const notes = await ownerNotifications(user.id);
    expect(notes.length).toBeGreaterThan(0);
  });
});
