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
import { computeStateBreachDeadline } from "@/lib/compliance/derivation/hipaa";

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
type OshaOutcomeUpdatedPayload = PayloadFor<"INCIDENT_OSHA_OUTCOME_UPDATED", 1>;

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
      // Audit #21 (HIPAA I-1): pre-breach-determination capture of the
      // multi-state set. Empty default keeps single-state callers
      // unchanged. The breach-determination projection reads this to
      // materialize per-state IncidentStateAgNotification rows.
      affectedPatientStates: payload.affectedPatientStates ?? [],
      oshaBodyPart: payload.oshaBodyPart ?? null,
      oshaInjuryNature: payload.oshaInjuryNature ?? null,
      oshaOutcome: payload.oshaOutcome ?? null,
      oshaDaysAway: payload.oshaDaysAway ?? null,
      oshaDaysRestricted: payload.oshaDaysRestricted ?? null,
      sharpsDeviceType: payload.sharpsDeviceType ?? null,
      injuredUserId: payload.injuredUserId ?? null,
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
    select: {
      practiceId: true,
      status: true,
      discoveredAt: true,
      patientState: true,
      affectedPatientStates: true,
    },
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

  // Audit #21 (HIPAA I-1, 2026-04-30): when isBreach=true, materialize
  // one IncidentStateAgNotification row per affected state. Each row
  // snapshots the deadline derived from the per-state HIPAA overlay so
  // the breach memo + per-state AG notification log can be replayed
  // unchanged. Single-state breaches still generate one row (the
  // patientState or, if null, practice.primaryState) so downstream
  // readers have uniform shape.
  //
  // Idempotent on replay: the (incidentId, state) unique constraint
  // makes upsert a no-op for already-recorded rows. We deliberately do
  // NOT recompute deadlineAt on re-determination (audit-stability:
  // determination memo + deadline must be reproducible).
  if (payload.isBreach) {
    const states = collectAffectedStates({
      patientState: existing.patientState,
      affectedPatientStates: existing.affectedPatientStates,
    });
    if (states.length === 0) {
      // No state in scope — fall back to the practice's primary state so
      // the breach memo always renders a single AG-notification line.
      const practice = await tx.practice.findUnique({
        where: { id: practiceId },
        select: { primaryState: true },
      });
      if (practice?.primaryState) states.push(practice.primaryState);
    }

    for (const state of states) {
      const deadlineAt =
        computeStateBreachDeadline(state, existing.discoveredAt) ??
        // "Most expedient" states have no fixed deadline — anchor the
        // row to discoveredAt so downstream UI has a render-stable
        // value. The rendered PDF still labels these as expedient.
        existing.discoveredAt;
      await tx.incidentStateAgNotification.upsert({
        where: {
          incidentId_state: {
            incidentId: payload.incidentId,
            state,
          },
        },
        create: {
          practiceId,
          incidentId: payload.incidentId,
          state,
          deadlineAt,
          thresholdAffectedCount: payload.affectedCount,
        },
        update: {
          // Re-determination: refresh threshold + clear stale notifiedAt
          // ONLY if the state list shrank (handled by the find-and-purge
          // below). Recorded notifiedAt timestamps are preserved.
          thresholdAffectedCount: payload.affectedCount,
        },
      });
    }

    // Purge per-state rows for states no longer in scope (e.g. the
    // determiner removed a state via re-determination). Limited to
    // rows that have NOT yet been notified — once an AG notice is on
    // the books, it stays as audit history.
    if (states.length > 0) {
      await tx.incidentStateAgNotification.deleteMany({
        where: {
          incidentId: payload.incidentId,
          state: { notIn: states },
          notifiedAt: null,
        },
      });
    }
  }

  // Composite HIPAA_BREACH_RESPONSE rule cares about unresolved breaches.
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "POLICY:HIPAA_BREACH_RESPONSE_POLICY",
  );
}

/**
 * Audit #21 (HIPAA I-1) helper — single source of truth for "which
 * states does this breach touch?" Reads `affectedPatientStates` first
 * (multi-state authoritative); falls back to `patientState` (legacy
 * single-state) when the list is empty. Returns deduplicated, uppercase
 * state codes.
 */
function collectAffectedStates(input: {
  patientState: string | null;
  affectedPatientStates: string[];
}): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const code = s.toUpperCase();
    if (seen.has(code)) return;
    seen.add(code);
    result.push(code);
  };
  for (const s of input.affectedPatientStates) push(s);
  if (result.length === 0) push(input.patientState);
  return result;
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
  const notifiedAt = new Date(payload.notifiedAt);
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: { stateAgNotifiedAt: notifiedAt },
  });
  // Audit #21 (HIPAA I-1, 2026-04-30): also stamp the matching per-state
  // row (created at breach-determination time). Idempotent —
  // updateMany on the unique pair is a no-op when no row matches (e.g.
  // legacy events fired before the determination wrote per-state rows).
  // We use updateMany rather than upsert because we don't have the
  // deadline window in this event payload — re-deriving it here would
  // de-anchor from the determination snapshot.
  if (payload.stateCode) {
    await tx.incidentStateAgNotification.updateMany({
      where: {
        incidentId: payload.incidentId,
        state: payload.stateCode.toUpperCase(),
      },
      data: { notifiedAt },
    });
  }
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "INCIDENT:NOTIFIED_STATE_AG",
  );
}

/**
 * Audit #15: ADMIN typo correction on the OSHA recordable fields of an
 * existing Incident. Refuses if the row is missing or in another practice.
 * Re-rederives INCIDENT:OSHA_RECORDABLE because §1904.7 inclusion depends
 * on oshaOutcome (FIRST_AID rows are excluded from Form 300), and shifting
 * the outcome must trip the rule recompute.
 */
export async function projectIncidentOshaOutcomeUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: OshaOutcomeUpdatedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.incident.findUnique({
    where: { id: payload.incidentId },
    select: { practiceId: true, type: true },
  });
  if (!existing) {
    throw new Error(
      `INCIDENT_OSHA_OUTCOME_UPDATED refused: incident ${payload.incidentId} not found`,
    );
  }
  if (existing.practiceId !== practiceId) {
    throw new Error(
      `INCIDENT_OSHA_OUTCOME_UPDATED refused: incident ${payload.incidentId} belongs to a different practice`,
    );
  }
  await tx.incident.update({
    where: { id: payload.incidentId },
    data: {
      oshaBodyPart: payload.oshaBodyPart ?? null,
      oshaInjuryNature: payload.oshaInjuryNature ?? null,
      oshaOutcome: payload.oshaOutcome ?? null,
      oshaDaysAway: payload.oshaDaysAway ?? null,
      oshaDaysRestricted: payload.oshaDaysRestricted ?? null,
      sharpsDeviceType: payload.sharpsDeviceType ?? null,
      injuredUserId: payload.injuredUserId ?? null,
    },
  });
  if (existing.type === "OSHA_RECORDABLE") {
    await rederiveRequirementStatus(
      tx,
      practiceId,
      "INCIDENT:OSHA_RECORDABLE",
    );
  }
}

// HIPAA audit-trail no-op projection: emitted whenever a signed-in
// user generates a breach memo PDF. The EventLog row IS the audit
// trail — no projection table state to update.
export async function projectIncidentBreachMemoGenerated(): Promise<void> {
  // intentional no-op
}

// OSHA / employee-privacy audit-trail no-op projection: emitted on
// every Form 300 (annual log) or Form 301 (single-incident) PDF
// generation. EventLog row IS the audit trail.
export async function projectIncidentOshaLogGenerated(): Promise<void> {
  // intentional no-op
}

// Audit #21 (OSHA I-4) audit-trail no-op projection: emitted by the
// critical-osha-alert helper alongside CRITICAL Notification rows +
// admin email. The EventLog row IS the audit trail (and the idempotency
// key — the helper checks for an existing row before re-firing).
export async function projectIncidentOshaFatalityReported(): Promise<void> {
  // intentional no-op
}
