// src/app/(dashboard)/programs/incidents/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/gw/EmptyState";
import { IncidentStatusBadge, IncidentBreachBadge } from "./IncidentBadges";
import { formatPracticeDate } from "@/lib/audit/format";

export const metadata = { title: "Incidents · My Programs" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  PRIVACY: "Privacy",
  SECURITY: "Security",
  OSHA_RECORDABLE: "OSHA recordable",
  NEAR_MISS: "Near miss",
  DEA_THEFT_LOSS: "DEA theft/loss",
  CLIA_QC_FAILURE: "CLIA QC failure",
  TCPA_COMPLAINT: "TCPA complaint",
};

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export default async function IncidentsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const tz = pu.practice.timezone ?? "UTC";

  const incidents = await db.incident.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: [{ status: "asc" }, { discoveredAt: "desc" }],
    take: 50,
  });

  const openCount = incidents.filter(
    (i) => i.status === "OPEN" || i.status === "UNDER_INVESTIGATION",
  ).length;
  const unresolvedBreachCount = incidents.filter(
    (i) => i.isBreach === true && i.resolvedAt === null,
  ).length;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Incidents" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="text-sm text-muted-foreground">
            Report privacy/security/OSHA events, run the HIPAA §164.402 four-factor
            breach determination, and track resolution. Incidents with
            isBreach=true that stay unresolved flip HIPAA_BREACH_RESPONSE to GAP.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={"/programs/incidents/new" as Route}>Report incident</Link>
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Open
            </p>
            <p className="text-2xl font-semibold">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Unresolved breaches
            </p>
            <p className="text-2xl font-semibold">{unresolvedBreachCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total tracked
            </p>
            <p className="text-2xl font-semibold">{incidents.length}</p>
          </CardContent>
        </Card>
      </div>

      {incidents.length === 0 ? (
        <>
          <EmptyState
            icon={AlertTriangle}
            title="No incidents reported yet"
            description="Workforce members should report privacy, security, or OSHA-recordable events as soon as they're discovered. Every report walks through the HIPAA §164.402 four-factor breach determination so reportability isn't guessed."
            action={{
              label: "Report your first incident",
              href: "/programs/incidents/new",
            }}
          />
          <Card>
            <CardContent className="space-y-3 p-5">
              <h2 className="text-sm font-semibold">What to report here</h2>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Privacy:</span>{" "}
                  PHI sent to the wrong patient, lost device with PHI, snooping
                  by an unauthorized workforce member, misrouted fax or email,
                  records left visible in a public area.
                </li>
                <li>
                  <span className="font-medium text-foreground">Security:</span>{" "}
                  successful or attempted breach, ransomware, malware, phishing
                  click that exposed credentials, suspected unauthorized access
                  to your EHR.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    OSHA-recordable:
                  </span>{" "}
                  needlestick, sharps injury, exposure incident, any work-
                  related injury that meets OSHA&apos;s recordable criteria
                  (death, days away, restricted duty, medical treatment beyond
                  first aid).
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Other regulated events:
                  </span>{" "}
                  DEA theft/loss of controlled substances, CLIA QC failure,
                  TCPA complaint, or a near-miss that could have been any of
                  the above.
                </li>
              </ul>
              <p className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                Reporting in here is the audit trail. Even if a determination
                lands at &ldquo;not a breach,&rdquo; you have a documented record of the
                analysis — which is what OCR looks for in an investigation.
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
              </h2>
              <span className="text-[10px] text-muted-foreground">
                {incidents.length} incident{incidents.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y">
              {incidents.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {i.title}
                      </p>
                      <IncidentStatusBadge status={i.status} />
                      <IncidentBreachBadge
                        isBreach={i.isBreach}
                        affectedCount={i.affectedCount ?? 0}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">
                        {TYPE_LABELS[i.type] ?? i.type}
                      </Badge>{" "}
                      · {SEVERITY_LABELS[i.severity] ?? i.severity} · Discovered{" "}
                      {formatPracticeDate(i.discoveredAt, tz)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/programs/incidents/${i.id}` as Route}>
                      View
                    </Link>
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
