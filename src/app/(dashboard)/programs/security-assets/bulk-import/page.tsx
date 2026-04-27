// src/app/(dashboard)/programs/security-assets/bulk-import/page.tsx
//
// Standalone bulk-import surface for tech assets. Practices typically
// already have an IT inventory in Excel/Google Sheets — this lets them
// upload it instead of typing 30 rows by hand.

import Link from "next/link";
import type { Route } from "next";
import { Server } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { TechAssetBulkImport } from "./TechAssetBulkImport";

export const metadata = { title: "Bulk import · Security assets" };

export default async function BulkImportPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canImport = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { href: "/programs" as Route, label: "My Programs" },
          {
            href: "/programs/security-assets" as Route,
            label: "Security assets",
          },
          { label: "Bulk import" },
        ]}
      />
      <div className="flex items-center gap-2">
        <Server className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Bulk import security assets</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Upload a CSV with one row per device or service that processes
        practice data. We&apos;ll insert each row as a new active asset.
        Existing assets with matching names are skipped.
      </p>
      {!canImport ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can import assets.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <TechAssetBulkImport />
            <p className="mt-6 text-xs text-muted-foreground">
              <Link
                href={"/programs/security-assets" as Route}
                className="underline"
              >
                ← Back to security assets
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
