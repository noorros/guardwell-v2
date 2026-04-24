// src/app/(dashboard)/audit/prep/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/gw/EmptyState";
import { StartSessionForm } from "./StartSessionForm";

export const metadata = { title: "Audit Prep · Audit & Insights" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "var(--gw-color-setup)",
  IN_PROGRESS: "var(--gw-color-needs)",
  COMPLETED: "var(--gw-color-compliant)",
};

export default async function AuditPrepPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const sessions = await db.auditPrepSession.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { startedAt: "desc" },
    include: { steps: { select: { status: true } } },
    take: 20,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Audit Prep" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Prep</h1>
          <p className="text-sm text-muted-foreground">
            Guided pre-audit walkthrough. Pick the audit type, work through
            the protocols, then download a packet to send your auditor or
            outside counsel. Evidence is snapshotted at completion so the
            packet stays stable even if your data changes later.
          </p>
        </div>
      </header>

      <StartSessionForm />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Past sessions
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </span>
          </div>
          {sessions.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No audit-prep sessions yet"
              description="Start a session above when you receive an audit notice or want to validate readiness ahead of one."
            />
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => {
                const completed = s.steps.filter(
                  (st) => st.status !== "PENDING",
                ).length;
                const total = s.steps.length;
                const pct =
                  total === 0 ? 0 : Math.round((completed / total) * 100);
                return (
                  <li key={s.id} className="space-y-1 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/audit/prep/${s.id}` as Route}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {s.mode.replace(/_/g, " ")} ·{" "}
                        {s.startedAt.toISOString().slice(0, 10)}
                      </Link>
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{
                          color:
                            STATUS_TONE[s.status] ?? "var(--gw-color-setup)",
                          borderColor:
                            STATUS_TONE[s.status] ?? "var(--gw-color-setup)",
                        }}
                      >
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {completed} of {total} protocols touched · {pct}%
                    </p>
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
