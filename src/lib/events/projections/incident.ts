// src/lib/events/projections/incident.ts
//
// Projections for the incident lifecycle:
//
//   INCIDENT_REPORTED                       → create row (status=OPEN)
//   INCIDENT_BREACH_DETERMINED              → factor scores + isBreach
//                                             + rederive HIPAA_BREACH_RESPONSE
//   INCIDENT_RESOLVED                       → resolvedAt + status=RESOLVED
//                                             + rederive HIPAA_BREACH_RESPONSE
//   INCIDENT_NOTIFIED_HHS                   → ocrNotifiedAt timestamp
//   INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS  → affectedIndividualsNotifiedAt
//                                             + rederive state-overlay rules
//                                             (e.g. HIPAA_CA_BREACH_NOTIFICATION_72HR)
//   INCIDENT_NOTIFIED_MEDIA                 → mediaNotifiedAt
//   INCIDENT_NOTIFIED_STATE_AG              → stateAgNotifiedAt

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type ReportedPayload = PayloadFor<"INCIDENT_REPORTED", 1>;
type BreachPayload = PayloadFor<"INCIDENT_BREACH_DETERMINED", 1>;
type ResolvedPayload = PayloadFor<"INCIDENT_RESOLVED", 1>;
type NotifiedHhsPayload = PayloadFor<"INCIDENT_NOTIFIED_HHS", 1>;
type NotifiedAffectedPayload = PayloadFor<
  "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
  1
>;
type NotifiedMediaPayload = PayloadFor<"INCIDENT_NOTIFIED_MEDIA", 1>;
type NotifiedStateAgPayload = PayloadFor<"INCIDENT_NOTIFIED_STATE_AG", 1>;

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
      breachDeterminationMemo: payload.memoText ?? null,
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

async function loadIncidentForNotification(
  tx: Prisma.TransactionClient,
  practiceId: string,
  incidentId: string,
  eventType: string,
): Promise<void> {
  const existing = await tx.incident.findUnique({
    where: { id: incidentId },
    select: { practiceId: true },
  });
  if (!existing) {
    throw new Error(
      `${eventType} refused: incident ${incidentId} not found`,
    );
  }
  if (existing.practiceId !== practiceId) {
    throw new Error(
      `${eventType} refused: incident ${incidentId} belongs to a different practice`,
    );
  }
}

export async function projectIncidentNotifiedHhs(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: NotifiedHhsPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await loadIncidentForNotification(
    tx,
    practiceId,
    payload.incidentId,
    "INCIDENT_NOTIFIED_HHS",
  );
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: { ocrNotifiedAt: new Date(payload.notifiedAt) },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "INCIDENT:NOTIFIED_HHS",
  );
}

export async function projectIncidentNotifiedAffectedIndividuals(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: NotifiedAffectedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await loadIncidentForNotification(
    tx,
    practiceId,
    payload.incidentId,
    "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
  );
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: { affectedIndividualsNotifiedAt: new Date(payload.notifiedAt) },
  });
  // Every state-overlay breach-notification rule keys off affected-
  // individual notice timing. The state-overlay seed uses one of a few
  // canonical evidence-type codes per overlay (15-biz-days for CA, N-day
  // windows for fixed-deadline states, EXPEDIENT for the rest).
  // Rederiving each one here drives the matching rule via the registry.
  for (const evidenceCode of [
    "INCIDENT:BREACH_NOTIFIED_15_BIZ_DAYS",
    "INCIDENT:BREACH_NOTIFIED_30_DAYS",
    "INCIDENT:BREACH_NOTIFIED_45_DAYS",
    "INCIDENT:BREACH_NOTIFIED_60_DAYS",
    "INCIDENT:BREACH_NOTIFIED_EXPEDIENT",
    "INCIDENT:NOTIFIED_AFFECTED_INDIVIDUALS",
  ]) {
    await rederiveRequirementStatus(tx, practiceId, evidenceCode);
  }
}

export async function projectIncidentNotifiedMedia(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: NotifiedMediaPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await loadIncidentForNotification(
    tx,
    practiceId,
    payload.incidentId,
    "INCIDENT_NOTIFIED_MEDIA",
  );
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: { mediaNotifiedAt: new Date(payload.notifiedAt) },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "INCIDENT:NOTIFIED_MEDIA",
  );
}

export async function projectIncidentNotifiedStateAg(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: NotifiedStateAgPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await loadIncidentForNotification(
    tx,
    practiceId,
    payload.incidentId,
    "INCIDENT_NOTIFIED_STATE_AG",
  );
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: { stateAgNotifiedAt: new Date(payload.notifiedAt) },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "INCIDENT:NOTIFIED_STATE_AG",
  );
}

// HIPAA audit-trail no-op projection: emitted whenever a signed-in
// user generates a breach memo PDF. The EventLog row IS the audit
// trail — no projection table state to update.
export async function projectIncidentBreachMemoGenerated(): Promise<void> {
  // intentional no-op
}
