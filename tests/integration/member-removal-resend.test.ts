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

  // Audit #21 IM-10 (Wave 4 D6): MEMBER_REMOVED soft-deletes the
  // PracticeUser but must NOT cascade to credentials. State-board
  // renewal evidence requires Dr. Jane's DEA registration to stay on
  // the books even after she's off-boarded so the practice can either
  // explicitly retire it or transfer it. Audit #21 CR-4 shipped the
  // page-level rendering ("Former staff" group); IM-10 separately
  // tightened the FK to `onDelete: Restrict`. This test pins the
  // event-projection invariant: applying MEMBER_REMOVED through the
  // projection leaves Credential rows intact, with holderId still
  // pointing to the now-removed PracticeUser.
  it("MEMBER_REMOVED leaves credentials intact with holderId pointing to the removed PracticeUser (audit #21 IM-10)", async () => {
    const { owner, practice } = await seedOwner();
    // Add Dr. Jane as a STAFF member with a DEA registration.
    const jane = await db.user.create({
      data: {
        firebaseUid: `j-${Math.random().toString(36).slice(2, 10)}`,
        email: `j-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const janeMembership = await db.practiceUser.create({
      data: { userId: jane.id, practiceId: practice.id, role: "STAFF" },
    });
    const credType = await db.credentialType.upsert({
      where: { code: "DEA_CONTROLLED_SUBSTANCE_REGISTRATION" },
      update: {},
      create: {
        code: "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
        name: "DEA controlled-substance registration",
        category: "DEA_REGISTRATION",
      },
    });
    const credential = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        holderId: janeMembership.id,
        title: "AZ DEA Registration — Dr. Jane",
        licenseNumber: "DEA-AB1234567",
      },
    });

    // Off-board Dr. Jane via the canonical projection.
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "MEMBER_REMOVED",
        payload: {
          practiceUserId: janeMembership.id,
          removedUserId: jane.id,
        },
      },
      async (tx) =>
        projectMemberRemoved(tx, {
          practiceId: practice.id,
          payload: {
            practiceUserId: janeMembership.id,
            removedUserId: jane.id,
          },
        }),
    );

    // PracticeUser is soft-deleted...
    const puAfter = await db.practiceUser.findUnique({
      where: { id: janeMembership.id },
    });
    expect(puAfter?.removedAt).not.toBeNull();
    // ...but the credential row persists, with holderId still pointing
    // to the now-removed PracticeUser. State-board renewal flow can
    // still find / retire / re-attribute it.
    const credAfter = await db.credential.findUnique({
      where: { id: credential.id },
    });
    expect(credAfter).not.toBeNull();
    expect(credAfter?.holderId).toBe(janeMembership.id);
    expect(credAfter?.licenseNumber).toBe("DEA-AB1234567");
    expect(credAfter?.retiredAt).toBeNull();
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
