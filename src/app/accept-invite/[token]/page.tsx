// src/app/accept-invite/[token]/page.tsx
//
// Public-ish invitation-accept surface. Must live outside (dashboard)
// because invitees don't have a PracticeUser yet and that group's layout
// redirects to /onboarding/create-practice when one is missing.
//
// Flow:
//   1. Look up invitation by token.
//   2. If the viewer isn't signed in → redirect to /sign-in with the
//      accept URL preserved so they land back here after auth.
//   3. If the signed-in user's email doesn't match the invited email →
//      show a warning (don't auto-accept the wrong inbox).
//   4. Otherwise render the AcceptButton.

import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptInvitationButton } from "./AcceptInvitationButton";
import { formatPracticeDate } from "@/lib/audit/format";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation · GuardWell" };

export default async function AcceptInvitePage({ params }: PageProps) {
  const { token } = await params;

  const invitation = await db.practiceInvitation.findUnique({
    where: { token },
  });
  if (!invitation) notFound();
  const [practice, invitedBy] = await Promise.all([
    db.practice.findUnique({
      where: { id: invitation.practiceId },
      select: { name: true },
    }),
    db.user.findUnique({
      where: { id: invitation.invitedByUserId },
      select: { email: true },
    }),
  ]);
  if (!practice) notFound();

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/sign-in?redirect=${encodeURIComponent(`/accept-invite/${token}`)}` as Route,
    );
  }

  const normalizedInvitedEmail = invitation.invitedEmail.toLowerCase();
  const viewerEmail = user.email.toLowerCase();
  const emailMismatch = viewerEmail !== normalizedInvitedEmail;
  // eslint-disable-next-line react-hooks/purity -- Server component; Date.now() is safe here.
  const isExpired = invitation.expiresAt.getTime() < Date.now();
  const isRevoked = invitation.revokedAt !== null;
  const isAccepted = invitation.acceptedAt !== null;
  const canAccept = !emailMismatch && !isExpired && !isRevoked && !isAccepted;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <Card className="w-full">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Join {practice.name}</h1>
            <p className="text-xs text-muted-foreground">
              {invitedBy?.email ?? "A teammate"} invited{" "}
              <span className="font-medium">{invitation.invitedEmail}</span> to
              collaborate on GuardWell as{" "}
              <span className="font-medium">{invitation.role}</span>.
            </p>
          </div>

          {isAccepted && (
            <p className="rounded-md border border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_10%,transparent)] p-3 text-xs text-foreground">
              This invitation has already been accepted.
            </p>
          )}
          {isRevoked && (
            <p className="rounded-md border border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_10%,transparent)] p-3 text-xs text-foreground">
              This invitation was revoked. Ask the practice owner to resend.
            </p>
          )}
          {isExpired && !isAccepted && !isRevoked && (
            <p className="rounded-md border border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_10%,transparent)] p-3 text-xs text-foreground">
              This invitation expired{" "}
              {/* Unauthenticated viewer — no practice context available. UTC is the
                  safe default for token landing pages; if we ever attach the inviting
                  practice's timezone to the token row, switch to that. */}
              {formatPracticeDate(invitation.expiresAt, "UTC")}. Ask the practice
              owner to resend.
            </p>
          )}
          {emailMismatch && !isAccepted && !isRevoked && !isExpired && (
            <p className="rounded-md border border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_10%,transparent)] p-3 text-xs text-foreground">
              You&apos;re signed in as <span className="font-medium">{user.email}</span>,
              but this invitation was addressed to{" "}
              <span className="font-medium">{invitation.invitedEmail}</span>. Sign
              in with the invited address to accept.
            </p>
          )}

          {canAccept && (
            <AcceptInvitationButton
              token={token}
              invitationId={invitation.id}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
