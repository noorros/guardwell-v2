// src/app/(dashboard)/programs/staff/invitation-actions.ts
"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectUserInvited,
  projectInvitationRevoked,
} from "@/lib/events/projections/invitation";
import { sendEmail } from "@/lib/email/send";

const InviteInput = z.object({
  email: z.string().email().max(200),
  role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
});

const INVITATION_TTL_DAYS = 7;

export interface InviteResult {
  invitationId: string;
  emailDelivered: boolean;
  emailReason?: string;
}

function acceptUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  return `${base.replace(/\/$/, "")}/accept-invite/${token}`;
}

export async function inviteTeamMemberAction(
  input: z.infer<typeof InviteInput>,
): Promise<InviteResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can invite team members");
  }
  const parsed = InviteInput.parse(input);
  const email = parsed.email.toLowerCase();

  // Token is what goes in the URL. Separate from the invitationId so
  // inviteId is safe to expose in UIs / activity logs while the token
  // remains a bearer secret.
  const invitationId = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const payload = {
    invitationId,
    invitedEmail: email,
    role: parsed.role,
    expiresAt: expiresAt.toISOString(),
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "USER_INVITED",
      payload,
    },
    async (tx) =>
      projectUserInvited(tx, {
        practiceId: pu.practiceId,
        invitedByUserId: user.id,
        token,
        payload,
      }),
  );

  // Best-effort email. Dev environments without RESEND_API_KEY return
  // delivered=false; the invitation row still exists and the accept URL
  // is visible in the staff-page "Pending invitations" list.
  const result = await sendEmail({
    to: email,
    subject: `${pu.practice.name} invited you to GuardWell`,
    text: [
      `${user.email} invited you to join ${pu.practice.name} on GuardWell.`,
      `Role: ${parsed.role}.`,
      ``,
      `Accept the invitation: ${acceptUrl(token)}`,
      ``,
      `This invitation expires ${expiresAt.toUTCString()}.`,
      ``,
      `If you weren't expecting this, it's safe to ignore.`,
    ].join("\n"),
  });

  revalidatePath("/programs/staff");

  return {
    invitationId,
    emailDelivered: result.delivered,
    emailReason: result.reason,
  };
}

const RevokeInput = z.object({
  invitationId: z.string().min(1),
});

export async function revokeInvitationAction(
  input: z.infer<typeof RevokeInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can revoke invitations");
  }
  const parsed = RevokeInput.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INVITATION_REVOKED",
      payload: { invitationId: parsed.invitationId },
    },
    async (tx) =>
      projectInvitationRevoked(tx, {
        practiceId: pu.practiceId,
        payload: { invitationId: parsed.invitationId },
      }),
  );

  revalidatePath("/programs/staff");
}
