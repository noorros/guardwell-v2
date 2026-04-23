// src/lib/events/projections/incident.ts
//
// Three projections for the incident lifecycle:
//
//   INCIDENT_REPORTED          → create row (status=OPEN, isBreach=null)
//   INCIDENT_BREACH_DETERMINED → update with factor scores + isBreach
//                                + rederive HIPAA_BREACH_RESPONSE + OSHA_300_LOG
//   INCIDENT_RESOLVED          → set resolvedAt + status=RESOLVED
//                                + rederive HIPAA_BREACH_RESPONSE (unresolved→resolved)
//
// Notifications to HHS, affected individuals, media, or state AG will get
// their own events in a follow-up PR. For this PR the breach-determination
// event carries ocrNotifyRequired as a flag the UI uses to prompt the user.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type ReportedPayload = PayloadFor<"INCIDENT_REPORTED", 1>;
type BreachPayload = PayloadFor<"INCIDENT_BREACH_DETERMINED", 1>;
type ResolvedPayload = PayloadFor<"INCIDENT_RESOLVED", 1>;

export async function projectIncidentReported(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    reportedByUserId: string;
    payload: ReportedPayload;
  },
): Promise<void> {
  const { practiceId, reportedByUserId, payload } = args;
  await tx.incident.create({
    data: {
      id: payload.incidentId,
      practiceId,
      reportedByUserId,
      title: payload.title,
      description: payload.description,
      type: payload.type,
      severity: payload.severity,
      status: "OPEN",
      phiInvolved: payload.phiInvolved,
      affectedCount: payload.affectedCount ?? null,
      discoveredAt: new Date(payload.discoveredAt),
      patientState: payload.patientState ?? null,
      oshaBodyPart: payload.oshaBodyPart ?? null,
      oshaInjuryNature: payload.oshaInjuryNature ?? null,
      oshaOutcome: payload.oshaOutcome ?? null,
      oshaDaysAway: payload.oshaDaysAway ?? null,
      oshaDaysRestricted: payload.oshaDaysRestricted ?? null,
    },
  });

  // OSHA_RECORDABLE incidents immediately rederive OSHA_300_LOG (once
  // the derivation rule lands). HIPAA_BREACH_RESPONSE rederivation waits
  // until breach determination — a reported-but-undetermined incident
  // isn't a breach yet.
  if (payload.type === "OSHA_RECORDABLE") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "INCIDENT:OSHA_RECORDABLE",
    );
  }
}

export async function projectIncidentBreachDetermined(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: BreachPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.incident.findUnique({
    where: { id: payload.incidentId },
    select: { practiceId: true, status: true },
  });
  if (!existing) {
    throw new Error(
      `INCIDENT_BREACH_DETERMINED refused: incident ${payload.incidentId} not found`,
    );
  }
  if (existing.practiceId !== practiceId) {
    throw new Error(
      `INCIDENT_BREACH_DETERMINED refused: incident ${payload.incidentId} belongs to a different practice`,
    );
  }
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: {
      factor1Score: payload.factor1Score,
      factor2Score: payload.factor2Score,
      factor3Score: payload.factor3Score,
      factor4Score: payload.factor4Score,
      overallRiskScore: payload.overallRiskScore,
      isBreach: payload.isBreach,
      affectedCount: payload.affectedCount,
      ocrNotifyRequired: payload.ocrNotifyRequired,
      breachDeterminedAt: new Date(),
      // Under-investigation once the wizard has run, even if isBreach=false
      // — the investigation happened. Resolution flips status=RESOLVED.
      status: existing.status === "OPEN" ? "UNDER_INVESTIGATION" : existing.status,
    },
  });
  // Composite HIPAA_BREACH_RESPONSE rule cares about unresolved breaches.
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY:HIPAA_BREACH_RESPONSE_POLICY",
  );
}

export async function projectIncidentResolved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ResolvedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.incident.findUnique({
    where: { id: payload.incidentId },
    select: { practiceId: true },
  });
  if (!existing) {
    throw new Error(
      `INCIDENT_RESOLVED refused: incident ${payload.incidentId} not found`,
    );
  }
  if (existing.practiceId !== practiceId) {
    throw new Error(
      `INCIDENT_RESOLVED refused: incident ${payload.incidentId} belongs to a different practice`,
    );
  }
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });
  // Resolution can flip HIPAA_BREACH_RESPONSE back to COMPLIANT now that
  // the unresolved-breach guard no longer matches.
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY:HIPAA_BREACH_RESPONSE_POLICY",
  );
}
