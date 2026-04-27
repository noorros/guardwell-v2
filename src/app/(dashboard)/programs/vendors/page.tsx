// src/app/(dashboard)/programs/vendors/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Building2, FileUp, FileDown } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddVendorForm } from "./AddVendorForm";
import { VendorActions } from "./VendorActions";
import { BaaStatusBadge } from "./BaaStatusBadge";

export const metadata = { title: "Vendors · My Programs" };

export default async function VendorsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const vendors = await db.vendor.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ processesPhi: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      type: true,
      service: true,
      contact: true,
      email: true,
      processesPhi: true,
      baaExecutedAt: true,
      baaExpiresAt: true,
    },
  });

  const phiVendors = vendors.filter((v) => v.processesPhi);
  const phiWithBaa = phiVendors.filter(
    (v) =>
      v.baaExecutedAt !== null &&
      (v.baaExpiresAt === null || v.baaExpiresAt > new Date()),
  ).length;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Vendors" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            List every vendor your practice uses. Mark the ones that access or
            process PHI and sign a Business Associate Agreement with each.
            Coverage auto-updates your HIPAA module score.
          </p>
          {phiVendors.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {phiWithBaa} of {phiVendors.length} PHI vendor{phiVendors.length === 1 ? "" : "s"} covered by a current BAA.
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={"/programs/vendors/bulk-import" as Route}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden /> Bulk import (CSV)
        </Link>
        {vendors.length > 0 && (
          <a
            href="/api/vendors/export"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden /> Export CSV
          </a>
        )}
      </div>

      <AddVendorForm />

      {vendors.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No vendors yet. Add the ones you work with — EHR, billing
            clearinghouse, IT support, shredding, cloud storage — and flag
            which ones touch PHI.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {vendors.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{v.name}</p>
                      {v.type && (
                        <Badge variant="secondary" className="text-[10px]">
                          {v.type}
                        </Badge>
                      )}
                      <BaaStatusBadge
                        processesPhi={v.processesPhi}
                        baaExecutedAt={
                          v.baaExecutedAt ? v.baaExecutedAt.toISOString() : null
                        }
                        baaExpiresAt={
                          v.baaExpiresAt ? v.baaExpiresAt.toISOString() : null
                        }
                      />
                    </div>
                    {v.service && (
                      <p className="text-xs text-muted-foreground">{v.service}</p>
                    )}
                    {(v.contact || v.email) && (
                      <p className="text-[11px] text-muted-foreground">
                        {[v.contact, v.email].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <VendorActions
                    vendorId={v.id}
                    processesPhi={v.processesPhi}
                    hasBaa={
                      v.baaExecutedAt !== null &&
                      (v.baaExpiresAt === null || v.baaExpiresAt > new Date())
                    }
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
