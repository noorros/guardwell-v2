// src/app/(dashboard)/programs/vendors/bulk-import/page.tsx

import Link from "next/link";
import type { Route } from "next";
import { Building2 } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { VendorBulkImport } from "./VendorBulkImport";

export const metadata = { title: "Bulk import · Vendors" };

export default async function BulkImportPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canImport = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { href: "/programs" as Route, label: "My Programs" },
          { href: "/programs/vendors" as Route, label: "Vendors" },
          { label: "Bulk import" },
        ]}
      />
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Bulk import vendors</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Upload a CSV with one row per vendor. BAA execution + expiration
        columns are optional — leave blank if you&apos;re still gathering
        them. Existing vendors with matching names are skipped.
      </p>
      {!canImport ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can import vendors.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <VendorBulkImport />
            <p className="mt-6 text-xs text-muted-foreground">
              <Link
                href={"/programs/vendors" as Route}
                className="underline"
              >
                ← Back to vendors
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
