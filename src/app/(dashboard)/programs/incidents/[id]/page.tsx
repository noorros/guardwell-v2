// src/app/(dashboard)/programs/incidents/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MajorBreachBanner } from "@/components/gw/MajorBreachBanner";
import {
  IncidentStatusBadge,
  IncidentBreachBadge,
} from "../IncidentBadges";
import { BreachDeterminationWizard } from "./BreachDeterminationWizard";
import { ResolveButton } from "./ResolveButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

// HHS OCR: notification required within 60 days of discovery for <500
// affected individuals; immediate (within 60 days but effectively ASAP +
// media notice) for major breaches. Reporting deadline = discovered + 60d.
const OCR_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

const TYPE_LABELS: Record<string, string> = {
  PRIVACY: "Privacy",
  SECURITY: "Security",
  OSHA_RECORDABLE: "OSHA recordable",
  NEAR_MISS: "Near miss",
  DEA_THEFT_LOSS: "DEA theft/loss",
  CLIA_QC_FAILURE: "CLIA QC failure",
  TCPA_COMPLAINT: "TCPA complaint",
};

export default async function IncidentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident || incident.practiceId !== pu.practiceId) notFound();

  const hasDetermined = incident.isBreach !== null;
  const isUnresolvedBreach =
    incident.isBreach === true && incident.resolvedAt === null;
  const reportingDeadline = new Date(
    incident.discoveredAt.getTime() + OCR_WINDOW_MS,
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Incidents", href: "/programs/incidents" as Route },
          { label: "Detail" },
        ]}
      />

      {isUnresolvedBreach &&
        (incident.affectedCount ?? 0) >= 500 && (
          <MajorBreachBanner
            affectedCount={incident.affectedCount ?? 0}
            reportingDeadline={reportingDeadline}
          />
        )}

      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {incident.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {TYPE_LABELS[incident.type] ?? incident.type}
            </Badge>
            <IncidentStatusBadge status={incident.status} />
            <IncidentBreachBadge
              isBreach={incident.isBreach}
              affectedCount={incident.affectedCount ?? 0}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Discovered{" "}
            {incident.discoveredAt.toISOString().slice(0, 10)}
            {incident.resolvedAt ? (
              <>
                {" "}· Resolved{" "}
                {incident.resolvedAt.toISOString().slice(0, 10)}
              </>
            ) : null}
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {incident.description}
          </p>
          {incident.phiInvolved && (
            <p className="text-xs text-muted-foreground">
              PHI involved · Patient state:{" "}
              <span className="font-medium">
                {incident.patientState ?? pu.practice.primaryState}
              </span>
            </p>
          )}
          {incident.type === "OSHA_RECORDABLE" && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-foreground">
              <p className="font-medium">OSHA recordable details</p>
              <ul className="mt-1 space-y-0.5">
                {incident.oshaBodyPart && (
                  <li>Body part: {incident.oshaBodyPart}</li>
                )}
                {incident.oshaInjuryNature && (
                  <li>Injury: {incident.oshaInjuryNature}</li>
                )}
                {incident.oshaOutcome && (
                  <li>Outcome: {incident.oshaOutcome.replace(/_/g, " ")}</li>
                )}
                {incident.oshaDaysAway != null && (
                  <li>Days away: {incident.oshaDaysAway}</li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {!hasDetermined ? (
        <BreachDeterminationWizard
          incidentId={incident.id}
          defaultAffectedCount={incident.affectedCount ?? 0}
        />
      ) : (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-sm font-semibold">Breach determination</h2>
            <p className="text-xs text-muted-foreground">
              HIPAA §164.402 four-factor risk score:{" "}
              <span className="font-medium">
                {incident.overallRiskScore ?? 0}/100
              </span>{" "}
              · Factors:{" "}
              {[
                incident.factor1Score,
                incident.factor2Score,
                incident.factor3Score,
                incident.factor4Score,
              ]
                .map((s) => s ?? "–")
                .join(" · ")}
            </p>
            {incident.isBreach ? (
              <p className="text-sm font-medium text-[color:var(--gw-color-risk)]">
                Determined to be a reportable breach. Affected count:{" "}
                {incident.affectedCount ?? 0}.
                {incident.ocrNotifyRequired
                  ? " HHS OCR notification required within 60 days of discovery."
                  : ""}
              </p>
            ) : (
              <p className="text-sm font-medium text-[color:var(--gw-color-compliant)]">
                Determined NOT to be a reportable breach.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {incident.status !== "RESOLVED" && incident.status !== "CLOSED" && (
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <h2 className="text-sm font-semibold">Resolution</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Closing the incident as resolved unblocks HIPAA_BREACH_RESPONSE
                (if it was flipped to GAP by this unresolved breach).
              </p>
            </div>
            <ResolveButton incidentId={incident.id} />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Link
          href={"/programs/incidents" as Route}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Back to incidents
        </Link>
      </div>
    </main>
  );
}
