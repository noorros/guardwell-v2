// tests/integration/incident-notifications.test.ts
//
// End-to-end coverage for the four INCIDENT_NOTIFIED_* events + the CA
// 15-business-day overlay derivation rule. Walks each notification kind
// through append → projection → timestamp written, and verifies the CA
// rule flips between COMPLIANT and GAP based on whether the affected-
// individual notification is recorded within 15 business days of
// discovery.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectIncidentReported,
  projectIncidentBreachDetermined,
  projectIncidentNotifiedHhs,
  projectIncidentNotifiedAffectedIndividuals,
  projectIncidentNotifiedMedia,
  projectIncidentNotifiedStateAg,
} from "@/lib/events/projections/incident";
import {
  hipaaCaBreachNotification15BizDaysRule,
  HIPAA_DERIVATION_RULES,
} from "@/lib/compliance/derivation/hipaa";

async function seedFrameworkAndCaOverlay() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "test",
      jurisdiction: "federal",
      weightDefault: 0.25,
      scoringStrategy: "STANDARD_CHECKLIST",
      sortOrder: 10,
    },
  });
  // The CA 15-business-day overlay must exist for the rederive helper to
  // find a requirement with the matching evidence type. Real seed lives
  // in scripts/seed-state-overlays.ts; here we upsert directly so the
  // test is self-contained.
  const caOverlay = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "HIPAA_CA_BREACH_NOTIFICATION_72HR",
      },
    },
    update: {
      jurisdictionFilter: ["CA"],
      acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_15_BIZ_DAYS"],
    },
    create: {
      frameworkId: framework.id,
      code: "HIPAA_CA_BREACH_NOTIFICATION_72HR",
      title: "Breach notification within 15 business days (CA)",
      severity: "CRITICAL",
      weight: 2,
      description: "test fixture",
      jurisdictionFilter: ["CA"],
      acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_15_BIZ_DAYS"],
      sortOrder: 200,
    },
  });
  return { framework, caOverlay };
}

async function seedPractice(primaryState: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Notif Test ${primaryState}`, primaryState },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function reportAndDetermineBreach(
  user: { id: string },
  practice: { id: string },
  opts: {
    incidentId?: string;
    discoveredAt?: Date;
    patientState?: string | null;
    affectedCount?: number;
  } = {},
): Promise<string> {
  const incidentId =
    opts.incidentId ?? `inc-${Math.random().toString(36).slice(2, 10)}`;
  const discoveredAt = opts.discoveredAt ?? new Date();
  const reportedPayload = {
    incidentId,
    title: "Test breach",
    description: "Test breach for notification flow",
    type: "PRIVACY" as const,
    severity: "HIGH" as const,
    phiInvolved: true,
    affectedCount: opts.affectedCount ?? 600,
    discoveredAt: discoveredAt.toISOString(),
    patientState: opts.patientState ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "INCIDENT_REPORTED",
      payload: reportedPayload,
    },
    async (tx) =>
      projectIncidentReported(tx, {
        practiceId: practice.id,
        reportedByUserId: user.id,
        payload: reportedPayload,
      }),
  );

  const determinePayload = {
    incidentId,
    factor1Score: 4,
    factor2Score: 4,
    factor3Score: 4,
    factor4Score: 4,
    overallRiskScore: 80,
    isBreach: true,
    affectedCount: opts.affectedCount ?? 600,
    ocrNotifyRequired: true,
  };
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "INCIDENT_BREACH_DETERMINED",
      payload: determinePayload,
    },
    async (tx) =>
      projectIncidentBreachDetermined(tx, {
        practiceId: practice.id,
        payload: determinePayload,
      }),
  );
  return incidentId;
}

describe("Incident notification events", () => {
  it("INCIDENT_NOTIFIED_HHS writes ocrNotifiedAt", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("AZ");
    const incidentId = await reportAndDetermineBreach(user, practice);
    const notifiedAt = "2026-04-23T18:00:00.000Z";
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_HHS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedHhs(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: incidentId },
    });
    expect(incident.ocrNotifiedAt?.toISOString()).toBe(notifiedAt);
  });

  it("INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS writes affectedIndividualsNotifiedAt", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("AZ");
    const incidentId = await reportAndDetermineBreach(user, practice);
    const notifiedAt = "2026-04-23T18:00:00.000Z";
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: incidentId },
    });
    expect(incident.affectedIndividualsNotifiedAt?.toISOString()).toBe(
      notifiedAt,
    );
  });

  it("INCIDENT_NOTIFIED_MEDIA writes mediaNotifiedAt", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("AZ");
    const incidentId = await reportAndDetermineBreach(user, practice);
    const notifiedAt = "2026-04-23T18:00:00.000Z";
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_MEDIA",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedMedia(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: incidentId },
    });
    expect(incident.mediaNotifiedAt?.toISOString()).toBe(notifiedAt);
  });

  it("INCIDENT_NOTIFIED_STATE_AG writes stateAgNotifiedAt", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("AZ");
    const incidentId = await reportAndDetermineBreach(user, practice);
    const notifiedAt = "2026-04-23T18:00:00.000Z";
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_STATE_AG",
        payload: { incidentId, notifiedAt, stateCode: "AZ" },
      },
      async (tx) =>
        projectIncidentNotifiedStateAg(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt, stateCode: "AZ" },
        }),
    );
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: incidentId },
    });
    expect(incident.stateAgNotifiedAt?.toISOString()).toBe(notifiedAt);
  });

  it("rejects notification when incident belongs to a different practice", async () => {
    await seedFrameworkAndCaOverlay();
    const { user: userA, practice: practiceA } = await seedPractice("AZ");
    const { practice: practiceB } = await seedPractice("AZ");
    const incidentId = await reportAndDetermineBreach(userA, practiceA);
    await expect(
      appendEventAndApply(
        {
          practiceId: practiceB.id,
          actorUserId: userA.id,
          type: "INCIDENT_NOTIFIED_HHS",
          payload: {
            incidentId,
            notifiedAt: "2026-04-23T18:00:00.000Z",
          },
        },
        async (tx) =>
          projectIncidentNotifiedHhs(tx, {
            practiceId: practiceB.id,
            payload: {
              incidentId,
              notifiedAt: "2026-04-23T18:00:00.000Z",
            },
          }),
      ),
    ).rejects.toThrow(/different practice/);
  });
});

describe("CA 15-business-day overlay derivation", () => {
  it("returns COMPLIANT when there are no CA-scoped breaches yet", async () => {
    const { practice } = await seedPractice("CA");
    const status = await db.$transaction((tx) =>
      hipaaCaBreachNotification15BizDaysRule(tx, practice.id),
    );
    expect(status).toBe("COMPLIANT");
  });

  it("returns GAP for a CA breach with no notification yet (window open)", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("CA");
    // discoveredAt = today; window is open but no notification yet.
    await reportAndDetermineBreach(user, practice, {
      patientState: "CA",
      discoveredAt: new Date(),
    });
    const status = await db.$transaction((tx) =>
      hipaaCaBreachNotification15BizDaysRule(tx, practice.id),
    );
    expect(status).toBe("GAP");
  });

  it("flips to COMPLIANT after AFFECTED_INDIVIDUALS notification within window", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("CA");
    const discoveredAt = new Date();
    const incidentId = await reportAndDetermineBreach(user, practice, {
      patientState: "CA",
      discoveredAt,
    });

    // Notify on the same day as discovery — well within 15 biz days.
    const notifiedAt = discoveredAt.toISOString();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );

    const status = await db.$transaction((tx) =>
      hipaaCaBreachNotification15BizDaysRule(tx, practice.id),
    );
    expect(status).toBe("COMPLIANT");
  });

  it("returns GAP when notification was recorded AFTER the 15-business-day window", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("CA");
    // Discovered 60 days ago — window has long elapsed.
    const discoveredAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const incidentId = await reportAndDetermineBreach(user, practice, {
      patientState: "CA",
      discoveredAt,
    });

    // Notice recorded yesterday — well after 15 biz days.
    const notifiedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );

    const status = await db.$transaction((tx) =>
      hipaaCaBreachNotification15BizDaysRule(tx, practice.id),
    );
    expect(status).toBe("GAP");
  });

  it("treats null patientState as CA only when practice.primaryState=CA", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("AZ");
    // AZ practice, breach with no patientState — NOT a CA breach for our rule.
    await reportAndDetermineBreach(user, practice, {
      patientState: null,
      discoveredAt: new Date(),
    });
    const status = await db.$transaction((tx) =>
      hipaaCaBreachNotification15BizDaysRule(tx, practice.id),
    );
    expect(status).toBe("COMPLIANT");
  });
});

describe("State breach-notification rule factory (other states)", () => {
  it("TX 60-day rule: COMPLIANT when no TX breaches", async () => {
    const { practice } = await seedPractice("TX");
    const rule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });

  it("TX 60-day rule: GAP when TX breach has no notification yet", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("TX");
    await reportAndDetermineBreach(user, practice, {
      patientState: "TX",
      discoveredAt: new Date(),
    });
    const rule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("GAP");
  });

  it("TX 60-day rule: COMPLIANT when notification recorded within window", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("TX");
    const discoveredAt = new Date();
    const incidentId = await reportAndDetermineBreach(user, practice, {
      patientState: "TX",
      discoveredAt,
    });
    // Notify 30 calendar days later — well within 60.
    const notifiedAt = new Date(
      discoveredAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const rule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });

  it("TX 60-day rule: GAP when notification recorded AFTER window", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("TX");
    // Discovered 90 days ago, notified yesterday — 30 days late.
    const discoveredAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const incidentId = await reportAndDetermineBreach(user, practice, {
      patientState: "TX",
      discoveredAt,
    });
    const notifiedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const rule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("GAP");
  });

  it("NY expedient rule: COMPLIANT once a notification exists, no window enforced", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("NY");
    const discoveredAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const incidentId = await reportAndDetermineBreach(user, practice, {
      patientState: "NY",
      discoveredAt,
    });
    const notifiedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_AFFECTED_INDIVIDUALS",
        payload: { incidentId, notifiedAt },
      },
      async (tx) =>
        projectIncidentNotifiedAffectedIndividuals(tx, {
          practiceId: practice.id,
          payload: { incidentId, notifiedAt },
        }),
    );
    const rule = HIPAA_DERIVATION_RULES.HIPAA_NY_BREACH_EXPEDIENT!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });

  it("NY expedient rule: GAP when no notification at all", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("NY");
    await reportAndDetermineBreach(user, practice, {
      patientState: "NY",
      discoveredAt: new Date(),
    });
    const rule = HIPAA_DERIVATION_RULES.HIPAA_NY_BREACH_EXPEDIENT!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("GAP");
  });

  it("OR 45-day rule: vacuous when no OR-scoped breaches (CA breach doesn't count)", async () => {
    await seedFrameworkAndCaOverlay();
    const { user, practice } = await seedPractice("OR");
    await reportAndDetermineBreach(user, practice, {
      patientState: "CA",
      discoveredAt: new Date(),
    });
    const rule = HIPAA_DERIVATION_RULES.HIPAA_OR_BREACH_45DAY!;
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });
});
