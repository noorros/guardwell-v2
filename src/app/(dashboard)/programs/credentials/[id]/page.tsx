// src/app/(dashboard)/programs/credentials/[id]/page.tsx
import { notFound } from "next/navigation";
import type { Route } from "next";
import { IdCard } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { CredentialDetail } from "./CredentialDetail";

export const metadata = { title: "Credential · My Programs" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CredentialDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const credential = await db.credential.findUnique({
    where: { id },
    include: {
      credentialType: true,
      holder: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  if (!credential || credential.practiceId !== pu.practiceId) notFound();

  const canManage = pu.role === "OWNER" || pu.role === "ADMIN";

  // Fetch CEU activities (most recent 50, non-retired) + reminder config.
  // Evidence list is OWNER/ADMIN-only (audit #21 MN-6) — STAFF/VIEWER could
  // otherwise enumerate credential ids from the activity log and view/download
  // HR-sensitive evidence (DEA cert PDFs, malpractice insurance certs,
  // license cards). Defense-in-depth pairs with the role gate on
  // /api/evidence/[id]/download for entityType=CREDENTIAL.
  const [ceuActivities, reminderConfig, evidence] = await Promise.all([
    db.ceuActivity.findMany({
      where: { credentialId: id, retiredAt: null },
      orderBy: { activityDate: "desc" },
      take: 50,
      include: {
        certificateEvidence: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSizeBytes: true,
            status: true,
          },
        },
      },
    }),
    db.credentialReminderConfig.findUnique({
      where: { credentialId: id },
    }),
    canManage
      ? db.evidence.findMany({
          where: {
            practiceId: pu.practiceId,
            entityType: "CREDENTIAL",
            entityId: id,
            deletedAt: null,
          },
          orderBy: { uploadedAt: "desc" },
        })
      : Promise.resolve(null),
  ]);
  const holderName = credential.holder
    ? [credential.holder.user.firstName, credential.holder.user.lastName]
        .filter(Boolean)
        .join(" ") || credential.holder.user.email
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Credentials", href: "/programs/credentials" as Route },
          { label: "Detail" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <IdCard className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {credential.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {credential.credentialType.name}
            {holderName ? ` · Held by ${holderName}` : null}
          </p>
        </div>
      </header>
      <CredentialDetail
        canManage={canManage}
        credentialId={credential.id}
        credentialType={{
          name: credential.credentialType.name,
          ceuRequirementHours: credential.credentialType.ceuRequirementHours,
          ceuRequirementWindowMonths:
            credential.credentialType.ceuRequirementWindowMonths,
          requiresEvidenceByDefault:
            credential.credentialType.requiresEvidenceByDefault,
          renewalPeriodDays: credential.credentialType.renewalPeriodDays,
        }}
        credential={{
          title: credential.title,
          licenseNumber: credential.licenseNumber,
          issuingBody: credential.issuingBody,
          issueDate: credential.issueDate?.toISOString() ?? null,
          expiryDate: credential.expiryDate?.toISOString() ?? null,
          notes: credential.notes,
        }}
        ceuActivities={ceuActivities.map((a) => ({
          id: a.id,
          activityName: a.activityName,
          provider: a.provider,
          activityDate: a.activityDate.toISOString(),
          hoursAwarded: a.hoursAwarded,
          category: a.category,
          notes: a.notes,
          certificateEvidence: a.certificateEvidence,
        }))}
        reminderConfig={
          reminderConfig
            ? {
                id: reminderConfig.id,
                enabled: reminderConfig.enabled,
                milestoneDays: reminderConfig.milestoneDays,
              }
            : null
        }
        initialEvidence={
          evidence
            ? evidence.map((e) => ({
                id: e.id,
                fileName: e.fileName,
                mimeType: e.mimeType,
                fileSizeBytes: e.fileSizeBytes,
                uploadedAt: e.uploadedAt.toISOString(),
                status: e.status,
              }))
            : null
        }
      />
    </main>
  );
}
