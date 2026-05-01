// src/app/(dashboard)/programs/risk/items/[id]/page.tsx
//
// Phase 5 PR 5 — RiskItem detail. NEW path (NOT [id] — that's the SRA
// detail). Server-rendered, IDOR-safe (riskItem.practiceId !==
// pu.practiceId → notFound()). Renders source-resolved metadata,
// severity badge, status select + notes textarea via <RiskItemActions>,
// and a placeholder for the linked CorrectiveActions (filled out in PR 6).

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  riskSeverityBadgeVariant,
  riskSeverityLabel,
} from "@/lib/risk/severity";
import type { RiskSource } from "@/lib/risk/types";
import { RiskItemActions } from "./RiskItemActions";

interface PageProps {
  params: Promise<{ id: string }>;
}

const SOURCE_LABEL: Record<RiskSource, string> = {
  SRA: "Security Risk Assessment",
  TECHNICAL_ASSESSMENT: "Technical Security Assessment",
  MANUAL: "Manually added",
  INCIDENT_FOLLOWUP: "Incident follow-up",
  REGULATORY_ALERT: "Regulatory alert",
};

const ANSWER_LABEL: Record<string, string> = {
  YES: "Yes — addressed",
  PARTIAL: "Partial",
  NO: "No — gap",
  NA: "N/A",
};

export default async function RiskItemDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const riskItem = await db.riskItem.findUnique({
    where: { id },
    include: {
      correctiveActions: {
        select: { id: true, status: true },
      },
    },
  });
  if (!riskItem || riskItem.practiceId !== pu.practiceId) notFound();

  // Resolve source-link metadata so we can render "From SRA — answer was
  // NO to question Y". The SRA assessment / TA assessment / regulatory
  // alert lookups are best-effort: if the link doesn't resolve we fall
  // back to the title alone. None of these queries can leak cross-tenant
  // data because every lookup is scoped by the riskItem.practiceId
  // constraint we already verified.
  let sraMeta: {
    questionTitle: string;
    answerLabel: string;
  } | null = null;
  let taMeta: {
    questionTitle: string;
    answerLabel: string;
  } | null = null;

  if (riskItem.source === "SRA" && riskItem.sourceCode && riskItem.sourceRefId) {
    const [question, ans] = await Promise.all([
      db.sraQuestion.findUnique({
        where: { code: riskItem.sourceCode },
        select: { id: true, title: true },
      }),
      // Find the answer for this assessment + question by joining via
      // PracticeSraAnswer on questionId. We have the question.code; map
      // through findFirst for safety.
      db.practiceSraAnswer.findFirst({
        where: {
          assessmentId: riskItem.sourceRefId,
          question: { code: riskItem.sourceCode },
        },
        select: { answer: true },
      }),
    ]);
    if (question) {
      sraMeta = {
        questionTitle: question.title,
        answerLabel: ANSWER_LABEL[ans?.answer ?? ""] ?? "Unknown",
      };
    }
  }
  if (
    riskItem.source === "TECHNICAL_ASSESSMENT" &&
    riskItem.sourceCode &&
    riskItem.sourceRefId
  ) {
    const [question, ans] = await Promise.all([
      db.techAssessmentQuestion.findUnique({
        where: { code: riskItem.sourceCode },
        select: { id: true, title: true },
      }),
      db.techAssessmentAnswer.findFirst({
        where: {
          assessmentId: riskItem.sourceRefId,
          question: { code: riskItem.sourceCode },
        },
        select: { answer: true },
      }),
    ]);
    if (question) {
      taMeta = {
        questionTitle: question.title,
        answerLabel: ANSWER_LABEL[ans?.answer ?? ""] ?? "Unknown",
      };
    }
  }

  const openCaps = riskItem.correctiveActions.filter(
    (c) => c.status !== "COMPLETED",
  ).length;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Risk & CAP", href: "/programs/risk" as Route },
          { label: "Risk item" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {riskItem.title}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={riskSeverityBadgeVariant(riskItem.severity)}
              className="text-[10px]"
            >
              {riskSeverityLabel(riskItem.severity)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {SOURCE_LABEL[riskItem.source]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {riskItem.category.replaceAll("_", " ")}
            </Badge>
          </div>
        </div>
      </header>

      {(sraMeta || taMeta) && (
        <Card>
          <CardContent className="space-y-1 p-4 text-xs text-muted-foreground">
            {sraMeta && (
              <p>
                Generated from your{" "}
                <Link
                  href={`/programs/risk/${riskItem.sourceRefId}` as Route}
                  className="underline"
                >
                  Security Risk Assessment
                </Link>{" "}
                — your answer was{" "}
                <span className="font-medium text-foreground">
                  {sraMeta.answerLabel}
                </span>{" "}
                to question{" "}
                <span className="font-medium text-foreground">
                  &quot;{sraMeta.questionTitle}&quot;
                </span>
                .
              </p>
            )}
            {taMeta && (
              <p>
                Generated from your{" "}
                <Link
                  href={
                    `/programs/tech-assessment/${riskItem.sourceRefId}` as Route
                  }
                  className="underline"
                >
                  Technical Security Assessment
                </Link>{" "}
                — your answer was{" "}
                <span className="font-medium text-foreground">
                  {taMeta.answerLabel}
                </span>{" "}
                to control{" "}
                <span className="font-medium text-foreground">
                  &quot;{taMeta.questionTitle}&quot;
                </span>
                .
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-sm text-muted-foreground">
            {riskItem.description}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Manage</h2>
          <RiskItemActions
            riskItemId={riskItem.id}
            initialStatus={riskItem.status}
            initialNotes={riskItem.notes}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Corrective actions</h2>
          {riskItem.correctiveActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No corrective actions linked yet. Full CAP UI ships in the
              next release.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {openCaps === 0
                ? `${riskItem.correctiveActions.length} corrective action(s) — all completed.`
                : `${openCaps} of ${riskItem.correctiveActions.length} corrective action(s) still in progress.`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/programs/risk?tab=register" as Route}>
            ← Back to Risk Register
          </Link>
        </Button>
      </div>
    </main>
  );
}
