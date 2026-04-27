// src/app/(dashboard)/programs/document-retention/page.tsx
import Link from "next/link";
import { FileText, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/gw/EmptyState";
import { NewDestructionForm } from "./NewDestructionForm";

export const metadata = { title: "Document retention · My Programs" };
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

const RETENTION_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export default async function DocumentRetentionPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const [logs, performers, evidenceCounts] = await Promise.all([
    db.destructionLog.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { destroyedAt: "desc" },
      take: 50,
    }),
    db.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    db.evidence.groupBy({
      by: ["entityId"],
      where: {
        practiceId: pu.practiceId,
        entityType: "DESTRUCTION_LOG",
        status: { not: "DELETED" },
      },
      _count: { id: true },
    }),
  ]);
  const userById = new Map(performers.map((u) => [u.id, u]));
  const evidenceCountById = new Map(
    evidenceCounts.map((e) => [e.entityId, e._count.id]),
  );

  const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);
  const recentCount = logs.filter((l) => l.destroyedAt >= cutoff).length;
  const cadenceLabel =
    logs.length === 0
      ? "Cadence not yet established"
      : recentCount > 0
        ? `${recentCount} event${recentCount === 1 ? "" : "s"} in the last 12 months`
        : `Last event ${logs[0]!.destroyedAt.toISOString().slice(0, 10)} — over a year ago`;
  const cadenceTone =
    logs.length === 0
      ? "var(--gw-color-setup)"
      : recentCount > 0
        ? "var(--gw-color-compliant)"
        : "var(--gw-color-risk)";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Document retention" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Trash2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Document retention
          </h1>
          <p className="text-sm text-muted-foreground">
            HIPAA §164.530(j) requires you to retain required documentation
            for ≥6 years AND securely destroy it once retention expires.
            Each destruction event recorded here is your audit record that
            the cadence is real, not theoretical.
          </p>
          <p
            className="text-xs"
            style={{ color: cadenceTone }}
          >
            {cadenceLabel}
          </p>
        </div>
      </header>

      <NewDestructionForm />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent destruction events
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {logs.length} event{logs.length === 1 ? "" : "s"}
            </span>
          </div>
          {logs.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title="No destruction events recorded yet"
              description="Use the form above to log each batch of documents you destroy. Once you've logged ≥1 event in a 12-month window, the HIPAA documentation-retention requirement on /modules/hipaa flips to COMPLIANT."
            />
          ) : (
            <ul className="divide-y">
              {logs.map((l) => {
                const performer = userById.get(l.performedByUserId);
                const witness = l.witnessedByUserId
                  ? userById.get(l.witnessedByUserId)
                  : null;
                const performerLabel =
                  performer?.firstName || performer?.lastName
                    ? [performer.firstName, performer.lastName]
                        .filter(Boolean)
                        .join(" ")
                    : performer?.email ?? "Unknown";
                const evCount = evidenceCountById.get(l.id) ?? 0;
                return (
                  <li
                    key={l.id}
                    className="space-y-1 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/programs/document-retention/${l.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {l.destroyedAt.toISOString().slice(0, 10)} ·{" "}
                        {DOC_TYPE_LABELS[l.documentType] ?? l.documentType}
                      </Link>
                      <Badge variant="secondary" className="text-[10px]">
                        {METHOD_LABELS[l.method] ?? l.method}
                      </Badge>
                      {l.volumeEstimate && (
                        <Badge variant="outline" className="text-[10px]">
                          {l.volumeEstimate}
                        </Badge>
                      )}
                      {evCount > 0 && (
                        <Badge
                          variant="outline"
                          className="gap-1 text-[10px] text-primary"
                        >
                          <FileText className="h-2.5 w-2.5" aria-hidden />
                          {evCount} file{evCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground">{l.description}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Performed by {performerLabel}
                      {witness
                        ? ` · Witnessed by ${witness.firstName ?? witness.email}`
                        : ""}
                      {l.certificateUrl ? (
                        <>
                          {" · "}
                          <a
                            href={l.certificateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            Certificate URL
                          </a>
                        </>
                      ) : null}
                    </p>
                    {l.notes && (
                      <p className="text-[11px] text-muted-foreground">
                        {l.notes}
                      </p>
                    )}
                    <Link
                      href={`/programs/document-retention/${l.id}`}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Upload certificate →
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
