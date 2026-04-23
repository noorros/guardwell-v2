// tests/integration/invitations.test.ts
//
// End-to-end for the team-invitation lifecycle:
//   USER_INVITED → PracticeInvitation row
//   INVITATION_ACCEPTED → marks accepted + creates PracticeUser
//   INVITATION_REVOKED → marks revoked + blocks future accepts
//   Expired / already-accepted invites reject further writes

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectUserInvited,
  projectInvitationAccepted,
  projectInvitationRevoked,
} from "@/lib/events/projections/invitation";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `inv-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const invitee = await db.user.create({
    data: {
      firebaseUid: `inv-invitee-${Math.random().toString(36).slice(2, 10)}`,
      email: `invitee-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Invites Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, invitee, practice };
}

function invitePayload(invitedEmail: string, role: "STAFF" | "ADMIN" = "STAFF") {
  return {
    invitationId: `inv-${Math.random().toString(36).slice(2, 10)}`,
    invitedEmail,
    role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe("Team invitation lifecycle", () => {
  it("USER_INVITED creates a PracticeInvitation row", async () => {
    const { owner, invitee, practice } = await seed();
    const token = "token-" + Math.random().toString(36).slice(2, 20);
    const payload = invitePayload(invitee.email);
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "USER_INVITED",
        payload,
      },
      async (tx) =>
        projectUserInvited(tx, {
          practiceId: practice.id,
          invitedByUserId: owner.id,
          token,
          payload,
        }),
    );
    const row = await db.practiceInvitation.findUnique({
      where: { id: payload.invitationId },
    });
    expect(row).not.toBeNull();
    expect(row!.invitedEmail).toBe(invitee.email.toLowerCase());
    expect(row!.token).toBe(token);
    expect(row!.acceptedAt).toBeNull();
    expect(row!.revokedAt).toBeNull();
  });

  it("INVITATION_ACCEPTED marks row + creates PracticeUser with invited role", async () => {
    const { owner, invitee, practice } = await seed();
    const token = "token-" + Math.random().toString(36).slice(2, 20);
    const invited = invitePayload(invitee.email, "ADMIN");
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
          token,
          payload: invited,
        }),
    );

    const accepted = {
      invitationId: invited.invitationId,
      acceptedByUserId: invitee.id,
      invitedEmail: invited.invitedEmail,
      role: invited.role,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: invitee.id,
        type: "INVITATION_ACCEPTED",
        payload: accepted,
      },
      async (tx) =>
        projectInvitationAccepted(tx, {
          practiceId: practice.id,
          payload: accepted,
        }),
    );

    const row = await db.practiceInvitation.findUnique({
      where: { id: invited.invitationId },
    });
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.acceptedByUserId).toBe(invitee.id);

    const membership = await db.practiceUser.findFirst({
      where: { practiceId: practice.id, userId: invitee.id, removedAt: null },
    });
    expect(membership?.role).toBe("ADMIN");
  });

  it("INVITATION_ACCEPTED on expired invitation is rejected", async () => {
    const { owner, invitee, practice } = await seed();
    const token = "tok-" + Math.random().toString(36).slice(2, 20);
    const invited = {
      invitationId: `inv-${Math.random().toString(36).slice(2, 10)}`,
      invitedEmail: invitee.email,
      role: "STAFF" as const,
      // Already-expired timestamp
      expiresAt: new Date(Date.now() - 1000).toISOString(),
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
          token,
          payload: invited,
        }),
    );

    const accepted = {
      invitationId: invited.invitationId,
      acceptedByUserId: invitee.id,
      invitedEmail: invited.invitedEmail,
      role: invited.role,
    };
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: invitee.id,
          type: "INVITATION_ACCEPTED",
          payload: accepted,
        },
        async (tx) =>
          projectInvitationAccepted(tx, {
            practiceId: practice.id,
            payload: accepted,
          }),
      ),
    ).rejects.toThrow(/expired/);
  });

  it("INVITATION_REVOKED blocks subsequent accepts", async () => {
    const { owner, invitee, practice } = await seed();
    const token = "tok-" + Math.random().toString(36).slice(2, 20);
    const invited = invitePayload(invitee.email);
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
          token,
          payload: invited,
        }),
    );

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "INVITATION_REVOKED",
        payload: { invitationId: invited.invitationId },
      },
      async (tx) =>
        projectInvitationRevoked(tx, {
          practiceId: practice.id,
          payload: { invitationId: invited.invitationId },
        }),
    );

    const accepted = {
      invitationId: invited.invitationId,
      acceptedByUserId: invitee.id,
      invitedEmail: invited.invitedEmail,
      role: invited.role,
    };
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: invitee.id,
          type: "INVITATION_ACCEPTED",
          payload: accepted,
        },
        async (tx) =>
          projectInvitationAccepted(tx, {
            practiceId: practice.id,
            payload: accepted,
          }),
      ),
    ).rejects.toThrow(/revoked/);
  });

  it("Double-accept is rejected", async () => {
    const { owner, invitee, practice } = await seed();
    const token = "tok-" + Math.random().toString(36).slice(2, 20);
    const invited = invitePayload(invitee.email);
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
          token,
          payload: invited,
        }),
    );

    const accepted = {
      invitationId: invited.invitationId,
      acceptedByUserId: invitee.id,
      invitedEmail: invited.invitedEmail,
      role: invited.role,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: invitee.id,
        type: "INVITATION_ACCEPTED",
        payload: accepted,
      },
      async (tx) =>
        projectInvitationAccepted(tx, {
          practiceId: practice.id,
          payload: accepted,
        }),
    );

    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: invitee.id,
          type: "INVITATION_ACCEPTED",
          payload: accepted,
        },
        async (tx) =>
          projectInvitationAccepted(tx, {
            practiceId: practice.id,
            payload: accepted,
          }),
      ),
    ).rejects.toThrow(/already accepted/);
  });
});
