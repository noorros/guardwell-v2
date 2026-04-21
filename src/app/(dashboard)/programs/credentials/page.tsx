// src/app/(dashboard)/programs/credentials/page.tsx
import { IdCard } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddCredentialForm, type HolderOption, type CredentialTypeOption } from "./AddCredentialForm";
import { CredentialStatusBadge, type CredentialStatus } from "./CredentialStatusBadge";
import { CredentialActions } from "./CredentialActions";

const EXPIRING_SOON_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function deriveStatus(expiryDate: Date | null, now: Date): CredentialStatus {
  if (!expiryDate) return "NO_EXPIRY";
  const ms = expiryDate.getTime() - now.getTime();
  if (ms < 0) return "EXPIRED";
  if (ms / DAY_MS <= EXPIRING_SOON_DAYS) return "EXPIRING_SOON";
  return "ACTIVE";
}

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
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId, removedAt: null },
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

  const holderOptions: HolderOption[] = (holders as PracticeUserRow[]).map(
    (h) => ({ id: h.id, name: displayName(h) }),
  );
  const typeOptions: CredentialTypeOption[] = credentialTypes;

  // Group credentials by holderId (null → "practice-level").
  const grouped = new Map<string | null, typeof credentials>();
  for (const c of credentials) {
    const key = c.holderId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  const holderNameById = new Map(
    (holders as PracticeUserRow[]).map((h) => [h.id, displayName(h)]),
  );

  // Show holder sections in the same order as the holders list; put practice-level last.
  const orderedKeys: Array<string | null> = [
    ...(holders as PracticeUserRow[])
      .map((h) => h.id)
      .filter((id) => grouped.has(id)),
  ];
  if (grouped.has(null)) orderedKeys.push(null);

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
          {orderedKeys.map((key) => {
            const list = grouped.get(key)!;
            const heading =
              key === null ? "Practice-level" : (holderNameById.get(key) ?? "Unknown");
            return (
              <Card key={key ?? "practice-level"}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {heading}
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      {list.length} credential{list.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="divide-y">
                    {list.map((c) => (
                      <li
                        key={c.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {c.title}
                            </p>
                            <Badge variant="secondary" className="text-[10px]">
                              {c.credentialType.category.replaceAll("_", " ")}
                            </Badge>
                            <CredentialStatusBadge
                              status={deriveStatus(c.expiryDate, now)}
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
                        </div>
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
