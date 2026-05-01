// tests/integration/welcome-generator.test.ts
//
// Phase 7 PR 5 — coverage for generateWelcomeNotifications.
// Real DB. The generator returns proposals (no DB writes); dedup is
// enforced at digest-runner insert time via the (userId, type,
// entityKey) unique constraint.
//
// Mirrors the inline-seed shape from baa-generators.test.ts.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { generateWelcomeNotifications } from "@/lib/notifications/generators";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `welcome-${Math.random().toString(36).slice(2, 10)}`,
      email: `welcome-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Welcome Test ${label}`, primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice, practiceUser: pu };
}

async function seedExtraMember(
  practiceId: string,
  label: string,
  opts: { joinedAt?: Date; removedAt?: Date | null; role?: "STAFF" | "ADMIN" } = {},
) {
  const user = await db.user.create({
    data: {
      firebaseUid: `welcome-mem-${Math.random().toString(36).slice(2, 10)}`,
      email: `welcome-mem-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Member",
      lastName: label,
    },
  });
  const pu = await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId,
      role: opts.role ?? "STAFF",
      joinedAt: opts.joinedAt ?? new Date(),
      removedAt: opts.removedAt ?? null,
    },
  });
  return { user, practiceUser: pu };
}

describe("generateWelcomeNotifications", () => {
  it("fires WELCOME for a freshly-joined PracticeUser", async () => {
    const { user, practice } = await seedPracticeWithOwner("fresh");

    const proposals = await db.$transaction((tx) =>
      generateWelcomeNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.userId).toBe(user.id);
    expect(p.practiceId).toBe(practice.id);
    expect(p.type).toBe("WELCOME");
    expect(p.severity).toBe("INFO");
    expect(p.href).toBe("/dashboard");
    expect(p.title).toContain("Welcome");
    expect(p.entityKey).toMatch(/^welcome:/);
  });

  it("does NOT fire for a PracticeUser who joined > 1 day ago", async () => {
    const { practice } = await seedPracticeWithOwner("old-only");
    // Update the OWNER row to look like an old member.
    await db.practiceUser.updateMany({
      where: { practiceId: practice.id },
      data: { joinedAt: new Date(Date.now() - 2 * DAY_MS) },
    });

    const proposals = await db.$transaction((tx) =>
      generateWelcomeNotifications(tx, practice.id, [], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire for a removed PracticeUser even if joinedAt is recent", async () => {
    const { user, practice } = await seedPracticeWithOwner("removed-host");
    // Remove the owner so only the removed member would be eligible.
    await db.practiceUser.updateMany({
      where: { userId: user.id, practiceId: practice.id },
      data: { joinedAt: new Date(Date.now() - 2 * DAY_MS) },
    });
    await seedExtraMember(practice.id, "removed", {
      joinedAt: new Date(),
      removedAt: new Date(),
    });

    const proposals = await db.$transaction((tx) =>
      generateWelcomeNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("returns the same proposal on a re-run (entityKey-based dedup at digest insert time)", async () => {
    const { user, practice } = await seedPracticeWithOwner("rerun");

    const first = await db.$transaction((tx) =>
      generateWelcomeNotifications(tx, practice.id, [user.id], "UTC"),
    );
    const second = await db.$transaction((tx) =>
      generateWelcomeNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // Same entityKey across runs — the digest runner's unique-constraint
    // dedup turns the second proposal into a no-op insert.
    expect(first[0]!.entityKey).toBe(second[0]!.entityKey);
  });

  it("fires for multiple recent joiners on the same practice", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("multi");
    const { user: member } = await seedExtraMember(practice.id, "second", {
      role: "STAFF",
      joinedAt: new Date(),
    });

    const proposals = await db.$transaction((tx) =>
      generateWelcomeNotifications(
        tx,
        practice.id,
        [owner.id, member.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(member.id)).toBe(true);
  });
});
