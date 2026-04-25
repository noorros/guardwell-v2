// tests/integration/bulk-invite.test.ts
//
// End-to-end for the bulk-invite flow. Reuses the existing
// USER_INVITED projection so most of what we test is the new action's
// dedupe, transactional-batch, and per-row-results contract.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { processBulkInviteRows, type BulkInviteRow } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `bulk-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Bulk Invite Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice };
}

describe("bulk invite action", () => {
  it("emits one USER_INVITED event per valid row", async () => {
    const { owner, practice } = await seed();
    const rows: BulkInviteRow[] = [
      { firstName: "A", lastName: "One", email: `a-${Math.random()}@test.test`, role: "STAFF" },
      { firstName: "B", lastName: "Two", email: `b-${Math.random()}@test.test`, role: "ADMIN" },
    ];
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows,
    });
    expect(result.invitedCount).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.skippedInvalid).toBe(0);
    const invitations = await db.practiceInvitation.findMany({
      where: { practiceId: practice.id },
    });
    expect(invitations).toHaveLength(2);
  });

  it("dedupes duplicate emails within the same batch", async () => {
    const { owner, practice } = await seed();
    const dupEmail = `dup-${Math.random()}@test.test`;
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [
        { firstName: "A", lastName: "One", email: dupEmail, role: "STAFF" },
        { firstName: "B", lastName: "Two", email: dupEmail, role: "STAFF" },
      ],
    });
    expect(result.invitedCount).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults.filter((r) => r.status === "DUPLICATE_IN_BATCH")).toHaveLength(1);
  });

  it("skips emails that are already members of the practice", async () => {
    const { owner, practice } = await seed();
    const existingUser = await db.user.create({
      data: {
        firebaseUid: `existing-${Math.random().toString(36).slice(2, 10)}`,
        email: `existing-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: existingUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [
        { firstName: "", lastName: "", email: existingUser.email!, role: "STAFF" },
      ],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults[0]?.status).toBe("ALREADY_MEMBER");
  });

  it("skips emails that are already pending invitations", async () => {
    const { owner, practice } = await seed();
    const pendingEmail = `pending-${Math.random()}@test.test`;
    await db.practiceInvitation.create({
      data: {
        id: `inv-${Math.random().toString(36).slice(2, 10)}`,
        practiceId: practice.id,
        invitedByUserId: owner.id,
        invitedEmail: pendingEmail,
        role: "STAFF",
        token: Math.random().toString(36).slice(2),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [{ firstName: "", lastName: "", email: pendingEmail, role: "STAFF" }],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.perRowResults[0]?.status).toBe("ALREADY_PENDING");
  });

  it("rejects invalid email format", async () => {
    const { owner, practice } = await seed();
    const result = await processBulkInviteRows({
      practiceId: practice.id,
      actorUserId: owner.id,
      rows: [{ firstName: "", lastName: "", email: "not-an-email", role: "STAFF" }],
    });
    expect(result.invitedCount).toBe(0);
    expect(result.skippedInvalid).toBe(1);
    expect(result.perRowResults[0]?.status).toBe("INVALID_EMAIL");
  });

  it("hard-caps at 200 rows per batch", async () => {
    const { owner, practice } = await seed();
    const rows: BulkInviteRow[] = Array.from({ length: 201 }, (_, i) => ({
      firstName: "",
      lastName: "",
      email: `cap-${i}-${Math.random().toString(36).slice(2, 6)}@test.test`,
      role: "STAFF" as const,
    }));
    await expect(
      processBulkInviteRows({
        practiceId: practice.id,
        actorUserId: owner.id,
        rows,
      }),
    ).rejects.toThrow(/200/);
  });
});
