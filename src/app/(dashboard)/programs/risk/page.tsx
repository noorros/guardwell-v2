// src/app/(dashboard)/programs/risk/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SraAssessmentBadge } from "./SraAssessmentBadge";

export const metadata = { title: "Risk · My Programs" };

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function RiskPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const assessments = await db.practiceSraAssessment.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { completedAt: "desc" },
    take: 20,
  });

  const latest = assessments[0];
  const now = new Date();
  const isFresh =
    latest != null &&
    now.getTime() - latest.completedAt.getTime() < 365 * DAY_MS;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Risk" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Risk</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            HIPAA §164.308(a)(1)(ii)(A) requires every covered entity to
            conduct a thorough, documented Security Risk Assessment — and to
            update it whenever significant changes occur (and at least annually).
            Completing an SRA here auto-updates HIPAA_SRA on your module page.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">Current status</h2>
            {latest ? (
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
          {latest ? (
            <p className="text-xs text-muted-foreground">
              {isFresh
                ? `Last assessment addressed ${latest.addressedCount} of ${latest.totalCount} safeguards. HIPAA_SRA will auto-expire 365 days after completion — schedule a refresh before then.`
                : `Last assessment is older than 365 days. Run a new SRA to re-establish HIPAA_SRA compliance.`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No SRA has been completed for this practice yet. Click &quot;Start new
              SRA&quot; to answer 20 safeguard questions covering administrative,
              physical, and technical controls. Expect 30-60 minutes.
            </p>
          )}
          <div>
            <Button asChild size="sm">
              <Link href={"/programs/risk/new" as Route}>
                {latest ? "Start new SRA" : "Start your first SRA"}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {assessments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Assessment history
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {assessments.length} assessment{assessments.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y">
              {assessments.map((a) => (
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
                        completedAt={a.completedAt.toISOString()}
                        overallScore={a.overallScore}
                        fresh={now.getTime() - a.completedAt.getTime() < 365 * DAY_MS}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {a.addressedCount} of {a.totalCount} safeguards addressed
                    </p>
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/programs/risk/${a.id}` as Route}>View</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
