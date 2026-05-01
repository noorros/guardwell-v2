// src/app/(dashboard)/programs/risk/TechTabContent.tsx
//
// Phase 5 PR 5 — preserves the EXISTING /programs/tech-assessment page
// chrome (status, history, draft resume, "Start new assessment" CTA)
// scoped to render inside the new 4-tab dashboard's "Tech Assessment"
// tab. Server-rendered; the parent passes already-fetched assessments +
// draft so this component does no DB I/O.

import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TechTabContentProps {
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

export function TechTabContent({
  completedAssessments,
  draft,
}: TechTabContentProps) {
  const latest = completedAssessments[0];
  const now = new Date();
  const isFresh =
    latest?.completedAt != null &&
    now.getTime() - latest.completedAt.getTime() < 365 * DAY_MS;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 p-6">
          <h2 className="text-sm font-semibold">
            Technical Security Assessment
          </h2>
          <p className="text-sm text-muted-foreground">
            Document your technical controls — firewalls, endpoint
            protection, cloud BAAs, MFA, log review, backups. Findings
            here flow into the Risk Register and feed evidence chains for
            your HIPAA SRA.
          </p>
        </CardContent>
      </Card>

      {draft && (
        <Card className="border-[color:var(--gw-color-setup)]/50 bg-[color:color-mix(in_oklch,var(--gw-color-setup)_8%,transparent)]">
          <CardContent className="space-y-3 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">In-progress assessment</h2>
              <Badge variant="outline" className="text-[10px]">
                Draft · {draft.addressedCount} of {draft.totalCount} answered
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              You have a draft Tech Assessment in progress. Pick up where
              you left off — your answers are saved automatically.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link
                  href={
                    `/programs/tech-assessment/new?draftId=${draft.id}` as Route
                  }
                >
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
              <Badge
                variant={isFresh ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {isFresh ? "Fresh" : "Stale"} · Score {latest.overallScore}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                No assessment on file
              </Badge>
            )}
          </div>
          {latest?.completedAt ? (
            <p className="text-xs text-muted-foreground">
              {isFresh
                ? `Last assessment addressed ${latest.addressedCount} of ${latest.totalCount} controls. Refresh annually or when network/cloud architecture changes.`
                : `Last assessment is older than 365 days. Run a new Tech Assessment to refresh your control inventory.`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No Tech Assessment has been completed for this practice yet.
              Click &quot;Start new assessment&quot; to answer 35 questions
              covering network, endpoint, cloud, access, monitoring, and
              backup controls. Expect 30-45 minutes.
            </p>
          )}
          <div>
            <Button asChild size="sm" variant={draft ? "outline" : "default"}>
              <Link href={"/programs/tech-assessment/new" as Route}>
                {latest
                  ? "Start new assessment"
                  : "Start your first assessment"}
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
                const fresh =
                  now.getTime() - completedAt.getTime() < 365 * DAY_MS;
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          Tech Assessment
                        </p>
                        <Badge
                          variant={fresh ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          Score {a.overallScore} ·{" "}
                          {fresh ? "Fresh" : "Stale"}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {a.addressedCount} of {a.totalCount} controls
                        addressed ·{" "}
                        {completedAt.toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={
                          `/programs/tech-assessment/${a.id}` as Route
                        }
                      >
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
