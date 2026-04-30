// src/app/(dashboard)/programs/staff/page.tsx
import { Users } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CITATIONS } from "@/lib/regulations/citations";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OfficerCheckbox } from "./OfficerCheckbox";
import { InviteMemberForm } from "./InviteMemberForm";
import { RevokeButton } from "./RevokeButton";
import { ResendButton } from "./ResendButton";
import { RemoveMemberButton } from "./RemoveMemberButton";
import type { OfficerRole } from "@/lib/events/registry";

export const metadata = { title: "Staff · My Programs" };

interface OfficerColumn {
  role: OfficerRole;
  label: string;
  tooltip: string;
}

const OFFICER_COLUMNS: OfficerColumn[] = [
  {
    role: "PRIVACY",
    label: "Privacy",
    tooltip: `Satisfies ${CITATIONS.HIPAA_PRIVACY_OFFICER.display} — Designate a Privacy Officer.`,
  },
  {
    role: "SECURITY",
    label: "Security",
    tooltip: `Satisfies ${CITATIONS.HIPAA_SECURITY_OFFICER.display} — Designate a Security Officer.`,
  },
  {
    role: "COMPLIANCE",
    label: "Compliance",
    tooltip:
      "Internal compliance lead. Will satisfy OIG and state-level requirements when those modules ship.",
  },
  {
    role: "SAFETY",
    label: "Safety",
    tooltip:
      "Workplace safety lead. Will satisfy OSHA General Duty requirements when that module ships.",
  },
];

export default async function StaffPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const [members, pendingInvitations] = await Promise.all([
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId, removedAt: null },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    }),
    db.practiceInvitation.findMany({
      where: {
        practiceId: pu.practiceId,
        acceptedAt: null,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const canInvite = pu.role === "OWNER" || pu.role === "ADMIN";
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Staff" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Users className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Designate compliance officers. Changes auto-update the matching
            HIPAA requirements on your module page.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Invite team members</h2>
          {canInvite && (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Have a list of staff? Invite everyone at once.
              </span>
              <Link
                href={"/programs/staff/bulk-invite" as Route}
                className="rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
              >
                + Bulk invite
              </Link>
            </div>
          )}
          <InviteMemberForm canInvite={canInvite} />
          {pendingInvitations.length > 0 && (
            <>
              <p className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground">
                Pending invitations ({pendingInvitations.length})
              </p>
              <ul className="divide-y rounded-md border">
                {pendingInvitations.map((inv) => {
                  const isExpired = inv.expiresAt.getTime() < Date.now();
                  const acceptUrl = `${baseUrl.replace(/\/$/, "")}/accept-invite/${inv.token}`;
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-xs font-medium text-foreground">
                            {inv.invitedEmail}
                          </p>
                          <Badge variant="secondary" className="text-[10px]">
                            {inv.role}
                          </Badge>
                          {isExpired && (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              style={{
                                color: "var(--gw-color-risk)",
                                borderColor: "var(--gw-color-risk)",
                              }}
                            >
                              Expired
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground">
                          Accept link:{" "}
                          <code className="rounded bg-muted px-1">
                            {acceptUrl}
                          </code>
                        </p>
                      </div>
                      {canInvite && (
                        <div className="flex items-center gap-2">
                          <ResendButton invitationId={inv.id} />
                          <RevokeButton invitationId={inv.id} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <TooltipProvider>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {members.map((m) => {
                const fullName = [m.user.firstName, m.user.lastName]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                const displayName = fullName || m.user.email;
                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {displayName}
                        </p>
                        <Badge variant="secondary" className="text-[10px]">
                          {m.role}
                        </Badge>
                      </div>
                      {fullName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {m.user.email}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canInvite && m.userId !== pu.userId && (
                        <RemoveMemberButton
                          practiceUserId={m.id}
                          memberLabel={m.user.email}
                        />
                      )}
                      {OFFICER_COLUMNS.map((col) => {
                        const flag =
                          col.role === "PRIVACY"
                            ? m.isPrivacyOfficer
                            : col.role === "SECURITY"
                              ? m.isSecurityOfficer
                              : col.role === "COMPLIANCE"
                                ? m.isComplianceOfficer
                                : m.isSafetyOfficer;
                        return (
                          <Tooltip key={col.role}>
                            <TooltipTrigger asChild>
                              <span>
                                <OfficerCheckbox
                                  practiceUserId={m.id}
                                  officerRole={col.role}
                                  initialChecked={flag}
                                  label={col.label}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{col.tooltip}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </TooltipProvider>
    </main>
  );
}
