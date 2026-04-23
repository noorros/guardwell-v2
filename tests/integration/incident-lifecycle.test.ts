// tests/integration/incident-lifecycle.test.ts
//
// End-to-end: incident report → breach determination → composite
// HIPAA_BREACH_RESPONSE derivation flips GAP while unresolved, flips
// back to COMPLIANT on INCIDENT_RESOLVED.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectIncidentReported,
  projectIncidentBreachDetermined,
  projectIncidentResolved,
} from "@/lib/events/projections/incident";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `incident-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Incident Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
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
  const breachReq = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "HIPAA_BREACH_RESPONSE",
      },
    },
    update: { acceptedEvidenceTypes: ["POLICY:HIPAA_BREACH_RESPONSE_POLICY"] },
    create: {
      frameworkId: framework.id,
      code: "HIPAA_BREACH_RESPONSE",
      title: "Breach Response Procedure",
      severity: "CRITICAL",
      weight: 2,
      description: "Composite — policy + no unresolved breaches.",
      acceptedEvidenceTypes: ["POLICY:HIPAA_BREACH_RESPONSE_POLICY"],
      sortOrder: 70,
    },
  });
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });
  // Adopt breach-response policy so the COMPLIANT branch of the composite
  // rule can fire.
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "POLICY_ADOPTED",
      payload: {
        practicePolicyId: `policy-${Math.random().toString(36).slice(2, 10)}`,
        policyCode: "HIPAA_BREACH_RESPONSE_POLICY",
        version: 1,
      },
    },
    async (tx) =>
      projectPolicyAdopted(tx, {
        practiceId: practice.id,
        payload: {
          practicePolicyId: `policy-${Math.random().toString(36).slice(2, 10)}`,
          policyCode: "HIPAA_BREACH_RESPONSE_POLICY",
          version: 1,
        },
      }),
  );
  return { user, practice, breachReq };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("Incident lifecycle → HIPAA_BREACH_RESPONSE derivation", () => {
  it("newly-reported incident (undetermined) leaves HIPAA_BREACH_RESPONSE COMPLIANT", async () => {
    const { user, practice, breachReq } = await seed();

    // Policy alone satisfies composite rule when no unresolved breaches.
    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");

    const incidentId = `inc-${Math.random().toString(36).slice(2, 10)}`;
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_REPORTED",
        payload: {
          incidentId,
          title: "Test",
          description: "Test incident",
          type: "PRIVACY",
          severity: "LOW",
          phiInvolved: true,
          affectedCount: 1,
          discoveredAt: new Date().toISOString(),
        },
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload: {
            incidentId,
            title: "Test",
            description: "Test incident",
            type: "PRIVACY",
            severity: "LOW",
            phiInvolved: true,
            affectedCount: 1,
            discoveredAt: new Date().toISOString(),
          },
        }),
    );

    // Still undetermined → still COMPLIANT.
    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");
  });

  it("breach determination flips HIPAA_BREACH_RESPONSE to GAP while unresolved", async () => {
    const { user, practice, breachReq } = await seed();
    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");

    const incidentId = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const reportedPayload = {
      incidentId,
      title: "Breach",
      description: "PHI exfiltration",
      type: "PRIVACY" as const,
      severity: "HIGH" as const,
      phiInvolved: true,
      affectedCount: 150,
      discoveredAt: new Date().toISOString(),
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
      factor1Score: 5,
      factor2Score: 5,
      factor3Score: 5,
      factor4Score: 5,
      overallRiskScore: 100,
      isBreach: true,
      affectedCount: 150,
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

    // Unresolved breach → GAP.
    expect(await statusOf(practice.id, breachReq.id)).toBe("GAP");

    // Resolve → COMPLIANT.
    const resolvePayload = { incidentId, resolution: "Remediated" };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_RESOLVED",
        payload: resolvePayload,
      },
      async (tx) =>
        projectIncidentResolved(tx, {
          practiceId: practice.id,
          payload: resolvePayload,
        }),
    );

    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");
  });

  it("determining not-a-breach leaves HIPAA_BREACH_RESPONSE COMPLIANT", async () => {
    const { user, practice, breachReq } = await seed();
    const incidentId = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const reportedPayload = {
      incidentId,
      title: "False alarm",
      description: "Misrouted fax",
      type: "PRIVACY" as const,
      severity: "LOW" as const,
      phiInvolved: true,
      affectedCount: 1,
      discoveredAt: new Date().toISOString(),
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
      factor1Score: 1,
      factor2Score: 1,
      factor3Score: 1,
      factor4Score: 1,
      overallRiskScore: 20,
      isBreach: false,
      affectedCount: 1,
      ocrNotifyRequired: false,
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

    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");
  });

  it("OSHA_RECORDABLE incident reports without flipping HIPAA_BREACH_RESPONSE", async () => {
    const { user, practice, breachReq } = await seed();
    const incidentId = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId,
      title: "Needlestick",
      description: "RN sustained a needlestick during venipuncture",
      type: "OSHA_RECORDABLE" as const,
      severity: "MEDIUM" as const,
      phiInvolved: false,
      affectedCount: 0,
      discoveredAt: new Date().toISOString(),
      oshaBodyPart: "Finger",
      oshaInjuryNature: "Needlestick",
      oshaOutcome: "FIRST_AID" as const,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload,
        }),
    );
    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");
    const stored = await db.incident.findUnique({ where: { id: incidentId } });
    expect(stored?.oshaOutcome).toBe("FIRST_AID");
  });
});
