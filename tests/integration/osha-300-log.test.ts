// tests/integration/osha-300-log.test.ts
//
// Reporting an OSHA_RECORDABLE incident should flip OSHA_300_LOG to
// COMPLIANT via the incident-recordable evidence path.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentReported } from "@/lib/events/projections/incident";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `osha-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "OSHA Log Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "OSHA" },
    update: {},
    create: {
      code: "OSHA",
      name: "OSHA",
      description: "test",
      jurisdiction: "federal",
      weightDefault: 0.2,
      scoringStrategy: "STANDARD_CHECKLIST",
      sortOrder: 20,
    },
  });
  const req = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "OSHA_300_LOG",
      },
    },
    update: { acceptedEvidenceTypes: ["INCIDENT:OSHA_RECORDABLE"] },
    create: {
      frameworkId: framework.id,
      code: "OSHA_300_LOG",
      title: "OSHA 300 Log",
      severity: "STANDARD",
      weight: 1,
      description: "test",
      acceptedEvidenceTypes: ["INCIDENT:OSHA_RECORDABLE"],
      sortOrder: 50,
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
  return { user, practice, req };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("OSHA_300_LOG → INCIDENT:OSHA_RECORDABLE derivation", () => {
  it("No OSHA incidents → GAP (via rederive)", async () => {
    const { user, practice, req } = await seed();
    // Report a non-OSHA incident; should NOT flip OSHA_300_LOG.
    const id = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId: id,
      title: "PHI email",
      description: "Wrong recipient",
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
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload,
        }),
    );
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");
  });

  it("OSHA_RECORDABLE incident flips OSHA_300_LOG to COMPLIANT", async () => {
    const { user, practice, req } = await seed();
    const id = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId: id,
      title: "Needlestick during venipuncture",
      description: "RN sustained a needlestick",
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
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });
});
