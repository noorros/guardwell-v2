// src/app/(dashboard)/programs/incidents/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser, requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectIncidentReported,
  projectIncidentBreachDetermined,
  projectIncidentResolved,
  projectIncidentNotifiedHhs,
  projectIncidentNotifiedAffectedIndividuals,
  projectIncidentNotifiedMedia,
  projectIncidentNotifiedStateAg,
  projectIncidentOshaOutcomeUpdated,
} from "@/lib/events/projections/incident";
import { emitCriticalBreachAlert } from "@/lib/notifications/critical-alert";
import { db } from "@/lib/db";
// db needed to read incident title + discoveredAt after breach-determination
// commits, so the critical-alert email can render a practice-specific subject.

const IncidentTypeEnum = z.enum([
  "PRIVACY",
  "SECURITY",
  "OSHA_RECORDABLE",
  "NEAR_MISS",
  "DEA_THEFT_LOSS",
  "CLIA_QC_FAILURE",
  "TCPA_COMPLAINT",
]);
const SeverityEnum = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const OshaOutcomeEnum = z.enum([
  "DEATH",
  "DAYS_AWAY",
  "RESTRICTED",
  "OTHER_RECORDABLE",
  "FIRST_AID",
]);

const ReportInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  type: IncidentTypeEnum,
  severity: SeverityEnum,
  phiInvolved: z.boolean(),
  affectedCount: z.number().int().min(0).nullable().optional(),
  discoveredAt: z.string().datetime(),
  patientState: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  oshaBodyPart: z.string().max(200).nullable().optional(),
  oshaInjuryNature: z.string().max(200).nullable().optional(),
  oshaOutcome: OshaOutcomeEnum.nullable().optional(),
  oshaDaysAway: z.number().int().min(0).nullable().optional(),
  oshaDaysRestricted: z.number().int().min(0).nullable().optional(),
  sharpsDeviceType: z.string().max(200).nullable().optional(),
  // Audit #19 (OSHA B-3): the staff member who was injured. Optional —
  // non-OSHA incidents leave it null; the form makes it required when
  // type=OSHA_RECORDABLE.
  injuredUserId: z.string().min(1).nullable().optional(),
});

export interface ReportIncidentResult {
  incidentId: string;
}

/**
 * Audit C-2 (HIPAA/OSHA): intentionally open to STAFF/VIEWER. Discovery
 * of an incident is the moment a staff member is most likely to act —
 * gating reporting to ADMIN+ would create a perverse incentive to wait
 * for a manager and miss the §164.408(b) 60-day breach-discovery clock
 * (or §1904.39 8-hour fatality reporting). The downstream actions
 * (breach determination, resolve, notification) are gated.
 */
export async function reportIncidentAction(
  input: z.infer<typeof ReportInput>,
): Promise<ReportIncidentResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = ReportInput.parse(input);

  // Audit #19: when an OSHA_RECORDABLE comes in without injuredUserId,
  // fall back to the reporter so legacy form versions don't lose data.
  // Form-submitted callers should always pass it explicitly.
  const injuredUserId =
    parsed.injuredUserId ??
    (parsed.type === "OSHA_RECORDABLE" ? user.id : null);

  const incidentId = randomUUID();
  const payload = {
    incidentId,
    title: parsed.title,
    description: parsed.description,
    type: parsed.type,
    severity: parsed.severity,
    phiInvolved: parsed.phiInvolved,
    affectedCount: parsed.affectedCount ?? null,
    discoveredAt: parsed.discoveredAt,
    patientState: parsed.patientState ?? null,
    oshaBodyPart: parsed.oshaBodyPart ?? null,
    oshaInjuryNature: parsed.oshaInjuryNature ?? null,
    oshaOutcome: parsed.oshaOutcome ?? null,
    oshaDaysAway: parsed.oshaDaysAway ?? null,
    oshaDaysRestricted: parsed.oshaDaysRestricted ?? null,
    sharpsDeviceType: parsed.sharpsDeviceType ?? null,
    injuredUserId,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INCIDENT_REPORTED",
      payload,
    },
    async (tx) =>
      projectIncidentReported(tx, {
        practiceId: pu.practiceId,
        reportedByUserId: user.id,
        payload,
      }),
  );

  revalidatePath("/programs/incidents");
  revalidatePath("/dashboard");
  revalidatePath("/modules/hipaa");
  revalidatePath("/modules/osha");

  return { incidentId };
}

const BreachInput = z.object({
  incidentId: z.string().min(1),
  factor1Score: z.number().int().min(1).max(5),
  factor2Score: z.number().int().min(1).max(5),
  factor3Score: z.number().int().min(1).max(5),
  factor4Score: z.number().int().min(1).max(5),
  affectedCount: z.number().int().min(0),
  // HIPAA §164.402 documented analysis. Required ≥40 chars to ensure a
  // substantive memo; nullable allowed for the legacy/test path that
  // doesn't yet pass it. UI enforces non-empty before submit.
  memoText: z.string().min(40).max(10000).nullable().optional(),
});

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. The §164.402 4-factor analysis
 * is the legal record that decides whether HHS notification is
 * required — STAFF/VIEWER could falsely score a real breach as
 * non-reportable to suppress the 60-day clock.
 */
export async function completeBreachDeterminationAction(
  input: z.infer<typeof BreachInput>,
): Promise<{ isBreach: boolean; overallRiskScore: number }> {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = BreachInput.parse(input);

  // HIPAA §164.402 "low probability of compromise" analysis. Each factor
  // is 1-5 (5 = high probability). Composite ≥ 50 (half of 100) = breach.
  // Hard trigger: any individual factor at 5 forces isBreach=true.
  const factors = [
    parsed.factor1Score,
    parsed.factor2Score,
    parsed.factor3Score,
    parsed.factor4Score,
  ];
  const sum = factors.reduce((a, b) => a + b, 0);
  const overallRiskScore = Math.round((sum / (factors.length * 5)) * 100);
  const hasMaxFactor = factors.some((f) => f === 5);
  const isBreach = hasMaxFactor || overallRiskScore >= 50;
  const ocrNotifyRequired = isBreach;

  const payload = {
    incidentId: parsed.incidentId,
    factor1Score: parsed.factor1Score,
    factor2Score: parsed.factor2Score,
    factor3Score: parsed.factor3Score,
    factor4Score: parsed.factor4Score,
    overallRiskScore,
    isBreach,
    affectedCount: parsed.affectedCount,
    ocrNotifyRequired,
    memoText: parsed.memoText ?? undefined,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INCIDENT_BREACH_DETERMINED",
      payload,
    },
    async (tx) =>
      projectIncidentBreachDetermined(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  // Same-day critical alert when the determination flips isBreach=true.
  // Runs after the event-apply transaction commits — the alert is not
  // transactional with the projection, and a failed email shouldn't
  // roll back a recorded breach determination.
  if (isBreach) {
    try {
      const incident = await db.incident.findUnique({
        where: { id: parsed.incidentId },
        select: { title: true, discoveredAt: true },
      });
      if (incident) {
        await emitCriticalBreachAlert({
          practiceId: pu.practiceId,
          incidentId: parsed.incidentId,
          incidentTitle: incident.title,
          affectedCount: parsed.affectedCount,
          overallRiskScore,
          discoveredAt: incident.discoveredAt,
        });
      }
    } catch (err) {
      // Notification delivery is best-effort. Log and move on so the
      // action still resolves successfully for the UI.
      console.error("[critical-alert] emit failed", err);
    }
  }

  revalidatePath("/programs/incidents");
  revalidatePath(`/programs/incidents/${parsed.incidentId}`);
  revalidatePath("/dashboard");
  revalidatePath("/modules/hipaa");

  return { isBreach, overallRiskScore };
}

const ResolveInput = z.object({
  incidentId: z.string().min(1),
  resolution: z.string().max(2000).nullable().optional(),
});

/**
 * Audit C-2 (HIPAA/OSHA): gated to ADMIN+. Marking an incident resolved
 * removes it from open-gap counts and audit-defense surfaces — STAFF
 * could prematurely close real findings.
 */
export async function resolveIncidentAction(
  input: z.infer<typeof ResolveInput>,
): Promise<void> {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = ResolveInput.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INCIDENT_RESOLVED",
      payload: {
        incidentId: parsed.incidentId,
        resolution: parsed.resolution ?? null,
      },
    },
    async (tx) =>
      projectIncidentResolved(tx, {
        practiceId: pu.practiceId,
        payload: {
          incidentId: parsed.incidentId,
          resolution: parsed.resolution ?? null,
        },
      }),
  );

  revalidatePath("/programs/incidents");
  revalidatePath(`/programs/incidents/${parsed.incidentId}`);
  revalidatePath("/dashboard");
  revalidatePath("/modules/hipaa");
}

const NotificationKindEnum = z.enum([
  "HHS",
  "AFFECTED_INDIVIDUALS",
  "MEDIA",
  "STATE_AG",
]);

const NotificationInput = z.object({
  incidentId: z.string().min(1),
  kind: NotificationKindEnum,
  notifiedAt: z.string().datetime().optional(),
  stateCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. Recording a notification (HHS,
 * affected individuals, media, state AG) creates a legal evidence trail
 * — fabricating an HHS-notified date would mask a real §164.408(b)
 * timeline violation.
 */
export async function recordIncidentNotificationAction(
  input: z.infer<typeof NotificationInput>,
): Promise<{ kind: z.infer<typeof NotificationKindEnum>; notifiedAt: string }> {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = NotificationInput.parse(input);

  // Default to "now" so the common case (button click = "I just sent it")
  // doesn't require the UI to handle date entry. Backdated entries pass
  // an explicit notifiedAt.
  const notifiedAt = parsed.notifiedAt ?? new Date().toISOString();

  if (parsed.kind === "STATE_AG" && !parsed.stateCode) {
    throw new Error("stateCode is required for STATE_AG notifications.");
  }

  switch (parsed.kind) {
    case "HHS": {
      const payload = { incidentId: parsed.incidentId, notifiedAt };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "INCIDENT_NOTIFIED_HHS",
          payload,
        },
        async (tx) =>
          projectIncidentNotifiedHhs(tx, {
            practiceId: pu.practiceId,
            payload,
          }),
      );
      break;
    }
    case "AFFECTED_INDIVIDUALS": {
      const payload = { incidentId: parsed.incidentId, notifiedAt };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
          payload,
        },
        async (tx) =>
          projectIncidentNotifiedAffectedIndividuals(tx, {
            practiceId: pu.practiceId,
            payload,
          }),
      );
      break;
    }
    case "MEDIA": {
      const payload = { incidentId: parsed.incidentId, notifiedAt };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "INCIDENT_NOTIFIED_MEDIA",
          payload,
        },
        async (tx) =>
          projectIncidentNotifiedMedia(tx, {
            practiceId: pu.practiceId,
            payload,
          }),
      );
      break;
    }
    case "STATE_AG": {
      const payload = {
        incidentId: parsed.incidentId,
        notifiedAt,
        stateCode: parsed.stateCode!,
      };
      await appendEventAndApply(
        {
          practiceId: pu.practiceId,
          actorUserId: user.id,
          type: "INCIDENT_NOTIFIED_STATE_AG",
          payload,
        },
        async (tx) =>
          projectIncidentNotifiedStateAg(tx, {
            practiceId: pu.practiceId,
            payload,
          }),
      );
      break;
    }
  }

  revalidatePath("/programs/incidents");
  revalidatePath(`/programs/incidents/${parsed.incidentId}`);
  revalidatePath("/dashboard");
  revalidatePath("/modules/hipaa");

  return { kind: parsed.kind, notifiedAt };
}

const UpdateOshaOutcomeInput = z.object({
  incidentId: z.string().min(1),
  oshaBodyPart: z.string().max(200).nullable().optional(),
  oshaInjuryNature: z.string().max(200).nullable().optional(),
  oshaOutcome: OshaOutcomeEnum.nullable().optional(),
  oshaDaysAway: z.number().int().min(0).nullable().optional(),
  oshaDaysRestricted: z.number().int().min(0).nullable().optional(),
  sharpsDeviceType: z.string().max(200).nullable().optional(),
  injuredUserId: z.string().min(1).nullable().optional(),
});

/**
 * Audit #15: ADMIN typo correction on the OSHA recordable fields of an
 * existing Incident. Cross-tenant guarded at action layer (here, by
 * matching practiceId before emit) and at projection layer. The
 * Incident itself isn't soft-deleted via this event — only the OSHA
 * fields mutate. Form 300 / 301 PDFs read fresh on next render so any
 * change is reflected immediately on the next download.
 */
export async function updateIncidentOshaOutcomeAction(
  input: z.infer<typeof UpdateOshaOutcomeInput>,
): Promise<void> {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = UpdateOshaOutcomeInput.parse(input);

  const existing = await db.incident.findUnique({
    where: { id: parsed.incidentId },
    select: { practiceId: true, type: true },
  });
  if (!existing || existing.practiceId !== pu.practiceId) {
    throw new Error("Incident not found");
  }
  if (existing.type !== "OSHA_RECORDABLE") {
    throw new Error("OSHA outcome edits are only valid for OSHA_RECORDABLE incidents");
  }

  const payload = {
    incidentId: parsed.incidentId,
    editedByUserId: pu.id,
    oshaBodyPart: parsed.oshaBodyPart ?? null,
    oshaInjuryNature: parsed.oshaInjuryNature ?? null,
    oshaOutcome: parsed.oshaOutcome ?? null,
    oshaDaysAway: parsed.oshaDaysAway ?? null,
    oshaDaysRestricted: parsed.oshaDaysRestricted ?? null,
    sharpsDeviceType: parsed.sharpsDeviceType ?? null,
    injuredUserId: parsed.injuredUserId ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "INCIDENT_OSHA_OUTCOME_UPDATED",
      payload,
    },
    async (tx) =>
      projectIncidentOshaOutcomeUpdated(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/incidents");
  revalidatePath(`/programs/incidents/${parsed.incidentId}`);
  revalidatePath("/modules/osha");
}
