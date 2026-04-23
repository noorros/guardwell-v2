// src/app/accept-invite/[token]/actions.ts
"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectInvitationAccepted } from "@/lib/events/projections/invitation";

const Input = z.object({
  token: z.string().min(1),
  invitationId: z.string().min(1),
});

export async function acceptInvitationAction(
  input: z.infer<typeof Input>,
): Promise<void> {
  const user = await requireUser();
  const parsed = Input.parse(input);

  const invitation = await db.practiceInvitation.findUnique({
    where: { token: parsed.token },
  });
  if (!invitation || invitation.id !== parsed.invitationId) {
    throw new Error("Invitation not found");
  }
  if (invitation.acceptedAt) throw new Error("Already accepted");
  if (invitation.revokedAt) throw new Error("Invitation revoked");
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation expired");
  }
  if (user.email.toLowerCase() !== invitation.invitedEmail.toLowerCase()) {
    throw new Error("Invitation is addressed to a different email");
  }

  const payload = {
    invitationId: invitation.id,
    acceptedByUserId: user.id,
    invitedEmail: invitation.invitedEmail,
    role: invitation.role,
  };

  await appendEventAndApply(
    {
      practiceId: invitation.practiceId,
      actorUserId: user.id,
      type: "INVITATION_ACCEPTED",
      payload,
    },
    async (tx) =>
      projectInvitationAccepted(tx, {
        practiceId: invitation.practiceId,
        payload,
      }),
  );
}
