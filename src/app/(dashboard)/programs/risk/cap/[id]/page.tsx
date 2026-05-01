// src/app/(dashboard)/programs/risk/cap/[id]/page.tsx
//
// Phase 5 PR 6 — CAP detail page. Server-rendered, IDOR-safe. Loads the
// CAP with its linked RiskItem (if any) + linked Evidence rows via the
// CorrectiveActionEvidence join.
//
// Routing note: this lives at /programs/risk/cap/[id] (NOT
// /programs/risk/[id] — that's the SRA assessment detail). The CapTab
// row links here; the create-CAP flow on RiskItem detail routes here on
// success; alert→CAP doesn't route automatically (alert detail page just
// shows "Action queued").

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ListChecks } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { effectiveCapStatus } from "@/lib/risk/capStatus";
import type { EffectiveCapStatus } from "@/lib/risk/types";
import { CapActions } from "./CapActions";

export const metadata = { title: "Corrective action · Risk & CAP" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function statusBadgeVariant(
  s: EffectiveCapStatus,
): "default" | "destructive" | "secondary" {
  if (s === "OVERDUE") return "destructive";
  if (s === "COMPLETED") return "secondary";
  if (s === "IN_PROGRESS") return "default";
  return "secondary";
}

function statusLabel(s: EffectiveCapStatus): string {
  return s[0] + s.slice(1).toLowerCase().replace("_", " ");
}

export default async function CapDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const cap = await db.correctiveAction.findUnique({
    where: { id },
    include: {
      riskItem: { select: { id: true, title: true, severity: true } },
      evidenceLinks: {
        include: {
          evidence: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              uploadedAt: true,
            },
          },
        },
        orderBy: { attachedAt: "desc" },
      },
    },
  });
  if (!cap || cap.practiceId !== pu.practiceId) notFound();

  const eff = effectiveCapStatus(cap.status, cap.dueDate);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Risk & CAP", href: "/programs/risk?tab=cap" as Route },
          { label: "Corrective action" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Corrective action
          </h1>
          <Badge variant={statusBadgeVariant(eff)}>{statusLabel(eff)}</Badge>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-sm">{cap.description}</p>
          {cap.dueDate && (
            <p className="text-xs text-muted-foreground">
              Due {cap.dueDate.toLocaleDateString()}
            </p>
          )}
          {cap.riskItem && (
            <p>
              <Link
                href={`/programs/risk/items/${cap.riskItem.id}` as Route}
                className="text-sm text-primary hover:underline"
              >
                ← Linked risk: {cap.riskItem.title}
              </Link>
            </p>
          )}
          {cap.sourceAlertId && (
            <p>
              <Link
                href={`/audit/regulatory/${cap.sourceAlertId}` as Route}
                className="text-sm text-primary hover:underline"
              >
                ← Source alert
              </Link>
            </p>
          )}
          {cap.notes && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {cap.notes}
            </p>
          )}
        </CardContent>
      </Card>

      {cap.evidenceLinks.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Linked evidence</h2>
            <ul className="space-y-1 text-sm">
              {cap.evidenceLinks.map(({ evidence }) => (
                <li key={evidence.id}>
                  {evidence.fileName} ({evidence.mimeType})
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CapActions
        capId={cap.id}
        currentStatus={cap.status}
        currentNotes={cap.notes}
      />

      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/programs/risk?tab=cap" as Route}>
            ← Back to CAP
          </Link>
        </Button>
      </div>
    </main>
  );
}
