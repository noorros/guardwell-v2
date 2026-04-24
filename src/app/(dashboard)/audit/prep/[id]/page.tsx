// src/app/(dashboard)/audit/prep/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck, Download } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";
import { StepPanel } from "./StepPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Prep session" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AuditPrepDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;
  const session = await db.auditPrepSession.findUnique({
    where: { id },
    include: { steps: { orderBy: { code: "asc" } } },
  });
  if (!session || session.practiceId !== pu.practiceId) notFound();
  const protocols = PROTOCOLS_BY_MODE[session.mode] ?? [];

  const completedCount = session.steps.filter(
    (s) => s.status !== "PENDING",
  ).length;
  const total = session.steps.length;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  const allDone =
    total > 0 && session.steps.every((s) => s.status !== "PENDING");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "Audit & Insights" },
          { label: "Audit Prep", href: "/audit/prep" as Route },
          { label: session.startedAt.toISOString().slice(0, 10) },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.mode.replace(/_/g, " ")} audit prep
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {session.status.replace(/_/g, " ")}
            </Badge>
            <span>Started {session.startedAt.toISOString().slice(0, 10)}</span>
            {session.packetGeneratedAt && (
              <span>
                Packet generated{" "}
                {session.packetGeneratedAt.toISOString().slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        <ScoreRing score={pct} size={64} strokeWidth={7} assessed />
      </header>

      <ul className="space-y-3">
        {protocols.map((p) => {
          const step = session.steps.find((s) => s.code === p.code);
          if (!step) return null;
          return (
            <li key={p.code}>
              <StepPanel
                sessionId={session.id}
                stepCode={p.code}
                title={p.title}
                citation={p.citation}
                description={p.description}
                whatWeAttach={p.whatWeAttach}
                status={step.status}
                notes={step.notes}
                completedAtIso={step.completedAt?.toISOString() ?? null}
              />
            </li>
          );
        })}
      </ul>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Generate audit packet</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {allDone
                ? "All protocols touched. Download the packet to send to your auditor or outside counsel."
                : `Complete ${total - completedCount} more protocol${
                    total - completedCount === 1 ? "" : "s"
                  } to enable packet generation.`}
            </p>
          </div>
          <Link
            href={`/api/audit/prep/${session.id}/packet` as Route}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              allDone
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
            aria-disabled={!allDone}
            onClick={(e) => {
              if (!allDone) e.preventDefault();
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download packet
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
