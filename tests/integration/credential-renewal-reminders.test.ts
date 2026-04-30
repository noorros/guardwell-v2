// tests/integration/credential-renewal-reminders.test.ts
//
// Covers generateCredentialRenewalNotifications:
//   - default 90/60/30/7 milestones fire when no config row exists
//   - explicit reminderConfig.milestoneDays overrides the defaults
//   - reminderConfig.enabled = false suppresses the proposal
//   - past-expiry credentials are skipped (CREDENTIAL_EXPIRING handles them)
//   - dedup: running twice produces the same set of notifications
//   - audit #21 IM-7: deterministic milestone firing — every milestone
//     where days <= m fires, not "exactly the day the threshold flipped".
//     Idempotent regardless of when (or how often) the cron runs.

import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { generateCredentialRenewalNotifications } from "@/lib/notifications/generators";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

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
  it("fires every milestone we're inside of for a credential expiring in 30 days (90, 60, 30)", async () => {
    const { user, practice } = await seedPracticeWithOwner("default-30d");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "AZ MD License",
        // +1h buffer so Math.floor((30d+1h)/DAY_MS) = 30, not 29.
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    // Audit #21 IM-7: every milestone with days <= m fires per run; entityKey
    // dedup absorbs reruns. With days=30 and default milestones [90,60,30,7],
    // the 90, 60, and 30 milestones all match.
    expect(proposals).toHaveLength(3);
    const entityKeys = proposals.map((p) => p.entityKey).sort();
    expect(entityKeys).toEqual(
      [
        `credential:${cred.id}:milestone:30`,
        `credential:${cred.id}:milestone:60`,
        `credential:${cred.id}:milestone:90`,
      ].sort(),
    );
    // Severity tracks the milestone (30 → WARNING, 60/90 → INFO).
    const m30 = proposals.find(
      (p) => p.entityKey === `credential:${cred.id}:milestone:30`,
    );
    const m60 = proposals.find(
      (p) => p.entityKey === `credential:${cred.id}:milestone:60`,
    );
    const m90 = proposals.find(
      (p) => p.entityKey === `credential:${cred.id}:milestone:90`,
    );
    expect(m30?.severity).toBe("WARNING");
    expect(m60?.severity).toBe("INFO");
    expect(m90?.severity).toBe("INFO");
    // Common attributes on every proposal.
    for (const p of proposals) {
      expect(p.type).toBe("CREDENTIAL_RENEWAL_DUE");
      expect(p.userId).toBe(user.id);
      expect(p.href).toBe(`/programs/credentials/${cred.id}`);
      expect(p.title).toContain("AZ MD License");
    }
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
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
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
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
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
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
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
    const firstRun = await db.notification.findMany({
      where: { userId: user.id, type: "CREDENTIAL_RENEWAL_DUE" },
    });
    await runNotificationDigest();
    const secondRun = await db.notification.findMany({
      where: { userId: user.id, type: "CREDENTIAL_RENEWAL_DUE" },
    });

    // Audit #21 IM-7: each run fires every active milestone (90, 60, 30 for
    // a 30-day-out cred); dedup keeps the count stable across runs.
    expect(firstRun).toHaveLength(3);
    expect(secondRun).toHaveLength(3);
    expect(secondRun.map((n) => n.entityKey).sort()).toEqual(
      firstRun.map((n) => n.entityKey).sort(),
    );
    const note = secondRun[0];
    if (!note) throw new Error("expected at least one notification");
    expect(note.practiceId).toBe(practice.id);
  });

  // -------------------------------------------------------------------------
  // Audit #21 IM-7: cron-time determinism. Fires the right milestones
  // regardless of when in the day the cron actually runs (delayed batch,
  // retry after partial failure, etc.). With the prior Math.round logic
  // and a tight `days === milestone` window, a cron at noon UTC could
  // straddle the boundary day and either fire twice or skip the milestone
  // entirely. Floor + (days <= milestone) makes it idempotent.
  // -------------------------------------------------------------------------

  it("fires 30/60/90 milestones when cron runs at noon UTC and expiry is exactly 30 days away", async () => {
    // Use Jan 31, 2026 noon UTC so the boundary day is exact.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("noon-30d");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Boundary cred",
        // Exactly 30 days from frozen now → daysUntil = floor(30) = 30.
        expiryDate: new Date("2026-03-02T12:00:00Z"),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.entityKey).sort()).toEqual(
      [
        `credential:${cred.id}:milestone:30`,
        `credential:${cred.id}:milestone:60`,
        `credential:${cred.id}:milestone:90`,
      ].sort(),
    );
  });

  it("retried digest after a partial failure doesn't double-fire the same milestone", async () => {
    // Freeze time so two runs see the same days-until value. With Math.round
    // on a real clock, retries microseconds apart could land on opposite
    // sides of the boundary; the entityKey dedup is what saves us — this
    // test pins both behaviors at once.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T18:30:00Z"));

    const { user, practice } = await seedPracticeWithOwner("retry-dedup");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Retry dedup cred",
        // 45 days out → only 60 and 90 milestones match.
        expiryDate: new Date("2026-04-01T18:30:00Z"),
      },
    });

    // Run twice with clock unchanged. Mirror the digest's persistence
    // path — createMany + skipDuplicates is what relies on the
    // (userId, type, entityKey) unique constraint to dedup retried rows.
    for (let i = 0; i < 2; i++) {
      const proposals = await db.$transaction(async (tx) =>
        generateCredentialRenewalNotifications(
          tx,
          practice.id,
          [user.id],
          "UTC",
          null,
        ),
      );
      await db.notification.createMany({
        data: proposals.map((p) => ({
          practiceId: p.practiceId,
          userId: p.userId,
          type: p.type,
          severity: p.severity,
          title: p.title,
          body: p.body,
          href: p.href,
          entityKey: p.entityKey,
        })),
        skipDuplicates: true,
      });
    }

    const persisted = await db.notification.findMany({
      where: {
        userId: user.id,
        type: "CREDENTIAL_RENEWAL_DUE",
      },
    });
    // Both runs proposed the same 60 + 90 milestones; dedup → exactly 2 rows.
    expect(persisted).toHaveLength(2);
    expect(persisted.map((n) => n.entityKey).sort()).toEqual(
      [
        `credential:${cred.id}:milestone:60`,
        `credential:${cred.id}:milestone:90`,
      ].sort(),
    );
  });

  it("fires the right milestone when cron runs at 3am UTC on the boundary day (no skipped milestone)", async () => {
    // Pre-fix bug: Math.round((30*DAY - elapsed_to_3am)/DAY) could round to
    // 29 if the cron ran early in the day, missing the (days===30) match.
    // Post-fix: floor of 30.X is 30; (days <= 30) catches the milestone.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T03:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("3am-boundary");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "3am cred",
        // Expiry 30 days later at midnight UTC. From 03:00 UTC, that's
        // 30 days minus 3 hours = 29.875 days. Math.floor → 29 (we're
        // already inside the 30-day window).
        expiryDate: new Date("2026-03-17T00:00:00Z"),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    // days=29 → 30, 60, 90 all match (29 <= 30, 29 <= 60, 29 <= 90).
    // The 30 milestone is NOT skipped just because we're at 3am on the
    // boundary day — the audit-#21-IM-7 fix.
    expect(proposals).toHaveLength(3);
    const keys = proposals.map((p) => p.entityKey);
    expect(keys).toContain(`credential:${cred.id}:milestone:30`);
    expect(keys).toContain(`credential:${cred.id}:milestone:60`);
    expect(keys).toContain(`credential:${cred.id}:milestone:90`);
  });

  it("fires 60 and 90 milestones (but not 30 or 7) when 45 days out — multi-milestone behavior", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("between-milestones");
    const credentialTypeId = await seedCredentialType();
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Between-milestones cred",
        // 45 days from frozen now → only 60 and 90 fire (45 > 30).
        expiryDate: new Date("2026-04-01T12:00:00Z"),
      },
    });

    const proposals = await db.$transaction(async (tx) =>
      generateCredentialRenewalNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.entityKey).sort()).toEqual(
      [
        `credential:${cred.id}:milestone:60`,
        `credential:${cred.id}:milestone:90`,
      ].sort(),
    );
    // Confirm 30 and 7 milestones did NOT fire.
    const keys = proposals.map((p) => p.entityKey);
    expect(keys).not.toContain(`credential:${cred.id}:milestone:30`);
    expect(keys).not.toContain(`credential:${cred.id}:milestone:7`);
  });
});
