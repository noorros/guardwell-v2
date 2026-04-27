// src/app/(dashboard)/programs/credentials/bulk-import/page.tsx

import Link from "next/link";
import type { Route } from "next";
import { IdCard } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { CredentialBulkImport } from "./CredentialBulkImport";

export const metadata = { title: "Bulk import · Credentials" };

export default async function BulkImportPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canImport = pu.role === "OWNER" || pu.role === "ADMIN";

  // Surface the available credential type codes so users know what to put
  // in the credentialTypeCode column.
  const types = await db.credentialType.findMany({
    select: { code: true, name: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { href: "/programs" as Route, label: "My Programs" },
          { href: "/programs/credentials" as Route, label: "Credentials" },
          { label: "Bulk import" },
        ]}
      />
      <div className="flex items-center gap-2">
        <IdCard className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Bulk import credentials</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Upload a CSV with one row per license, registration, or insurance
        policy. Use <code>holderEmail</code> to attach the credential to a
        staff member (must be an active practice member); leave blank for
        practice-level credentials.
      </p>
      {!canImport ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can import credentials.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <CredentialBulkImport />
            <details className="mt-6 text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Available credentialTypeCode values ({types.length})
              </summary>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-foreground">
                {types.map((t) => (
                  <li key={t.code} className="font-mono text-[11px]">
                    {t.code} — {t.name}
                  </li>
                ))}
              </ul>
            </details>
            <p className="mt-6 text-xs text-muted-foreground">
              <Link
                href={"/programs/credentials" as Route}
                className="underline"
              >
                ← Back to credentials
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
