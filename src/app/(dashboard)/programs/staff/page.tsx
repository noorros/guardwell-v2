// src/app/(dashboard)/programs/staff/page.tsx
import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OfficerCheckbox } from "./OfficerCheckbox";
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
    tooltip: "Satisfies HIPAA §164.530(a)(1)(i) — Designate a Privacy Officer.",
  },
  {
    role: "SECURITY",
    label: "Security",
    tooltip: "Satisfies HIPAA §164.308(a)(2) — Designate a Security Officer.",
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

  const members = await db.practiceUser.findMany({
    where: { practiceId: pu.practiceId, removedAt: null },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });

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
