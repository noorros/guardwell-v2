// src/app/(dashboard)/programs/document-retention/[id]/page.tsx
//
// DestructionLog detail page — shows event metadata + evidence upload
// section. The EvidenceUpload component is the first consumer of the
// Evidence polymorphic model.

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EvidenceUpload, type EvidenceItem } from "@/components/gw/EvidenceUpload";
import { deleteEvidenceAction } from "./actions";

export const dynamic = "force-dynamic";

const DOC_TYPE_LABELS: Record<string, string> = {
  MEDICAL_RECORDS: "Medical records",
  BILLING: "Billing",
  HR: "HR",
  EMAIL_BACKUPS: "Email/backups",
  OTHER: "Other",
};
const METHOD_LABELS: Record<string, string> = {
  SHREDDING: "Shredding",
  SECURE_WIPE: "Secure wipe",
  DEIDENTIFICATION: "Deidentification",
  INCINERATION: "Incineration",
  OTHER: "Other",
};

export default async function DestructionLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const [log, evidence] = await Promise.all([
    db.destructionLog.findFirst({
      where: { id, practiceId: pu.practiceId },
    }),
    db.evidence.findMany({
      where: {
        practiceId: pu.practiceId,
        entityType: "DESTRUCTION_LOG",
        entityId: id,
        status: { not: "DELETED" },
      },
      orderBy: { uploadedAt: "desc" },
    }),
  ]);

  if (!log) notFound();

  // Resolve the performer's name
  const performer = await db.user.findUnique({
    where: { id: log.performedByUserId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const performerLabel =
    performer?.firstName || performer?.lastName
      ? [performer.firstName, performer.lastName].filter(Boolean).join(" ")
      : performer?.email ?? "Unknown";

  const existingEvidence: EvidenceItem[] = evidence.map((e) => ({
    id: e.id,
    fileName: e.fileName,
    mimeType: e.mimeType,
    fileSizeBytes: e.fileSizeBytes,
    uploadedAt: e.uploadedAt.toISOString(),
    status: e.status,
  }));

  const canManage =
    pu.role === "OWNER" || pu.role === "ADMIN" || pu.role === "STAFF";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs", href: "/programs" },
          { label: "Document retention", href: "/programs/document-retention" },
          { label: log.destroyedAt.toISOString().slice(0, 10) },
        ]}
      />

      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Trash2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Destruction event —{" "}
            {log.destroyedAt.toISOString().slice(0, 10)}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {DOC_TYPE_LABELS[log.documentType] ?? log.documentType}
            </Badge>
            <Badge variant="outline">
              {METHOD_LABELS[log.method] ?? log.method}
            </Badge>
            {log.volumeEstimate && (
              <Badge variant="outline">{log.volumeEstimate}</Badge>
            )}
          </div>
        </div>
      </header>

      {/* Event details */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Description</dt>
              <dd className="mt-0.5">{log.description}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Performed by</dt>
              <dd className="mt-0.5">{performerLabel}</dd>
            </div>
            {log.notes && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-xs text-foreground">{log.notes}</dd>
              </div>
            )}
            {log.certificateUrl && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Certificate URL (legacy)
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={log.certificateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                  >
                    {log.certificateUrl}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Evidence / certificate upload */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Certificate of destruction
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Upload the vendor-issued PDF certificate or any supporting
            documentation. Multiple files are accepted.
          </p>
        </CardHeader>
        <CardContent>
          <EvidenceUpload
            entityType="DESTRUCTION_LOG"
            entityId={id}
            initialEvidence={existingEvidence}
            canManage={canManage}
            onUploaded={undefined}
            // Server action wrapper bound per-item below
          />
          {/* Server action: deletions are handled by the client via
              DELETE /api/evidence/[id] — no additional wiring needed here. */}
        </CardContent>
      </Card>

      <div className="flex">
        <Link
          href="/programs/document-retention"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to document retention
        </Link>
      </div>
    </main>
  );
}
