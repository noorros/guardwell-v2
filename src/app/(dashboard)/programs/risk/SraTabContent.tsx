// src/app/(dashboard)/programs/risk/SraTabContent.tsx
//
// Phase 5 PR 5 — preserves the EXISTING /programs/risk page chrome
// (score badge, "Start new SRA" button, history list, draft resume) but
// scoped to render inside the new 4-tab dashboard's "SRA" tab. Server-
// rendered; the parent page passes already-fetched assessments + draft
// so this component does no DB I/O.

import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CITATIONS } from "@/lib/regulations/citations";
import { SraAssessmentBadge } from "./SraAssessmentBadge";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SraTabContentProps {
  completedAssessments: Array<{
    id: string;
    completedAt: Date | null;
    overallScore: number;
    addressedCount: number;
    totalCount: number;
  }>;
  draft: {
    id: string;
    addressedCount: number;
    totalCount: number;
  } | null;
}

export function SraTabContent({
  completedAssessments,
  draft,
}: SraTabContentProps) {
  const latest = completedAssessments[0];
  const now = new Date();
  const isFresh =
    latest?.completedAt != null &&
    now.getTime() - latest.completedAt.getTime() < 365 * DAY_MS;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 p-6">
          <h2 className="text-sm font-semibold">Security Risk Assessment</h2>
          <p className="text-sm text-muted-foreground">
            {CITATIONS.HIPAA_SRA.display} requires every covered entity to
            conduct a thorough, documented Security Risk Assessment — and
            to update it whenever significant changes occur (and at least
            annually). Completing an SRA here auto-updates HIPAA_SRA on
            your module page.
          </p>
        </CardContent>
      </Card>

      {draft && (
        <Card className="border-[color:var(--gw-color-setup)]/50 bg-[color:color-mix(in_oklch,var(--gw-color-setup)_8%,transparent)]">
          <CardContent className="space-y-3 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">In-progress SRA</h2>
              <Badge variant="outline" className="text-[10px]">
                Draft · {draft.addressedCount} of {draft.totalCount} answered
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              You have a draft SRA in progress. Pick up where you left off
              — your answers are saved automatically as you move between
              steps.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/programs/risk/new?draftId=${draft.id}` as Route}>
                  Resume draft
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">Current status</h2>
            {latest?.completedAt ? (
              <SraAssessmentBadge
                completedAt={latest.completedAt.toISOString()}
                overallScore={latest.overallScore}
                fresh={isFresh}
              />
            ) : (
              <Badge variant="outline" className="text-[10px]">
                No SRA on file
              </Badge>
            )}
          </div>
          {latest?.completedAt ? (
            <p className="text-xs text-muted-foreground">
              {isFresh
                ? `Last assessment addressed ${latest.addressedCount} of ${latest.totalCount} safeguards. HIPAA_SRA will auto-expire 365 days after completion — schedule a refresh before then.`
                : `Last assessment is older than 365 days. Run a new SRA to re-establish HIPAA_SRA compliance.`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No SRA has been completed for this practice yet. Click
              &quot;Start new SRA&quot; to answer 80 safeguard questions
              covering administrative, physical, and technical controls.
              Expect 30-60 minutes.
            </p>
          )}
          <div>
            <Button asChild size="sm" variant={draft ? "outline" : "default"}>
              <Link href={"/programs/risk/new" as Route}>
                {latest ? "Start new SRA" : "Start your first SRA"}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {completedAssessments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Assessment history
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {completedAssessments.length} assessment
                {completedAssessments.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y">
              {completedAssessments.map((a) => {
                if (!a.completedAt) return null;
                const completedAt = a.completedAt;
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          SRA
                        </p>
                        <SraAssessmentBadge
                          completedAt={completedAt.toISOString()}
                          overallScore={a.overallScore}
                          fresh={
                            now.getTime() - completedAt.getTime() <
                            365 * DAY_MS
                          }
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {a.addressedCount} of {a.totalCount} safeguards
                        addressed
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/programs/risk/${a.id}` as Route}>
                        View
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
