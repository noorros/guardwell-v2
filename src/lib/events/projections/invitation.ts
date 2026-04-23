// src/lib/events/projections/invitation.ts
//
// Three projections for the invitation lifecycle:
//   USER_INVITED        → create PracticeInvitation row
//   INVITATION_ACCEPTED → mark invitation + create PracticeUser
//   INVITATION_REVOKED  → set revokedAt
//
// Token generation + email delivery happens in the server action layer,
// not here. Projections are pure DB writes.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type InvitedPayload = PayloadFor<"USER_INVITED", 1>;
type AcceptedPayload = PayloadFor<"INVITATION_ACCEPTED", 1>;
type RevokedPayload = PayloadFor<"INVITATION_REVOKED", 1>;
type ResentPayload = PayloadFor<"INVITATION_RESENT", 1>;
type MemberRemovedPayload = PayloadFor<"MEMBER_REMOVED", 1>;

export async function projectUserInvited(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    invitedByUserId: string;
    token: string;
    payload: InvitedPayload;
  },
): Promise<void> {
  const { practiceId, invitedByUserId, token, payload } = args;
  await tx.practiceInvitation.create({
    data: {
      id: payload.invitationId,
      practiceId,
      invitedByUserId,
      invitedEmail: payload.invitedEmail.toLowerCase(),
      role: payload.role,
      token,
      expiresAt: new Date(payload.expiresAt),
    },
  });
}

export async function projectInvitationAccepted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: AcceptedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const invite = await tx.practiceInvitation.findUnique({
    where: { id: payload.invitationId },
  });
  if (!invite) {
    throw new Error(`INVITATION_ACCEPTED refused: invitation not found`);
  }
  if (invite.practiceId !== practiceId) {
    throw new Error(`INVITATION_ACCEPTED refused: cross-practice`);
  }
  if (invite.acceptedAt) {
    throw new Error(`INVITATION_ACCEPTED refused: already accepted`);
  }
  if (invite.revokedAt) {
    throw new Error(`INVITATION_ACCEPTED refused: invitation revoked`);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new Error(`INVITATION_ACCEPTED refused: invitation expired`);
  }

  await tx.practiceInvitation.update({
    where: { id: payload.invitationId },
    data: {
      acceptedAt: new Date(),
      acceptedByUserId: payload.acceptedByUserId,
    },
  });

  // Create PracticeUser if not already a member.
  const existingMembership = await tx.practiceUser.findFirst({
    where: {
      practiceId,
      userId: payload.acceptedByUserId,
      removedAt: null,
    },
  });
  if (!existingMembership) {
    await tx.practiceUser.create({
      data: {
        userId: payload.acceptedByUserId,
        practiceId,
        role: payload.role,
      },
    });
  }
}

export async function projectInvitationRevoked(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RevokedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const invite = await tx.practiceInvitation.findUnique({
    where: { id: payload.invitationId },
  });
  if (!invite) {
    throw new Error(`INVITATION_REVOKED refused: invitation not found`);
  }
  if (invite.practiceId !== practiceId) {
    throw new Error(`INVITATION_REVOKED refused: cross-practice`);
  }
  if (invite.acceptedAt) {
    throw new Error(`INVITATION_REVOKED refused: already accepted`);
  }
  await tx.practiceInvitation.update({
    where: { id: payload.invitationId },
    data: { revokedAt: new Date() },
  });
}

export async function projectInvitationResent(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    newToken: string;
    payload: ResentPayload;
  },
): Promise<void> {
  const { practiceId, newToken, payload } = args;
  const invite = await tx.practiceInvitation.findUnique({
    where: { id: payload.invitationId },
  });
  if (!invite) {
    throw new Error(`INVITATION_RESENT refused: invitation not found`);
  }
  if (invite.practiceId !== practiceId) {
    throw new Error(`INVITATION_RESENT refused: cross-practice`);
  }
  if (invite.acceptedAt) {
    throw new Error(`INVITATION_RESENT refused: already accepted`);
  }
  if (invite.revokedAt) {
    throw new Error(`INVITATION_RESENT refused: invitation revoked`);
  }
  await tx.practiceInvitation.update({
    where: { id: payload.invitationId },
    data: {
      token: newToken,
      expiresAt: new Date(payload.newExpiresAt),
    },
  });
}

export async function projectMemberRemoved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: MemberRemovedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const pu = await tx.practiceUser.findUnique({
    where: { id: payload.practiceUserId },
  });
  if (!pu) throw new Error(`MEMBER_REMOVED refused: member not found`);
  if (pu.practiceId !== practiceId) {
    throw new Error(`MEMBER_REMOVED refused: cross-practice`);
  }
  if (pu.removedAt) return; // idempotent — already removed

  // Last-owner guard: never remove the only remaining OWNER. Prevents
  // an OWNER from locking themselves out of their own practice.
  if (pu.role === "OWNER") {
    const otherOwners = await tx.practiceUser.count({
      where: {
        practiceId,
        role: "OWNER",
        removedAt: null,
        NOT: { id: pu.id },
      },
    });
    if (otherOwners === 0) {
      throw new Error(
        "MEMBER_REMOVED refused: cannot remove the last OWNER of a practice",
      );
    }
  }

  await tx.practiceUser.update({
    where: { id: payload.practiceUserId },
    data: { removedAt: new Date() },
  });
}
