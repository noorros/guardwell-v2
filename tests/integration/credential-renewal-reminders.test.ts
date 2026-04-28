// tests/integration/credential-renewal-reminders.test.ts
//
// Covers generateCredentialRenewalNotifications:
//   - default 90/60/30/7 milestones fire when no config row exists
//   - explicit reminderConfig.milestoneDays overrides the defaults
//   - reminderConfig.enabled = false suppresses the proposal
//   - past-expiry credentials are skipped (CREDENTIAL_EXPIRING handles them)
//   - dedup: running twice produces a single notification

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { generateCredentialRenewalNotifications } from "@/lib/notifications/generators";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `cred-renew-${Math.random().toString(36).slice(2, 10)}`,
      email: `cred-renew-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Renewal Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedCredentialType(): Promise<string> {
  const t = await db.credentialType.create({
    data: {
      code: `RENEW_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: "Test renewal credential type",
      category: "CLINICAL_LICENSE",
    },
  });
  return t.id;
}

describe("generateCredentialRenewalNotifications", () => {
  it("fires the 30-day milestone with WARNING severity for a credential expiring in 30 days", async () => {
    const { user, practice } = await seedPracticeWithOwner("default-30d");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "AZ MD License",
        // Use noon UTC + slight buffer so daysUntil() rounds to 30, not 29.
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id]),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("CREDENTIAL_RENEWAL_DUE");
    expect(p.severity).toBe("WARNING");
    expect(p.entityKey).toBe(`credential:${cred.id}:milestone:30`);
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/programs/credentials/${cred.id}`);
    expect(p.title).toContain("AZ MD License");
  });

  it("respects custom milestoneDays — fires only for the configured day", async () => {
    const { user, practice } = await seedPracticeWithOwner("custom-14d");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Custom-schedule cred",
        expiryDate: new Date(Date.now() + 14 * DAY_MS + 60 * 60 * 1000),
      },
    });
    await db.credentialReminderConfig.create({
      data: {
        practiceId: practice.id,
        credentialId: cred.id,
        enabled: true,
        milestoneDays: [14],
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id]),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`credential:${cred.id}:milestone:14`);
    // 14 ≤ 30 so severity should be WARNING (not INFO).
    expect(p.severity).toBe("WARNING");
  });

  it("emits no proposals when reminderConfig.enabled = false", async () => {
    const { user, practice } = await seedPracticeWithOwner("disabled");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Disabled-reminder cred",
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });
    await db.credentialReminderConfig.create({
      data: {
        practiceId: practice.id,
        credentialId: cred.id,
        enabled: false,
        milestoneDays: [90, 60, 30, 7],
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id]),
    );

    expect(proposals).toHaveLength(0);
  });

  it("skips credentials that have already expired", async () => {
    const { user, practice } = await seedPracticeWithOwner("past-expiry");
    const credentialTypeId = await seedCredentialType();
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Expired cred",
        expiryDate: new Date(Date.now() - 5 * DAY_MS),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id]),
    );

    // No CREDENTIAL_RENEWAL_DUE — past-expiry handled by CREDENTIAL_EXPIRING.
    expect(proposals).toHaveLength(0);
  });

  it("dedups via the (userId, type, entityKey) unique constraint when run through the digest twice", async () => {
    const { user, practice } = await seedPracticeWithOwner("dedup");
    const credentialTypeId = await seedCredentialType();
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Dedup test cred",
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });

    await runNotificationDigest();
    await runNotificationDigest();

    const renewalNotes = await db.notification.findMany({
      where: { userId: user.id, type: "CREDENTIAL_RENEWAL_DUE" },
    });
    expect(renewalNotes).toHaveLength(1);
    const note = renewalNotes[0];
    if (!note) throw new Error("expected one notification");
    expect(note.practiceId).toBe(practice.id);
  });
});
