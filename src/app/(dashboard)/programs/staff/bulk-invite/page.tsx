// src/app/(dashboard)/programs/staff/bulk-invite/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Users } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { BulkInviteForm } from "@/components/gw/BulkInviteForm";
import { bulkInviteAction } from "./actions";

export const metadata = { title: "Bulk invite · Staff" };

export default async function BulkInvitePage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canInvite = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { href: "/programs" as Route, label: "My Programs" },
          { href: "/programs/staff" as Route, label: "Staff" },
          { label: "Bulk invite" },
        ]}
      />
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Bulk invite team members</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste a list of emails or upload a CSV. Valid rows create individual
        invitations — each person receives the standard invite email with a 7-day
        accept link.
      </p>
      {!canInvite ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can invite team members.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <BulkInviteForm
              onSubmit={(rows) => bulkInviteAction({ rows })}
            />
            <p className="mt-6 text-xs text-muted-foreground">
              <Link href={"/programs/staff" as Route} className="underline">
                ← Back to staff
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
