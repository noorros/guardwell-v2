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
  projectInvitationResent,
  projectMemberRemoved,
} from "@/lib/events/projections/invitation";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml } from "@/lib/email/template";

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
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  const href = acceptUrl(token);
  const subject = `${pu.practice.name} invited you to GuardWell`;
  const text = [
    `${user.email} invited you to join ${pu.practice.name} on GuardWell.`,
    `Role: ${parsed.role}.`,
    ``,
    `Accept the invitation: ${href}`,
    ``,
    `This invitation expires ${expiresAt.toUTCString()}.`,
    ``,
    `If you weren't expecting this, it's safe to ignore.`,
  ].join("\n");
  const html = renderEmailHtml({
    preheader: `${user.email} invited you to ${pu.practice.name} on GuardWell.`,
    headline: `You're invited to ${pu.practice.name}`,
    subheadline: `${user.email} wants you to join as ${parsed.role}.`,
    sections: [
      {
        html: `<p style="margin:0 0 8px;">GuardWell is how ${pu.practice.name} tracks compliance across HIPAA, OSHA, and other frameworks. Accept the invitation to collaborate with your team.</p><p style="margin:0; color:#64748B;">This invitation expires ${expiresAt.toUTCString()}.</p>`,
      },
    ],
    cta: { label: "Accept invitation", href },
    practiceName: pu.practice.name,
    baseUrl,
  });
  const result = await sendEmail({
    to: email,
    subject,
    text,
    html,
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

const ResendInput = z.object({
  invitationId: z.string().min(1),
});

export interface ResendResult {
  invitationId: string;
  emailDelivered: boolean;
  emailReason?: string;
}

export async function resendInvitationAction(
  input: z.infer<typeof ResendInput>,
): Promise<ResendResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can resend invitations");
  }
  const parsed = ResendInput.parse(input);
  const invite = await db.practiceInvitation.findUnique({
    where: { id: parsed.invitationId },
  });
  if (!invite) throw new Error("Invitation not found");
  if (invite.practiceId !== pu.practiceId) {
    throw new Error("Invitation not found");
  }
  if (invite.acceptedAt) throw new Error("Already accepted");
  if (invite.revokedAt) throw new Error("Invitation revoked");

  const newToken = randomBytes(24).toString("base64url");
  const newExpiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const payload = {
    invitationId: parsed.invitationId,
    newExpiresAt: newExpiresAt.toISOString(),
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INVITATION_RESENT",
      payload,
    },
    async (tx) =>
      projectInvitationResent(tx, {
        practiceId: pu.practiceId,
        newToken,
        payload,
      }),
  );

  // Email the fresh link. Same template as the original invite.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  const href = acceptUrl(newToken);
  const subject = `${pu.practice.name} — invitation resent`;
  const text = [
    `${user.email} re-sent your GuardWell invitation to ${pu.practice.name}.`,
    `Role: ${invite.role}.`,
    ``,
    `Accept the invitation: ${href}`,
    ``,
    `This invitation now expires ${newExpiresAt.toUTCString()}.`,
  ].join("\n");
  const html = renderEmailHtml({
    preheader: `${user.email} re-sent your invitation to ${pu.practice.name}.`,
    headline: `Your invitation was re-sent`,
    subheadline: `Join ${pu.practice.name} as ${invite.role}.`,
    sections: [
      {
        html: `<p style="margin:0;">Use the button below to accept. This link replaces any earlier ones and expires ${newExpiresAt.toUTCString()}.</p>`,
      },
    ],
    cta: { label: "Accept invitation", href },
    practiceName: pu.practice.name,
    baseUrl,
  });
  const result = await sendEmail({
    to: invite.invitedEmail,
    subject,
    text,
    html,
  });
  revalidatePath("/programs/staff");
  return {
    invitationId: parsed.invitationId,
    emailDelivered: result.delivered,
    emailReason: result.reason,
  };
}

const RemoveInput = z.object({
  practiceUserId: z.string().min(1),
});

export async function removeMemberAction(
  input: z.infer<typeof RemoveInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can remove team members");
  }
  const parsed = RemoveInput.parse(input);

  // Look up the target so we can include removedUserId in the event
  // payload — actors are recorded via the top-level actorUserId, but
  // the audit trail wants the removed user's id too.
  const target = await db.practiceUser.findUnique({
    where: { id: parsed.practiceUserId },
    select: { practiceId: true, userId: true, removedAt: true },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Team member not found");
  }
  if (target.removedAt) return; // already removed

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "MEMBER_REMOVED",
      payload: {
        practiceUserId: parsed.practiceUserId,
        removedUserId: target.userId,
      },
    },
    async (tx) =>
      projectMemberRemoved(tx, {
        practiceId: pu.practiceId,
        payload: {
          practiceUserId: parsed.practiceUserId,
          removedUserId: target.userId,
        },
      }),
  );

  revalidatePath("/programs/staff");
}
