// src/app/(dashboard)/programs/vendors/[id]/page.tsx
import { notFound } from "next/navigation";
import type { Route } from "next";
import { Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { VendorDetail } from "./VendorDetail";

export const metadata = { title: "Vendor · My Programs" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VendorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const vendor = await db.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.practiceId !== pu.practiceId) notFound();

  // Fetch the most recent BAA requests + their pending tokens + the
  // draft Evidence row. Scoped to non-retired requests, capped at 10
  // for v1 (renewal history surfaces the last few cycles).
  const baaRequests = await db.baaRequest.findMany({
    where: { vendorId: id, retiredAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      draftEvidence: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSizeBytes: true,
          status: true,
          uploadedAt: true,
        },
      },
      acceptanceTokens: {
        where: {
          revokedAt: null,
          consumedAt: null,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const canManage = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Vendors", href: "/programs/vendors" as Route },
          { label: "Detail" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{vendor.name}</h1>
          <p className="text-sm text-muted-foreground">
            {vendor.type ?? "—"}
            {vendor.email ? ` · ${vendor.email}` : null}
            {vendor.processesPhi ? " · Processes PHI" : ""}
          </p>
        </div>
      </header>
      <VendorDetail
        canManage={canManage}
        practiceId={pu.practiceId}
        vendor={{
          id: vendor.id,
          name: vendor.name,
          type: vendor.type,
          service: vendor.service,
          contact: vendor.contact,
          email: vendor.email,
          notes: vendor.notes,
          processesPhi: vendor.processesPhi,
          baaDirection: vendor.baaDirection,
          baaExecutedAt: vendor.baaExecutedAt?.toISOString() ?? null,
          baaExpiresAt: vendor.baaExpiresAt?.toISOString() ?? null,
        }}
        baaRequests={baaRequests.map((r) => ({
          id: r.id,
          status: r.status,
          recipientEmail: r.recipientEmail,
          recipientMessage: r.recipientMessage,
          draftUploadedAt: r.draftUploadedAt?.toISOString() ?? null,
          sentAt: r.sentAt?.toISOString() ?? null,
          acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
          executedAt: r.executedAt?.toISOString() ?? null,
          rejectedAt: r.rejectedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          vendorSignatureName: r.vendorSignatureName,
          rejectionReason: r.rejectionReason,
          draftEvidence: r.draftEvidence
            ? {
                id: r.draftEvidence.id,
                fileName: r.draftEvidence.fileName,
                mimeType: r.draftEvidence.mimeType,
                fileSizeBytes: r.draftEvidence.fileSizeBytes,
                status: r.draftEvidence.status,
                uploadedAt: r.draftEvidence.uploadedAt.toISOString(),
              }
            : null,
          activeToken: r.acceptanceTokens[0]
            ? {
                id: r.acceptanceTokens[0].id,
                expiresAt: r.acceptanceTokens[0].expiresAt.toISOString(),
              }
            : null,
        }))}
      />
    </main>
  );
}
