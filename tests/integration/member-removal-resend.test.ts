// tests/integration/member-removal-resend.test.ts
//
// Covers the two staff-page polish flows:
//   - projectInvitationResent rotates the token + extends expiry
//   - projectMemberRemoved soft-deletes PracticeUser
//   - Last-owner guard refuses to remove the only remaining OWNER

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectUserInvited,
  projectInvitationResent,
  projectMemberRemoved,
} from "@/lib/events/projections/invitation";

async function seedOwner() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `o-${Math.random().toString(36).slice(2, 10)}`,
      email: `o-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Remove/Resend Test", primaryState: "AZ" },
  });
  const ownerMembership = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice, ownerMembership };
}

describe("Team-management polish", () => {
  it("INVITATION_RESENT rotates token + refreshes expiry", async () => {
    const { owner, practice } = await seedOwner();
    const invitationId = `inv-${Math.random().toString(36).slice(2, 10)}`;
    const firstToken = "firstTok-" + Math.random().toString(36).slice(2, 10);
    const firstExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invited = {
      invitationId,
      invitedEmail: `target-${Math.random().toString(36).slice(2, 8)}@test.test`,
      role: "STAFF" as const,
      expiresAt: firstExpiry.toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "USER_INVITED",
        payload: invited,
      },
      async (tx) =>
        projectUserInvited(tx, {
          practiceId: practice.id,
          invitedByUserId: owner.id,
          token: firstToken,
          payload: invited,
        }),
    );

    const newToken = randomBytes(24).toString("base64url");
    const newExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "INVITATION_RESENT",
        payload: {
          invitationId,
          newExpiresAt: newExpiresAt.toISOString(),
        },
      },
      async (tx) =>
        projectInvitationResent(tx, {
          practiceId: practice.id,
          newToken,
          payload: {
            invitationId,
            newExpiresAt: newExpiresAt.toISOString(),
          },
        }),
    );

    const row = await db.practiceInvitation.findUnique({
      where: { id: invitationId },
    });
    expect(row?.token).toBe(newToken);
    expect(row?.expiresAt.toISOString()).toBe(newExpiresAt.toISOString());
    expect(row?.acceptedAt).toBeNull();
    expect(row?.revokedAt).toBeNull();
  });

  it("MEMBER_REMOVED soft-deletes the PracticeUser", async () => {
    const { owner, practice } = await seedOwner();
    // Add a second member so removing them doesn't trip the last-owner guard.
    const staff = await db.user.create({
      data: {
        firebaseUid: `s-${Math.random().toString(36).slice(2, 10)}`,
        email: `s-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const staffMember = await db.practiceUser.create({
      data: { userId: staff.id, practiceId: practice.id, role: "STAFF" },
    });

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "MEMBER_REMOVED",
        payload: {
          practiceUserId: staffMember.id,
          removedUserId: staff.id,
        },
      },
      async (tx) =>
        projectMemberRemoved(tx, {
          practiceId: practice.id,
          payload: {
            practiceUserId: staffMember.id,
            removedUserId: staff.id,
          },
        }),
    );

    const row = await db.practiceUser.findUnique({
      where: { id: staffMember.id },
    });
    expect(row?.removedAt).not.toBeNull();
  });

  it("Refuses to remove the last remaining OWNER", async () => {
    const { owner, practice, ownerMembership } = await seedOwner();

    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "MEMBER_REMOVED",
          payload: {
            practiceUserId: ownerMembership.id,
            removedUserId: owner.id,
          },
        },
        async (tx) =>
          projectMemberRemoved(tx, {
            practiceId: practice.id,
            payload: {
              practiceUserId: ownerMembership.id,
              removedUserId: owner.id,
            },
          }),
      ),
    ).rejects.toThrow(/last OWNER/);
  });
});
