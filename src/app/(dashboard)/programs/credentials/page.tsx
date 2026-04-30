// src/app/(dashboard)/programs/credentials/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { IdCard, FileUp, FileDown } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddCredentialForm, type HolderOption, type CredentialTypeOption } from "./AddCredentialForm";
import { CredentialStatusBadge } from "./CredentialStatusBadge";
import { CredentialActions } from "./CredentialActions";
import { getCredentialStatus } from "@/lib/credentials/status";
import { buildCredentialGroups, type HolderForGrouping } from "./grouping";

export const metadata = { title: "Credentials · My Programs" };

type PracticeUserRow = Awaited<
  ReturnType<typeof db.practiceUser.findMany>
>[number] & {
  user: { email: string; firstName: string | null; lastName: string | null };
};

function displayName(pu: PracticeUserRow): string {
  const full = [pu.user.firstName, pu.user.lastName].filter(Boolean).join(" ").trim();
  return full || pu.user.email;
}

export default async function CredentialsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const [holders, credentialTypes, credentials] = await Promise.all([
    // Audit #21 / Credentials CR-4: include removed PracticeUsers so
    // their credentials still render. MEMBER_REMOVED is a soft-delete
    // (sets removedAt), which doesn't trigger the FK SetNull cascade —
    // so the stored Credential.holderId still points at the removed
    // PracticeUser. Filtering removedAt:null here used to silently hide
    // those credentials from the UI even though framework-derivation,
    // CSV exports, and audit PDFs still counted them. Render them under
    // a "Former staff" label so they remain visible for renewal /
    // retirement workflows.
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    }),
    db.credentialType.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { code: true, name: true, category: true, renewalPeriodDays: true },
    }),
    db.credential.findMany({
      where: { practiceId: pu.practiceId, retiredAt: null },
      orderBy: [{ holderId: "asc" }, { expiryDate: "asc" }],
      include: { credentialType: { select: { code: true, name: true, category: true } } },
    }),
  ]);

  // Active staff feed the Add-credential dropdown; off-boarded users are
  // excluded so operators can't assign new credentials to them.
  const activeHolders = (holders as PracticeUserRow[]).filter(
    (h) => h.removedAt === null,
  );
  const holderOptions: HolderOption[] = activeHolders.map((h) => ({
    id: h.id,
    name: displayName(h),
  }));
  const typeOptions: CredentialTypeOption[] = credentialTypes;

  // Build the grouped/ordered render plan. Active holders first (in
  // their listed order), former staff after, practice-level last —
  // matching the existing convention.
  const holdersForGrouping: HolderForGrouping[] = (holders as PracticeUserRow[]).map(
    (h) => ({
      id: h.id,
      displayName: displayName(h),
      removedAt: h.removedAt,
    }),
  );
  const groups = buildCredentialGroups(holdersForGrouping, credentials);

  const now = new Date();

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Credentials" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <IdCard className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track state licenses, DEA registrations, board certifications,
            BLS/ACLS cards, vaccinations, insurance, and other expiring
            evidence per provider. Future OSHA / DEA / CLIA module requirements
            will pull from this list automatically.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={"/programs/credentials/bulk-import" as Route}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden /> Bulk import (CSV)
        </Link>
        {credentials.length > 0 && (
          <a
            href="/api/credentials/export"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden /> Export CSV
          </a>
        )}
      </div>

      <AddCredentialForm holders={holderOptions} credentialTypes={typeOptions} />

      {credentials.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No credentials yet. Add the licenses and certifications your
            practice tracks — state medical licenses, DEA registrations,
            malpractice insurance, BLS/ACLS cards, and anything else with
            an expiration.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const list = group.credentials;
            return (
              <Card key={group.key}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.heading}
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      {list.length} credential{list.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="divide-y">
                    {list.map((c) => (
                      <li
                        key={c.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/30 transition-colors"
                      >
                        <Link
                          href={`/programs/credentials/${c.id}` as Route}
                          className="min-w-0 flex-1 space-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {c.title}
                            </p>
                            <Badge variant="secondary" className="text-[10px]">
                              {c.credentialType.category.replaceAll("_", " ")}
                            </Badge>
                            <CredentialStatusBadge
                              status={getCredentialStatus(c.expiryDate, now)}
                              expiryDate={c.expiryDate ? c.expiryDate.toISOString() : null}
                            />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {c.credentialType.name}
                            {c.licenseNumber && ` · #${c.licenseNumber}`}
                            {c.issuingBody && ` · ${c.issuingBody}`}
                          </p>
                          {c.notes && (
                            <p className="text-[11px] text-muted-foreground">
                              {c.notes}
                            </p>
                          )}
                        </Link>
                        <CredentialActions credentialId={c.id} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
