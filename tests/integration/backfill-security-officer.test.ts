// tests/integration/backfill-security-officer.test.ts
//
// Audit #21 Chrome CHROME-5 / PR-C8: regression tests for the
// SECURITY officer backfill script. Practices that existed before
// audit #18 (PR #205) have neither the isSecurityOfficer flag nor an
// OFFICER_DESIGNATED(SECURITY) event, so HIPAA_SECURITY_OFFICER
// derives to GAP. The backfill emits an event for the OWNER, which
// flips derivation to COMPLIANT.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { backfillSecurityOfficer } from "../../scripts/backfill-security-officer";

async function seedUser(label: string) {
  return db.user.create({
    data: {
      firebaseUid: `bsf-${label}-${Math.random().toString(36).slice(2, 10)}`,
      email: `bsf-${label}-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
}

async function seedPracticeWithOwner(opts: {
  name: string;
  // Whether to set isSecurityOfficer=true on the OWNER (mimics post-PR-205
  // creation path). Defaults to false (mimics pre-PR-205 practice).
  ownerIsSecurityOfficer?: boolean;
}) {
  const owner = await seedUser(opts.name);
  const practice = await db.practice.create({
    data: { name: opts.name, primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: {
      userId: owner.id,
      practiceId: practice.id,
      role: "OWNER",
      isSecurityOfficer: opts.ownerIsSecurityOfficer ?? false,
    },
  });
  return { user: owner, practice, pu };
}

describe("backfillSecurityOfficer", () => {
  it("emits OFFICER_DESIGNATED for SECURITY when a practice has no security officer", async () => {
    const { practice, pu } = await seedPracticeWithOwner({
      name: "Pre-PR-205 Practice",
    });

    // Sanity: starts un-designated.
    expect(pu.isSecurityOfficer).toBe(false);

    const result = await backfillSecurityOfficer({ log: () => {} });

    expect(result.checked).toBe(1);
    expect(result.alreadyDesignated).toBe(0);
    expect(result.backfilled).toBe(1);
    expect(result.skippedNoOwner).toBe(0);

    // OFFICER_DESIGNATED event emitted for SECURITY.
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "OFFICER_DESIGNATED" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as {
      officerRole?: string;
      designated?: boolean;
      practiceUserId?: string;
    };
    expect(payload.officerRole).toBe("SECURITY");
    expect(payload.designated).toBe(true);
    expect(payload.practiceUserId).toBe(pu.id);

    // Projection ran: PracticeUser flag flipped.
    const refreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: pu.id },
    });
    expect(refreshed.isSecurityOfficer).toBe(true);
  });

  it("skips a practice that already has a SECURITY OFFICER_DESIGNATED event", async () => {
    const { user, practice, pu } = await seedPracticeWithOwner({
      name: "Post-PR-205-via-event Practice",
    });

    // Seed an existing SECURITY designation event (the projection path —
    // mimics a practice where the OWNER actively designated SECURITY
    // through the staff page rather than via the audit-#18 default).
    await db.eventLog.create({
      data: {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OFFICER_DESIGNATED",
        schemaVersion: 1,
        payload: {
          practiceUserId: pu.id,
          userId: user.id,
          officerRole: "SECURITY",
          designated: true,
        },
      },
    });

    const before = await db.eventLog.count({
      where: { practiceId: practice.id },
    });
    const result = await backfillSecurityOfficer({ log: () => {} });
    const after = await db.eventLog.count({
      where: { practiceId: practice.id },
    });

    expect(result.alreadyDesignated).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(after).toBe(before);
  });

  it("skips a practice where the audit-#18 isSecurityOfficer flag is already set on the OWNER", async () => {
    // Mimics post-PR-205 practice creation: flag set via direct
    // tx.practiceUser.create — no OFFICER_DESIGNATED event in the log.
    const { practice } = await seedPracticeWithOwner({
      name: "Post-PR-205-via-flag Practice",
      ownerIsSecurityOfficer: true,
    });

    const result = await backfillSecurityOfficer({ log: () => {} });

    expect(result.alreadyDesignated).toBe(1);
    expect(result.backfilled).toBe(0);
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "OFFICER_DESIGNATED" },
    });
    expect(events).toHaveLength(0);
  });

  it("skips a practice where a non-OWNER user is already Security Officer", async () => {
    // OWNER is NOT the security officer; an ADMIN (or any other user
    // with the flag) is. The backfill should detect that and not
    // overwrite.
    const adminUser = await seedUser("admin");
    const ownerUser = await seedUser("owner");
    const practice = await db.practice.create({
      data: { name: "ADMIN-as-SO Practice", primaryState: "AZ" },
    });
    const ownerPu = await db.practiceUser.create({
      data: {
        userId: ownerUser.id,
        practiceId: practice.id,
        role: "OWNER",
        isSecurityOfficer: false,
      },
    });
    const adminPu = await db.practiceUser.create({
      data: {
        userId: adminUser.id,
        practiceId: practice.id,
        role: "ADMIN",
        isSecurityOfficer: true,
      },
    });

    const result = await backfillSecurityOfficer({ log: () => {} });

    expect(result.alreadyDesignated).toBe(1);
    expect(result.backfilled).toBe(0);

    // Owner stays un-designated; ADMIN remains the SO.
    const ownerRefreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: ownerPu.id },
    });
    const adminRefreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: adminPu.id },
    });
    expect(ownerRefreshed.isSecurityOfficer).toBe(false);
    expect(adminRefreshed.isSecurityOfficer).toBe(true);
  });

  it("warns and skips a practice with no active OWNER", async () => {
    // Empty practice: no PracticeUser rows at all. Mimics "orphan" or
    // partially-created data.
    const practice = await db.practice.create({
      data: { name: "Orphan Practice", primaryState: "AZ" },
    });

    const messages: string[] = [];
    const result = await backfillSecurityOfficer({
      log: (m) => messages.push(m),
    });

    expect(result.skippedNoOwner).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(messages.some((m) => m.includes("[warn]") && m.includes(practice.id)))
      .toBe(true);

    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "OFFICER_DESIGNATED" },
    });
    expect(events).toHaveLength(0);
  });

  it("idempotency: a second run produces 0 emissions", async () => {
    const { practice } = await seedPracticeWithOwner({
      name: "Idempotent Practice",
    });

    const first = await backfillSecurityOfficer({ log: () => {} });
    expect(first.backfilled).toBe(1);

    const second = await backfillSecurityOfficer({ log: () => {} });
    expect(second.backfilled).toBe(0);
    expect(second.alreadyDesignated).toBe(1);

    // Only one OFFICER_DESIGNATED event total across both runs.
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "OFFICER_DESIGNATED" },
    });
    expect(events).toHaveLength(1);
  });

  it("dry-run: counts a backfill as if it would happen but does not write", async () => {
    const { practice, pu } = await seedPracticeWithOwner({
      name: "Dry-Run Practice",
    });

    const result = await backfillSecurityOfficer({
      dryRun: true,
      log: () => {},
    });

    // Counted as backfilled (the report number reflects "would-be"
    // emissions in dry-run mode).
    expect(result.backfilled).toBe(1);

    // But no event was actually written and the flag stays false.
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "OFFICER_DESIGNATED" },
    });
    expect(events).toHaveLength(0);
    const refreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: pu.id },
    });
    expect(refreshed.isSecurityOfficer).toBe(false);
  });
});
